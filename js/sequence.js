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
  let lastSmoothProgress = -1;
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
    // Phones: cap pixel density at 1.5x; the scene is flat shapes and text, and this cuts fill cost by ~45%
    dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 768 ? 1.5 : 2);
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
   * Web-development scene, drawn procedurally and driven by scroll progress (0..1):
   *   0.00-0.33  a wireframe is "scanned" into a browser window
   *   0.33-0.67  the window turns into an editor and HTML/CSS types itself out
   *   0.67-1.00  the finished page appears, a phone version slides in (responsive)
   *              and Lighthouse-style scores fill up to 100
   *
   * Performance: everything static (background, window with its shadow, wireframe,
   * finished page, phone) is rendered ONCE into cached sprites. Each frame is then just
   * a handful of drawImage calls plus a few lines of text, with no shadow blurs.
   */
  const CODE_LINES = [
    [['<section ', 'tag'], ['class=', 'attr'], ['"hero"', 'str'], ['>', 'tag']],
    [['  <h1>', 'tag'], ['Interfaces that feel effortless', 'plain'], ['</h1>', 'tag']],
    [['  <a ', 'tag'], ['class=', 'attr'], ['"btn" ', 'str'], ['href=', 'attr'], ['"#work"', 'str'], ['>', 'tag'], ['View work', 'plain'], ['</a>', 'tag']],
    [['</section>', 'tag']],
    [['.hero ', 'prop'], ['{ ', 'plain'], ['display', 'attr'], [': grid; ', 'val'], ['gap', 'attr'], [': 2rem; ', 'val'], ['}', 'plain']],
    [['.btn ', 'prop'], ['{ ', 'plain'], ['background', 'attr'], [': var(--accent); ', 'val'], ['}', 'plain']],
    [['@media ', 'tag'], ['(max-width: 768px) ', 'val'], ['{', 'plain']],
    [['  .hero ', 'prop'], ['{ ', 'plain'], ['grid-template-columns', 'attr'], [': 1fr; ', 'val'], ['}', 'plain']],
    [['}', 'plain']]
  ];
  const CODE_TOTAL = CODE_LINES.reduce((n, l) => n + l.reduce((m, seg) => m + seg[0].length, 0), 0);
  const MONO = 'ui-monospace, Menlo, Consolas, monospace';
  const SPRITE_PAD = 40;
  const GRID = 28;

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  function rrectOn(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.arcTo(x + w, y, x + w, y + rr, rr);
    c.lineTo(x + w, y + h - rr);
    c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    c.lineTo(x + rr, y + h);
    c.arcTo(x, y + h, x, y + h - rr, rr);
    c.lineTo(x, y + rr);
    c.arcTo(x, y, x + rr, y, rr);
    c.closePath();
  }

  function makeSprite(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    return { c, x };
  }

  const snap = (v) => Math.round(v * dpr) / dpr;
  let scene = null;

  function getScene(isDark) {
    const W = canvasWidth;
    const H = canvasHeight;
    const key = `${isDark}|${W}|${H}|${dpr}`;
    if (scene && scene.key === key) return scene;

    const C = isDark
      ? { bg: '#0B0B0C', dot: 'rgba(255,255,255,0.07)', surface: '#141416', surface2: '#1c1c20', border: 'rgba(255,255,255,0.16)',
          text: '#F2F2F0', muted: 'rgba(255,255,255,0.38)', accent: '#4D6DFF', green: '#10B981', editor: '#0d0f14',
          shadow: 'rgba(0,0,0,0.55)', glow: 'rgba(77,109,255,0.16)',
          code: { tag: '#ff7b72', attr: '#79c0ff', str: '#a5d6ff', prop: '#d2a8ff', val: '#ffa657', plain: '#e6e6e6' } }
      : { bg: '#FAFAF8', dot: 'rgba(0,0,0,0.07)', surface: '#FFFFFF', surface2: '#F1F1EE', border: 'rgba(0,0,0,0.16)',
          text: '#111111', muted: 'rgba(0,0,0,0.34)', accent: '#2B4BFF', green: '#0F9D74', editor: '#F4F5F9',
          shadow: 'rgba(0,0,0,0.16)', glow: 'rgba(43,75,255,0.09)',
          code: { tag: '#cf222e', attr: '#0550ae', str: '#0a3069', prop: '#8250df', val: '#953800', plain: '#24292f' } };

    const small = W < 600;
    const topPad = 96; // clears the fixed site header
    const areaBottom = H * (small ? 0.54 : 0.49);
    const availH = Math.max(170, areaBottom - topPad);
    const winW = Math.min(W * 0.92, small ? 360 : 600);
    const winH = Math.min(availH, winW * 0.72);
    const winX0 = (W - winW) / 2;
    const winY = topPad;
    const barH = 28;
    const cw = winW - 24;
    const ch = winH - barH - 18;
    const fs = small ? 10.5 : 12;
    const phW = small ? 86 : 104;
    const phH = Math.min(phW * 2.0, winH * 1.02);

    // ---- Background: flat colour + soft glow + dotted grid (drifts with scroll) ----
    const bg = makeSprite(W, H + GRID);
    bg.x.fillStyle = C.bg;
    bg.x.fillRect(0, 0, W, H + GRID);
    const glow = bg.x.createRadialGradient(W / 2, winY + winH / 2 + GRID, 10, W / 2, winY + winH / 2 + GRID, Math.max(W * 0.7, winH));
    glow.addColorStop(0, C.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    bg.x.fillStyle = glow;
    bg.x.fillRect(0, 0, W, H + GRID);
    bg.x.fillStyle = C.dot;
    for (let x = GRID / 2; x < W; x += GRID) {
      for (let y = 0; y < H + GRID; y += GRID) bg.x.fillRect(x, y, 1.5, 1.5);
    }

    // ---- Browser window shell with its (expensive) shadow baked in ----
    const win = makeSprite(winW + SPRITE_PAD * 2, winH + SPRITE_PAD * 2);
    const wx = win.x;
    wx.save();
    wx.shadowColor = C.shadow;
    wx.shadowBlur = 30;
    wx.shadowOffsetY = 12;
    rrectOn(wx, SPRITE_PAD, SPRITE_PAD, winW, winH, 12);
    wx.fillStyle = C.surface;
    wx.fill();
    wx.restore();
    rrectOn(wx, SPRITE_PAD, SPRITE_PAD, winW, winH, 12);
    wx.strokeStyle = C.border;
    wx.lineWidth = 1;
    wx.stroke();
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      wx.beginPath();
      wx.arc(SPRITE_PAD + 16 + i * 14, SPRITE_PAD + barH / 2, 4, 0, Math.PI * 2);
      wx.fillStyle = col;
      wx.fill();
    });
    const pillW = Math.min(winW * 0.5, 210);
    rrectOn(wx, SPRITE_PAD + (winW - pillW) / 2, SPRITE_PAD + 6, pillW, barH - 12, 8);
    wx.fillStyle = C.surface2;
    wx.fill();

    // Shared page layout in content-local coordinates
    const R = (fx, fy, fw, fh) => [fx * cw, fy * ch, fw * cw, fh * ch];
    const layout = [
      { k: 'nav', r: R(0, 0, 1, 0.11) },
      { k: 'logo', r: R(0.03, 0.03, 0.1, 0.05) },
      { k: 'link', r: R(0.62, 0.045, 0.1, 0.02) },
      { k: 'link', r: R(0.75, 0.045, 0.1, 0.02) },
      { k: 'link', r: R(0.88, 0.045, 0.08, 0.02) },
      { k: 'h1', r: R(0.04, 0.2, 0.5, 0.07) },
      { k: 'h1', r: R(0.04, 0.3, 0.36, 0.07) },
      { k: 'sub', r: R(0.04, 0.42, 0.44, 0.03) },
      { k: 'sub', r: R(0.04, 0.48, 0.34, 0.03) },
      { k: 'btn', r: R(0.04, 0.58, 0.2, 0.09) },
      { k: 'img', r: R(0.6, 0.18, 0.36, 0.5) },
      { k: 'card', r: R(0.04, 0.76, 0.29, 0.22) },
      { k: 'card', r: R(0.355, 0.76, 0.29, 0.22) },
      { k: 'card', r: R(0.67, 0.76, 0.29, 0.22) }
    ];

    // ---- Wireframe sprite (dashed outlines) ----
    const wire = makeSprite(cw, ch);
    wire.x.setLineDash([5, 4]);
    wire.x.lineWidth = 1.2;
    wire.x.strokeStyle = C.muted;
    layout.forEach((el) => {
      const [x, y, w, h] = el.r;
      rrectOn(wire.x, x, y, w, h, 4);
      wire.x.stroke();
      if (el.k === 'img') {
        wire.x.beginPath();
        wire.x.moveTo(x, y); wire.x.lineTo(x + w, y + h);
        wire.x.moveTo(x + w, y); wire.x.lineTo(x, y + h);
        wire.x.stroke();
      }
    });

    // ---- Finished page sprite ----
    const page = makeSprite(cw, ch);
    const px = page.x;
    rrectOn(px, 0, 0, cw, ch, 6);
    px.fillStyle = C.surface;
    px.fill();
    layout.forEach((el) => {
      const [x, y, w, h] = el.r;
      switch (el.k) {
        case 'nav': px.fillStyle = C.surface2; px.fillRect(x, y, w, h); break;
        case 'logo': rrectOn(px, x, y, w, h, 4); px.fillStyle = C.accent; px.fill(); break;
        case 'link': rrectOn(px, x, y, w, h, h / 2); px.fillStyle = C.muted; px.fill(); break;
        case 'h1': rrectOn(px, x, y, w, h, h / 2.2); px.fillStyle = C.text; px.fill(); break;
        case 'sub': rrectOn(px, x, y, w, h, h / 2); px.fillStyle = C.muted; px.fill(); break;
        case 'btn':
          rrectOn(px, x, y, w, h, h / 2); px.fillStyle = C.accent; px.fill();
          rrectOn(px, x + w * 0.25, y + h * 0.4, w * 0.5, h * 0.2, h * 0.1); px.fillStyle = '#fff'; px.fill();
          break;
        case 'img': {
          const g = px.createLinearGradient(x, y, x + w, y + h);
          g.addColorStop(0, C.accent); g.addColorStop(1, C.green);
          rrectOn(px, x, y, w, h, 8); px.fillStyle = g; px.fill();
          break;
        }
        case 'card':
          rrectOn(px, x, y, w, h, 6); px.fillStyle = C.surface2; px.fill();
          px.beginPath(); px.arc(x + 12, y + 12, 5, 0, Math.PI * 2); px.fillStyle = C.accent; px.fill();
          rrectOn(px, x + 8, y + h * 0.55, w * 0.6, 4, 2); px.fillStyle = C.muted; px.fill();
          break;
        default: break;
      }
    });

    // ---- Phone sprite (responsive view) with its shadow baked in ----
    const phone = makeSprite(phW + SPRITE_PAD * 2, phH + SPRITE_PAD * 2);
    const hx = phone.x;
    hx.save();
    hx.shadowColor = C.shadow;
    hx.shadowBlur = 24;
    hx.shadowOffsetY = 10;
    rrectOn(hx, SPRITE_PAD, SPRITE_PAD, phW, phH, 14);
    hx.fillStyle = C.surface;
    hx.fill();
    hx.restore();
    rrectOn(hx, SPRITE_PAD, SPRITE_PAD, phW, phH, 14);
    hx.strokeStyle = C.border;
    hx.lineWidth = 1.5;
    hx.stroke();
    rrectOn(hx, SPRITE_PAD + phW / 2 - 12, SPRITE_PAD + 6, 24, 4, 2);
    hx.fillStyle = C.border;
    hx.fill();
    const ix = SPRITE_PAD + 8;
    const iw = phW - 16;
    let iy = SPRITE_PAD + 18;
    rrectOn(hx, ix, iy, iw, 10, 3); hx.fillStyle = C.surface2; hx.fill();
    rrectOn(hx, ix + 3, iy + 3, 10, 4, 2); hx.fillStyle = C.accent; hx.fill();
    iy += 18;
    rrectOn(hx, ix, iy, iw * 0.9, 7, 3.5); hx.fillStyle = C.text; hx.fill(); iy += 12;
    rrectOn(hx, ix, iy, iw * 0.65, 7, 3.5); hx.fillStyle = C.text; hx.fill(); iy += 14;
    rrectOn(hx, ix, iy, iw * 0.8, 3, 1.5); hx.fillStyle = C.muted; hx.fill(); iy += 8;
    rrectOn(hx, ix, iy, iw * 0.6, 3, 1.5); hx.fillStyle = C.muted; hx.fill(); iy += 12;
    rrectOn(hx, ix, iy, iw * 0.55, 14, 7); hx.fillStyle = C.accent; hx.fill(); iy += 22;
    const g2 = hx.createLinearGradient(ix, iy, ix + iw, iy + 40);
    g2.addColorStop(0, C.accent); g2.addColorStop(1, C.green);
    const imgH = Math.max(18, Math.min(44, SPRITE_PAD + phH - iy - 40));
    rrectOn(hx, ix, iy, iw, imgH, 6); hx.fillStyle = g2; hx.fill(); iy += imgH + 8;
    if (iy + 14 < SPRITE_PAD + phH - 6) { rrectOn(hx, ix, iy, iw, 14, 4); hx.fillStyle = C.surface2; hx.fill(); }

    // Text metrics measured once
    ctx.font = `${fs}px ${MONO}`;
    const charW = ctx.measureText('M').width;
    ctx.font = `10px ${MONO}`;
    const addrHalf = ctx.measureText('elliotlano.dev').width / 2;

    scene = { key, C, small, winW, winH, winX0, winY, barH, cw, ch, fs, phW, phH, charW, addrHalf, bg, win, wire, page, phone };
    return scene;
  }

  function drawProcedural(progress) {
    const W = canvasWidth;
    const H = canvasHeight;
    if (!W || !H) return;

    const p = clamp01(progress);
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const S = getScene(isDark);
    const { C, small, winW, winH, winY, barH, cw, ch, fs } = S;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;

    // Background (cached) drifting with scroll
    ctx.drawImage(S.bg.c, 0, snap((p * 70) % GRID - GRID), W, H + GRID);

    // Window (cached shell)
    const shift = small ? 0 : 70 * smooth(0.68, 0.8, p);
    const winX = S.winX0 - shift;
    ctx.drawImage(S.win.c, snap(winX - SPRITE_PAD), snap(winY - SPRITE_PAD), winW + SPRITE_PAD * 2, winH + SPRITE_PAD * 2);

    // Address label
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.muted;
    ctx.fillText(p < 0.34 ? 'wireframe.fig' : p < 0.67 ? 'index.html' : 'elliotlano.dev', winX + winW / 2, winY + barH / 2 + 0.5);
    if (p > 0.9) {
      // "live" dot
      ctx.beginPath();
      ctx.arc(winX + winW / 2 - S.addrHalf - 8, winY + barH / 2, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = C.green;
      ctx.fill();
    }
    ctx.textAlign = 'left';

    // Content area
    const cx = winX + 12;
    const cy = winY + barH + 8;
    const aWire = 1 - smooth(0.3, 0.37, p);
    const aCode = smooth(0.3, 0.37, p) * (1 - smooth(0.64, 0.71, p));
    const aPage = smooth(0.64, 0.71, p);

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.clip();

    // 1) Wireframe: scanned into place top to bottom by an accent scan line
    if (aWire > 0.01) {
      const t = clamp01(p / 0.27);
      const revealH = t * ch * 1.04;
      ctx.globalAlpha = aWire;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, cw, Math.min(ch, revealH));
      ctx.clip();
      ctx.drawImage(S.wire.c, cx, cy, cw, ch);
      ctx.restore();
      if (t < 0.98) {
        const sy = cy + revealH;
        const band = ctx.createLinearGradient(0, sy - 26, 0, sy);
        band.addColorStop(0, 'rgba(0,0,0,0)');
        band.addColorStop(1, isDark ? 'rgba(77,109,255,0.22)' : 'rgba(43,75,255,0.14)');
        ctx.fillStyle = band;
        ctx.fillRect(cx, sy - 26, cw, 26);
        ctx.fillStyle = C.accent;
        ctx.fillRect(cx, sy - 1, cw, 2);
      }
    }

    // 2) Code editor
    if (aCode > 0.01) {
      ctx.globalAlpha = aCode;
      rrectOn(ctx, cx, cy, cw, ch, 6);
      ctx.fillStyle = C.editor;
      ctx.fill();
      const gutter = 26;
      const lh = Math.min(fs * 1.75, (ch - 18) / CODE_LINES.length);
      ctx.font = `${fs}px ${MONO}`;
      ctx.textBaseline = 'middle';
      let budget = Math.floor(clamp01((p - 0.35) / 0.28) * CODE_TOTAL);
      let lastX = cx + gutter;
      let lastY = cy + 14;
      for (let li = 0; li < CODE_LINES.length; li++) {
        if (budget <= 0) break;
        const y = cy + 14 + li * lh;
        ctx.fillStyle = C.muted;
        ctx.fillText(String(li + 1), cx + 8, y);
        let x = cx + gutter;
        for (const [txt, kind] of CODE_LINES[li]) {
          if (budget <= 0) break;
          const part = txt.length > budget ? txt.slice(0, budget) : txt;
          budget -= part.length;
          ctx.fillStyle = C.code[kind];
          ctx.fillText(part, x, y);
          x += part.length * S.charW;
        }
        lastX = x;
        lastY = y;
      }
      if (p < 0.66) {
        ctx.fillStyle = C.accent;
        ctx.fillRect(lastX + 1, lastY - fs / 2, 1.6, fs);
      }
    }

    // 3) Finished page (cached)
    if (aPage > 0.01) {
      ctx.globalAlpha = aPage;
      ctx.drawImage(S.page.c, cx, cy, cw, ch);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Phone (cached) slides up and fades in
    const tPhone = smooth(0.7, 0.82, p);
    if (tPhone > 0.01) {
      const phX = winX + winW - S.phW * (small ? 0.62 : 0.3);
      const phY = winY + winH - S.phH + (small ? 22 : 18) + (1 - tPhone) * 36;
      ctx.globalAlpha = tPhone;
      ctx.drawImage(S.phone.c, snap(phX - SPRITE_PAD), snap(phY - SPRITE_PAD), S.phW + SPRITE_PAD * 2, S.phH + SPRITE_PAD * 2);
      ctx.globalAlpha = 1;
    }

    // Scores row
    const tScore = smooth(0.82, 0.97, p);
    if (tScore > 0.01) {
      const r = small ? 14 : 17;
      const gap = small ? 20 : 30;
      const labels = ['Perf', 'A11y', 'SEO', 'Best'];
      const total = labels.length * r * 2 + (labels.length - 1) * gap;
      const sx = (W - total) / 2 - shift * 0.9;
      const sy = winY + winH + 26 + r;
      ctx.font = `600 ${small ? 9 : 10}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.globalAlpha = Math.min(1, tScore * 3);
      labels.forEach((label, i) => {
        const x = sx + r + i * (r * 2 + gap);
        const a = smooth(i * 0.12, i * 0.12 + 0.55, tScore);
        ctx.strokeStyle = C.surface2;
        ctx.beginPath(); ctx.arc(x, sy, r, 0, Math.PI * 2); ctx.stroke();
        if (a > 0.001) {
          ctx.strokeStyle = C.green;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(x, sy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a); ctx.stroke();
          ctx.lineCap = 'butt';
        }
        ctx.fillStyle = C.green;
        ctx.fillText(String(Math.round(100 * a)), x, sy + 0.5);
        ctx.fillStyle = C.muted;
        ctx.fillText(label, x, sy + r + 12);
      });
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
        const isLast = idx === captions.length - 1;
        // The final caption stays fully visible once the animation completes
        const holdLast = isLast && progress > mid;
        const opacity = holdLast ? 1 : Math.min(1, normDist * 1.5);
        const translateY = holdLast ? 0 : (1 - normDist) * 20;

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
  const effectiveSmoothing = lenisInstance ? 0.5 : (smoothing || 0.2);

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

      if (hasFallbackMode) {
        // Procedural scene: use the continuous (un-quantised) progress so motion is smooth
        const smoothProgress = Math.max(0, Math.min(1, currentFrame / (activeCount - 1)));
        if (Math.abs(smoothProgress - lastSmoothProgress) > 0.0002 || smoothProgress === 0 || smoothProgress === 1) {
          lastSmoothProgress = smoothProgress;
          drawProcedural(smoothProgress);
          lastDrawnFrame = frameIdx;
          syncUI(smoothProgress, frameIdx);
        }
      } else if (frameIdx !== lastDrawnFrame) {
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
    // The canvas now draws a procedural web-development scene, so no image frames are needed.
    if (config.useFrames !== true) {
      hasFallbackMode = true;
      drawFrame(0, true);
      syncUI(0, 0);
      reportPreloadProgress(1);
      return;
    }

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
          img.onload = async () => {
            try {
              if (img.decode) {
                await img.decode();
              }
            } catch {
              // Ignore decode rejection
            }
            images[idx] = img;
            loadedCount++;
            reportPreloadProgress();
            resolve();
          };
          img.onerror = () => {
            resolve();
          };
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

  // Exact on-screen check (no margin): switch off full-screen blur/grain layers only while
  // the animated canvas is actually visible, because they re-blend on every canvas frame.
  const visibleObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      document.documentElement.classList.toggle('seq-active', entry.isIntersecting);
    });
  }, { threshold: [0], rootMargin: '-2px 0px -2px 0px' });
  visibleObserver.observe(wrapper);

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
      visibleObserver.disconnect();
      document.documentElement.classList.remove('seq-active');
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
