/**
 * @file sequence.js
 * Scroll-Driven Frame Sequence Engine
 * Synchronized with Lenis Smooth Scroll and GSAP ScrollTrigger
 * High-performance 60fps/120fps canvas frame playback with zero layout thrashing
 */

export function initSequence(config = {}) {
  const {
    canvas,
    wrapper,
    lenis: userLenis = null,
    path = 'frames/frame_',
    ext = '.webp',
    digits = 4,
    frameCount = 120,
    mobilePath = 'frames/mobile/frame_',
    mobileFrameCount = 60,
    smoothing = 0.25,
    captions = [],
    onProgress = null,
    onPreloadProgress = null
  } = config;

  if (!canvas || !wrapper) {
    console.warn('[Sequence] Canvas or wrapper element missing. Skipping initialization.');
    return null;
  }

  // Request opaque, desynchronized 2D context to maximize compositor throughput
  const ctx = canvas.getContext('2d', {
    alpha: false,
    desynchronized: true
  }) || canvas.getContext('2d', { alpha: true });

  if (!ctx) {
    console.warn('[Sequence] Failed to get 2D context for canvas.');
    return null;
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  const normalizePath = (p) => {
    if (!p) return 'frames/frame_';
    return p.startsWith('/') ? '.' + p : p;
  };

  const cleanPath = normalizePath(path);
  const cleanMobilePath = normalizePath(mobilePath);
  const activePath = isMobile && cleanMobilePath ? cleanMobilePath : cleanPath;
  const activeCount = isMobile && mobileFrameCount ? mobileFrameCount : frameCount;

  // Debug mode: enabled if URL has ?debug
  const urlParams = new URLSearchParams(window.location.search);
  const isDebug = urlParams.has('debug');
  const debugPanel = document.getElementById('sequence-debug-panel');
  if (isDebug && debugPanel) {
    debugPanel.style.display = 'block';
  }

  // State
  const images = new Array(activeCount).fill(null);
  let loadedCount = 0;
  let hasFallbackMode = false;
  let targetFrame = 0;
  let currentFrame = 0;
  let lastDrawnFrame = -1;
  let lastDrawnImg = null;
  let isIntersecting = false;
  let isRafRunning = false;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let dpr = 1;

  // Cached dimension metrics
  let cachedWrapperTop = 0;
  let cachedWrapperHeight = 0;
  let cachedViewportHeight = window.innerHeight;

  // Precomputed draw parameters to eliminate per-frame math & layout queries
  let cachedDrawParams = null;

  function updateDrawParams(iw, ih) {
    if (!iw || !ih || !canvasWidth || !canvasHeight) return;
    const cw = canvas.width;
    const ch = canvas.height;
    const scale = Math.max(cw / iw, ch / ih);
    const nw = Math.ceil(iw * scale);
    const nh = Math.ceil(ih * scale);
    const dx = Math.floor((cw - nw) / 2);
    const dy = Math.floor((ch - nh) / 2);
    cachedDrawParams = { dx, dy, nw, nh, iw, ih };
  }

  function measureDimensions() {
    const rect = wrapper.getBoundingClientRect();
    cachedWrapperTop = rect.top + (window.scrollY || document.documentElement.scrollTop);
    cachedWrapperHeight = rect.height;
    cachedViewportHeight = window.innerHeight;
  }
  measureDimensions();

  // DOM HUD elements
  const frameNumEl = document.querySelector('.sequence-frame-num');
  const frameTotalEl = document.querySelector('.sequence-total-num');
  const progressFillEl = document.querySelector('.sequence-progress-fill');

  if (frameTotalEl) {
    frameTotalEl.textContent = String(activeCount).padStart(3, '0');
  }

  // Track caption active states to avoid touching DOM on inactive elements
  const captionStates = new Array(captions.length).fill(null);
  let lastHudIdx = -1;
  let lastProgressPercent = -1;

  /**
   * Helper to format zero-padded frame filenames (1-indexed)
   */
  function getFrameSrc(index) {
    const num = String(index + 1).padStart(digits, '0');
    return `${activePath}${num}${ext}`;
  }

  /**
   * Resize canvas to bounding box with capped DPR
   */
  function handleResize() {
    measureDimensions();

    const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : wrapper.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = rect.width;
    canvasHeight = rect.height;

    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = Math.round(canvasHeight * dpr);
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    cachedDrawParams = null;

    // Redraw current frame
    if (lastDrawnFrame >= 0) {
      drawFrame(lastDrawnFrame, true);
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    handleResize();
  });
  if (canvas.parentElement) {
    resizeObserver.observe(canvas.parentElement);
  } else {
    resizeObserver.observe(wrapper);
  }
  window.addEventListener('resize', handleResize, { passive: true });
  handleResize();

  /**
   * Procedural Fallback Animation:
   * Used if frames fail to load (404) so section remains visually stunning.
   */
  function drawProcedural(progress, frameIdx) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const bg = isDark ? '#0B0B0C' : '#FAFAF8';
    const stroke = isDark ? 'rgba(77, 109, 255, 0.4)' : 'rgba(43, 75, 255, 0.35)';
    const emerald = isDark ? 'rgba(16, 185, 129, 0.6)' : 'rgba(15, 157, 116, 0.6)';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Dynamic grid
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = stroke;
    const gridSize = 60 * dpr;
    const offset = (progress * 200 * dpr) % gridSize;

    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = offset; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Expanding architectural circles & crosshairs
    const cx = w / 2;
    const cy = h / 2;
    const radius = (120 + progress * 240) * dpr;

    ctx.beginPath();
    ctx.strokeStyle = emerald;
    ctx.lineWidth = 2 * dpr;
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = stroke;
    ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2);
    ctx.stroke();

    // Geometric crosshair
    ctx.beginPath();
    ctx.moveTo(cx - 30 * dpr, cy);
    ctx.lineTo(cx + 30 * dpr, cy);
    ctx.moveTo(cx, cy - 30 * dpr);
    ctx.lineTo(cx, cy + 30 * dpr);
    ctx.stroke();

    // HUD Text
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
    ctx.font = `${12 * dpr}px monospace`;
    ctx.fillText(`PROCEDURAL SYNTHESIS // PROGRESS: ${(progress * 100).toFixed(1)}%`, 30 * dpr, 40 * dpr);
    ctx.fillText(`ACTIVE_FRAME: ${String(frameIdx + 1).padStart(3, '0')} / ${String(activeCount).padStart(3, '0')}`, 30 * dpr, 60 * dpr);
  }

  /**
   * Draw an image with "cover" fit on canvas
   * Bypasses clearRect when drawing opaque images to avoid double GPU writes
   */
  function drawImageCover(img) {
    if (!img) return;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;

    if (!cachedDrawParams || cachedDrawParams.iw !== iw || cachedDrawParams.ih !== ih) {
      updateDrawParams(iw, ih);
    }

    if (cachedDrawParams) {
      ctx.drawImage(
        img,
        cachedDrawParams.dx,
        cachedDrawParams.dy,
        cachedDrawParams.nw,
        cachedDrawParams.nh
      );
    }
  }

  /**
   * Draw frame by index with instant fallback to last drawn image (O(1))
   */
  function drawFrame(index, force = false) {
    const clamped = Math.max(0, Math.min(activeCount - 1, index));

    if (!force && clamped === lastDrawnFrame && !hasFallbackMode) {
      return;
    }

    if (hasFallbackMode) {
      drawProcedural(clamped / (activeCount - 1), clamped);
      lastDrawnFrame = clamped;
      return;
    }

    let imgToDraw = images[clamped];

    if (imgToDraw && imgToDraw.complete) {
      lastDrawnImg = imgToDraw;
    } else if (lastDrawnImg) {
      // Hold last valid frame cleanly to eliminate searching loops
      imgToDraw = lastDrawnImg;
    } else {
      // Fast bounded check within 5 frames during initial boot
      for (let o = 1; o <= 5; o++) {
        const p = clamped - o;
        const n = clamped + o;
        if (p >= 0 && images[p]?.complete) {
          imgToDraw = images[p];
          lastDrawnImg = imgToDraw;
          break;
        }
        if (n < activeCount && images[n]?.complete) {
          imgToDraw = images[n];
          lastDrawnImg = imgToDraw;
          break;
        }
      }
    }

    if (imgToDraw && imgToDraw.complete) {
      drawImageCover(imgToDraw);
      lastDrawnFrame = clamped;
    } else {
      drawProcedural(clamped / (activeCount - 1), clamped);
    }
  }

  /**
   * Sync captions and progress indicators
   * Skips updating inactive caption DOM nodes to minimize style recalculation
   */
  function syncUI(progress, currentIdx) {
    // 1. Captions
    for (let idx = 0; idx < captions.length; idx++) {
      const cap = captions[idx];
      const el = cap.el || document.getElementById(`seq-caption-${idx + 1}`);
      if (!el) continue;

      const from = cap.from ?? 0;
      const to = cap.to ?? 1;
      const mid = (from + to) / 2;
      const span = (to - from) / 2;
      const isActive = progress >= from && progress <= to;

      if (isActive) {
        captionStates[idx] = true;
        const dist = Math.abs(progress - mid);
        const normDist = 1 - Math.min(1, dist / span);
        const opacity = Math.min(1, normDist * 1.5);
        const translateY = (1 - normDist) * 20;

        el.style.opacity = opacity.toFixed(3);
        el.style.transform = `translate3d(0, ${translateY.toFixed(1)}px, 0)`;
        el.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none';
      } else if (captionStates[idx] !== false) {
        captionStates[idx] = false;
        el.style.opacity = '0';
        el.style.transform = 'translate3d(0, 25px, 0)';
        el.style.pointerEvents = 'none';
      }
    }

    // 2. HUD Counter
    if (frameNumEl && currentIdx !== lastHudIdx) {
      frameNumEl.textContent = String(currentIdx + 1).padStart(3, '0');
      lastHudIdx = currentIdx;
    }

    // 3. Progress fill
    if (progressFillEl) {
      const pct = Math.round(progress * 1000) / 10;
      if (pct !== lastProgressPercent) {
        progressFillEl.style.width = `${pct}%`;
        lastProgressPercent = pct;
      }
    }

    // 4. Debug Panel
    if (isDebug && debugPanel) {
      debugPanel.innerHTML = `
        <strong>[SEQUENCE DEBUG]</strong><br/>
        Target Frame: ${targetFrame.toFixed(2)}<br/>
        Current Frame: ${currentFrame.toFixed(2)}<br/>
        Active Frame: ${currentIdx + 1} / ${activeCount}<br/>
        Scroll Progress: ${(progress * 100).toFixed(1)}%<br/>
        Preloaded: ${loadedCount} / ${activeCount} (${((loadedCount / activeCount) * 100).toFixed(0)}%)<br/>
        Fallback Active: ${hasFallbackMode ? 'YES' : 'NO'}<br/>
        Raf Active: ${isRafRunning ? 'YES' : 'NO'}
      `;
    }

    if (typeof onProgress === 'function') {
      onProgress(progress, currentIdx);
    }
  }

  // Determine smooth scroller presence
  const lenisInstance = userLenis || (typeof window !== 'undefined' ? window.lenis : null);
  // When Lenis handles inertia, use snappy 0.35 smoothing to avoid lagging behind scroll.
  // When on native un-eased wheel scrolling, use 0.20 for smooth interpolation.
  const effectiveSmoothing = lenisInstance ? 0.35 : (smoothing || 0.2);

  /**
   * Optimized rAF rendering loop: runs ONLY while moving and stops immediately when settled
   */
  function startRafLoop() {
    if (isRafRunning) return;
    isRafRunning = true;

    function step() {
      if (!isIntersecting) {
        isRafRunning = false;
        return;
      }

      const delta = targetFrame - currentFrame;

      // Settle if difference is negligible
      if (Math.abs(delta) < 0.02) {
        currentFrame = targetFrame;
      } else {
        currentFrame += delta * effectiveSmoothing;
      }

      const frameIdx = Math.max(0, Math.min(activeCount - 1, Math.round(currentFrame)));
      const progress = frameIdx / (activeCount - 1);

      if (frameIdx !== lastDrawnFrame) {
        drawFrame(frameIdx);
        syncUI(progress, frameIdx);
      }

      // Continue rAF loop only if still moving
      if (currentFrame !== targetFrame) {
        requestAnimationFrame(step);
      } else {
        isRafRunning = false;
      }
    }

    requestAnimationFrame(step);
  }

  /**
   * Apply scroll progress directly to target frame
   */
  function applyScrollProgress(progress) {
    if (prefersReducedMotion) return;
    const clamped = Math.max(0, Math.min(1, progress));
    targetFrame = clamped * (activeCount - 1);

    if (!isRafRunning) {
      startRafLoop();
    }
  }

  /**
   * Calculate scroll progress through the sequence section using cached measurements
   */
  function calculateFromScrollY(scrollY) {
    const maxScroll = cachedWrapperHeight - cachedViewportHeight;
    const rawProgress = maxScroll > 0 ? (scrollY - cachedWrapperTop) / maxScroll : 0;
    applyScrollProgress(rawProgress);
  }

  // --- Scroll & ScrollTrigger Integration ---
  let scrollTriggerInstance = null;

  // 1. GSAP ScrollTrigger synchronization
  if (typeof window !== 'undefined' && window.ScrollTrigger) {
    scrollTriggerInstance = window.ScrollTrigger.create({
      trigger: wrapper,
      start: 'top top',
      end: 'bottom bottom',
      scrub: true,
      onUpdate: (self) => {
        if (!isIntersecting) return;
        applyScrollProgress(self.progress);
      },
      onRefresh: () => {
        measureDimensions();
      }
    });
  }

  // 2. Lenis scroll listener (acts as primary if ScrollTrigger is not registered)
  function handleLenisScroll(e) {
    if (scrollTriggerInstance) return; // ScrollTrigger updates automatically via Lenis ticker
    if (!isIntersecting) return;
    const scrollY = typeof e.scroll === 'number' ? e.scroll : window.scrollY;
    calculateFromScrollY(scrollY);
  }

  if (lenisInstance) {
    lenisInstance.on('scroll', handleLenisScroll);
  }

  // 3. Native window scroll listener (fallback)
  function handleWindowScroll() {
    if (scrollTriggerInstance || lenisInstance) return;
    if (!isIntersecting) return;
    calculateFromScrollY(window.scrollY || document.documentElement.scrollTop);
  }
  window.addEventListener('scroll', handleWindowScroll, { passive: true });

  /**
   * Preload frames in batches of 8 using Image + decode() off the main thread
   */
  async function preloadFrames() {
    // 1. Immediately load frame 0 (poster)
    const poster = new Image();
    poster.src = getFrameSrc(0);

    const onPosterReady = () => {
      images[0] = poster;
      lastDrawnImg = poster;
      loadedCount++;
      drawFrame(0);
      syncUI(0, 0);
      reportPreloadProgress();
    };

    poster.onload = async () => {
      try {
        if (poster.decode) {
          await poster.decode();
        }
      } catch {
        // Ignore decode rejection
      }
      onPosterReady();
    };

    poster.onerror = () => {
      console.warn(`[Sequence] Poster frame 404 at ${poster.src}. Switching to procedural canvas renderer.`);
      hasFallbackMode = true;
      drawProcedural(0, 0);
      reportPreloadProgress(1);
    };

    if (hasFallbackMode) return;

    // 2. Load remaining frames with a rolling pool (no batch barrier, no forced decode)
    const queue = [];
    for (let i = 1; i < activeCount; i++) queue.push(i);
    const POOL = 6;

    function loadOne(idx) {
      return new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          images[idx] = img;
          loadedCount++;
          reportPreloadProgress();
          resolve();
        };
        img.onerror = () => resolve();
        img.src = getFrameSrc(idx);
      });
    }

    async function worker() {
      while (queue.length) {
        await loadOne(queue.shift());
      }
    }

    for (let w = 0; w < POOL; w++) worker();
  }

  function reportPreloadProgress(forceRatio = null) {
    const ratio = forceRatio !== null ? forceRatio : loadedCount / activeCount;
    if (typeof onPreloadProgress === 'function') {
      onPreloadProgress(ratio);
    }
    window.dispatchEvent(new CustomEvent('sequence-preload-progress', { detail: { ratio } }));
  }

  preloadFrames();

  // Refresh dimensions when page completely loads fonts and assets
  window.addEventListener('load', measureDimensions, { once: true });

  // Optimized IntersectionObserver with 600px margin and reflow-free bounding rect
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        isIntersecting = entry.isIntersecting;
        if (isIntersecting) {
          // Read precomputed boundingClientRect from observer entry (zero DOM reflow!)
          if (entry.boundingClientRect) {
            const scrollY = window.scrollY || document.documentElement.scrollTop;
            cachedWrapperTop = entry.boundingClientRect.top + scrollY;
            cachedWrapperHeight = entry.boundingClientRect.height || wrapper.offsetHeight;
            cachedViewportHeight = window.innerHeight;
            if (cachedDrawParams) {
              updateDrawParams(cachedDrawParams.iw, cachedDrawParams.ih);
            }
          } else {
            measureDimensions();
          }

          if (scrollTriggerInstance) {
            scrollTriggerInstance.refresh();
          } else if (lenisInstance) {
            calculateFromScrollY(lenisInstance.scroll || window.scrollY);
          } else {
            calculateFromScrollY(window.scrollY || document.documentElement.scrollTop);
          }
        } else {
          // Offscreen: halt loop to conserve GPU/battery
          isRafRunning = false;

          // Settle clean boundary states
          const scrollY = window.scrollY || document.documentElement.scrollTop;
          if (cachedWrapperTop > 0) {
            if (scrollY < cachedWrapperTop) {
              targetFrame = 0;
              currentFrame = 0;
              drawFrame(0);
              syncUI(0, 0);
            } else if (scrollY > cachedWrapperTop + cachedWrapperHeight - cachedViewportHeight) {
              targetFrame = activeCount - 1;
              currentFrame = activeCount - 1;
              drawFrame(activeCount - 1);
              syncUI(1, activeCount - 1);
            }
          }
        }
      });
    },
    { rootMargin: '600px 0px 600px 0px', threshold: [0] }
  );
  observer.observe(wrapper);

  // Redraw when theme flips
  window.addEventListener('themechanged', () => {
    drawFrame(Math.round(currentFrame), true);
  });

  // Reduced motion handling
  if (prefersReducedMotion) {
    drawFrame(0);
    syncUI(0, 0);
    return {
      destroy: () => observer.disconnect()
    };
  }

  return {
    destroy: () => {
      observer.disconnect();
      resizeObserver.disconnect();
      if (scrollTriggerInstance) {
        scrollTriggerInstance.kill();
      }
      if (lenisInstance) {
        lenisInstance.off('scroll', handleLenisScroll);
      }
      window.removeEventListener('scroll', handleWindowScroll);
      window.removeEventListener('resize', handleResize);
    },
    update: () => {
      measureDimensions();
      if (scrollTriggerInstance) {
        scrollTriggerInstance.refresh();
      } else {
        calculateFromScrollY(window.scrollY || document.documentElement.scrollTop);
      }
    },
    getLoadedRatio: () => loadedCount / activeCount
  };
}
