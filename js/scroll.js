/**
 * @file scroll.js
 * Lenis Smooth Scrolling engine synchronized with GSAP ScrollTrigger
 */

let lenisInstance = null;

export function initScroll() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // If user requested reduced motion, bypass Lenis inertia
  if (prefersReducedMotion) {
    document.documentElement.style.scrollBehavior = 'auto';
    initAnchorLinks(null);
    return null;
  }

  // Check if Lenis is loaded via CDN
  if (typeof window.Lenis === 'function') {
    lenisInstance = new window.Lenis({
      duration: 1.0,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Eased inertia
      lerp: 0.1,
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.0,
      infinite: false
    });

    // Synchronize Lenis with GSAP ScrollTrigger ticker if GSAP is available
    if (window.gsap && window.ScrollTrigger) {
      window.gsap.registerPlugin(window.ScrollTrigger);

      lenisInstance.on('scroll', window.ScrollTrigger.update);

      window.gsap.ticker.add((time) => {
        lenisInstance.raf(time * 1000);
      });

      // Smooth lag compensation (do not set to 0, which induces frame-drop stutter)
      window.gsap.ticker.lagSmoothing(500, 33);
    } else {
      // Standalone rAF loop for Lenis
      function raf(time) {
        lenisInstance.raf(time);
        requestAnimationFrame(raf);
      }
      requestAnimationFrame(raf);
    }
  } else {
    // Fallback: native smooth scroll
    document.documentElement.style.scrollBehavior = 'smooth';
  }

  initAnchorLinks(lenisInstance);
  initScrollProgressBar(lenisInstance);

  return lenisInstance;
}

export function getLenis() {
  return lenisInstance;
}

/**
 * Handle in-page anchor links with sticky header offset
 */
function initAnchorLinks(lenis) {
  const headerHeight = 80;

  document.addEventListener('click', (e) => {
    const targetLink = e.target.closest('a[href^="#"]');
    if (!targetLink) return;

    const href = targetLink.getAttribute('href');
    if (!href || href === '#') return;

    const targetElement = document.querySelector(href);
    if (!targetElement) return;

    e.preventDefault();

    if (lenis) {
      lenis.scrollTo(targetElement, {
        offset: -headerHeight,
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t))
      });
    } else {
      const elementPosition = targetElement.getBoundingClientRect().top + window.pageYOffset;
      const offsetPosition = elementPosition - headerHeight;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }

    // Close mobile drawer if open
    const drawer = document.getElementById('mobile-drawer');
    const menuBtn = document.getElementById('mobile-menu-btn');
    if (drawer && drawer.classList.contains('open')) {
      drawer.classList.remove('open');
      menuBtn?.classList.remove('open');
    }
  });
}

/**
 * Update top scroll progress bar
 */
function initScrollProgressBar(lenis) {
  const progressBar = document.getElementById('scroll-progress');
  if (!progressBar) return;

  function updateProgress() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  }

  if (lenis) {
    lenis.on('scroll', updateProgress);
  } else {
    window.addEventListener('scroll', updateProgress, { passive: true });
  }
  updateProgress();
}
