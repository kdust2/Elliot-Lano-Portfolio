/**
 * @file sequence.js
 * Scroll-Driven Frame Sequence Module
 * Maps scroll progress to image sequence frames drawn on <canvas>
 */

export function initSequence(config = {}) {
  const {
    canvas,
    wrapper,
    path = '/frames/frame_',
    ext = '.webp',
    digits = 4,
    frameCount = 120,
    mobilePath = '/frames/mobile/frame_',
    mobileFrameCount = 60,
    smoothing = 0.12,
    captions = [],
    onProgress = null,
    onPreloadProgress = null
  } = config;

  if (!canvas || !wrapper) {
    console.warn('[Sequence] Canvas or wrapper element missing. Skipping initialization.');
    return null;
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    console.warn('[Sequence] Failed to get 2D context for canvas.');
    return null;
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth <= 768;
  const activePath = isMobile && mobilePath ? mobilePath : path;
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
  let isIntersecting = false;
  let isRafRunning = false;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let dpr = 1;

  // Cached dimensions to prevent layout thrashing on scroll
  let cachedWrapperTop = 0;
  let cachedWrapperHeight = 0;
  let cachedViewportHeight = window.innerHeight;

  function measureDimensions() {
    const rect = wrapper.getBoundingClientRect();
    cachedWrapperTop = rect.top + window.scrollY;
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
    ctx.imageSmoothingQuality = 'high';

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
   */
  function drawImageCover(img) {
    if (!img) return;
    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;

    if (!iw || !ih) return;

    ctx.clearRect(0, 0, cw, ch);

    const scale = Math.max(cw / iw, ch / ih);
    const nw = iw * scale;
    const nh = ih * scale;
    const dx = (cw - nw) / 2;
    const dy = (ch - nh) / 2;

    ctx.drawImage(img, dx, dy, nw, nh);
  }

  /**
   * Draw frame by index, with fallback to nearest available loaded frame
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

    // If target frame not loaded, find nearest loaded frame
    if (!imgToDraw || !imgToDraw.complete) {
      let offset = 1;
      while (offset < activeCount) {
        const prev = clamped - offset;
        const next = clamped + offset;
        if (prev >= 0 && images[prev]?.complete) {
          imgToDraw = images[prev];
          break;
        }
        if (next < activeCount && images[next]?.complete) {
          imgToDraw = images[next];
          break;
        }
        offset++;
      }
    }

    if (imgToDraw && imgToDraw.complete) {
      drawImageCover(imgToDraw);
      lastDrawnFrame = clamped;
    } else {
      // If no frames ready yet, draw procedural
      drawProcedural(clamped / (activeCount - 1), clamped);
    }
  }

  /**
   * Sync captions and progress indicators
   */
  function syncUI(progress, currentIdx) {
    // 1. Captions
    captions.forEach((cap, idx) => {
      const el = cap.el || document.getElementById(`seq-caption-${idx + 1}`);
      if (!el) return;

      const from = cap.from ?? 0;
      const to = cap.to ?? 1;
      const mid = (from + to) / 2;
      const span = (to - from) / 2;

      if (progress >= from && progress <= to) {
        // Fade in toward mid, fade out toward to
        const dist = Math.abs(progress - mid);
        const normDist = 1 - Math.min(1, dist / span);
        const opacity = Math.min(1, normDist * 1.5);
        const translateY = (1 - normDist) * 20;

        el.style.opacity = opacity.toFixed(3);
        el.style.transform = `translate3d(0, ${translateY.toFixed(1)}px, 0)`;
        el.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none';
      } else {
        el.style.opacity = '0';
        el.style.transform = 'translate3d(0, 25px, 0)';
        el.style.pointerEvents = 'none';
      }
    });

    // 2. HUD Counter & Progress Bar
    if (frameNumEl) {
      frameNumEl.textContent = String(currentIdx + 1).padStart(3, '0');
    }
    if (progressFillEl) {
      progressFillEl.style.width = `${(progress * 100).toFixed(1)}%`;
    }

    // 3. Debug Panel
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

  /**
   * Main rAF loop: runs only while moving and when intersecting
   */
  function startRafLoop() {
    if (isRafRunning) return;
    isRafRunning = true;

    function step() {
      if (!isIntersecting) {
        isRafRunning = false;
        return;
      }

      // Lerp toward target
      const delta = targetFrame - currentFrame;
      currentFrame += delta * smoothing;

      const frameIdx = Math.max(0, Math.min(activeCount - 1, Math.round(currentFrame)));
      const progress = frameIdx / (activeCount - 1);

      if (frameIdx !== lastDrawnFrame) {
        drawFrame(frameIdx);
        syncUI(progress, frameIdx);
      }

      // Check if settled
      if (Math.abs(delta) < 0.005) {
        currentFrame = targetFrame;
        isRafRunning = false;
        return;
      }

      requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  /**
   * Calculate scroll progress through the sequence section using cached measurements
   */
  function updateScroll() {
    if (prefersReducedMotion) return;
    if (!isIntersecting) return;

    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const maxScroll = cachedWrapperHeight - cachedViewportHeight;
    const rawProgress = maxScroll > 0 ? (scrollY - cachedWrapperTop) / maxScroll : 0;
    const progress = Math.max(0, Math.min(1, rawProgress));

    targetFrame = progress * (activeCount - 1);

    if (!isRafRunning) {
      startRafLoop();
    }
  }

  /**
   * Preload frames in batches of 8 using Image + decode()
   */
  async function preloadFrames() {
    // 1. Immediately load frame 0 (poster)
    const poster = new Image();
    poster.src = getFrameSrc(0);

    const onPosterReady = () => {
      images[0] = poster;
      loadedCount++;
      drawFrame(0);
      syncUI(0, 0);
      reportPreloadProgress();
    };

    poster.onload = onPosterReady;
    poster.onerror = () => {
      console.warn(`[Sequence] Poster frame 404 at ${poster.src}. Switching to procedural canvas renderer.`);
      hasFallbackMode = true;
      drawProcedural(0, 0);
      reportPreloadProgress(1);
    };

    try {
      await poster.decode();
      onPosterReady();
    } catch {
      // Ignore if decode rejected, onload/onerror handles it
    }

    if (hasFallbackMode) return;

    // 2. Batch load remaining frames
    const batchSize = 8;
    const remainingIndices = [];
    for (let i = 1; i < activeCount; i++) {
      remainingIndices.push(i);
    }

    async function loadBatch(indices) {
      const promises = indices.map((idx) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.src = getFrameSrc(idx);
          img.onload = () => {
            images[idx] = img;
            loadedCount++;
            reportPreloadProgress();
            resolve();
          };
          img.onerror = () => {
            // Fail gracefully
            resolve();
          };
          img.decode?.().catch(() => {});
        });
      });
      await Promise.all(promises);
    }

    for (let i = 0; i < remainingIndices.length; i += batchSize) {
      const chunk = remainingIndices.slice(i, i + batchSize);
      await loadBatch(chunk);
    }
  }

  function reportPreloadProgress(forceRatio = null) {
    const ratio = forceRatio !== null ? forceRatio : loadedCount / activeCount;
    if (typeof onPreloadProgress === 'function') {
      onPreloadProgress(ratio);
    }
    window.dispatchEvent(new CustomEvent('sequence-preload-progress', { detail: { ratio } }));
  }

  // Preload initial frames
  preloadFrames();

  // IntersectionObserver to conserve GPU and battery
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        isIntersecting = entry.isIntersecting;
        if (isIntersecting) {
          updateScroll();
        }
      });
    },
    { rootMargin: '200px 0px 200px 0px' }
  );
  observer.observe(wrapper);

  // Hook scroll updates into Lenis or window scroll
  window.addEventListener('scroll', updateScroll, { passive: true });

  // Listen to theme changes to redraw procedural or refresh canvas
  window.addEventListener('themechanged', () => {
    drawFrame(Math.round(currentFrame));
  });

  // Reduced motion: draw poster frame once and return
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
      window.removeEventListener('scroll', updateScroll);
    },
    update: updateScroll,
    getLoadedRatio: () => loadedCount / activeCount
  };
}
