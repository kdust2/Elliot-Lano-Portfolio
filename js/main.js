/**
 * @file main.js
 * Master Application Orchestrator for Elliot Lano Portfolio
 */

import { initTheme } from './theme.js';
import { initScroll, getLenis } from './scroll.js';
import { initSequence } from './sequence.js';
import { initAnimations } from './animations.js';
import { initCursor } from './cursor.js';
import { initPageTransitions } from './transitions.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Color Theme
  initTheme();

  // 2. Initialize Smooth Scrolling
  const lenis = initScroll();

  // 3. Initialize Custom Desktop Cursor
  initCursor();

  // 4. Initialize Scroll-Driven Frame Sequence (Home page)
  const sequenceCanvas = document.getElementById('sequence-canvas');
  const sequenceWrapper = document.getElementById('sequence-wrapper');
  let sequenceInstance = null;

  if (sequenceCanvas && sequenceWrapper) {
    sequenceInstance = initSequence({
      canvas: sequenceCanvas,
      wrapper: sequenceWrapper,
      lenis: lenis,
      path: 'frames/frame_',
      ext: '.webp',
      digits: 4,
      frameCount: 120,
      mobilePath: 'frames/mobile/frame_',
      mobileFrameCount: 60,
      smoothing: 0.12,
      captions: [
        { from: 0.05, to: 0.32, el: document.getElementById('seq-caption-1') },
        { from: 0.38, to: 0.65, el: document.getElementById('seq-caption-2') },
        { from: 0.71, to: 1.01, el: document.getElementById('seq-caption-3') }
      ],
      onPreloadProgress: (ratio) => {
        if (typeof window.updatePreloader === 'function') window.updatePreloader(ratio);
      }
    });
  }

  // 5. Initialize Preloader
  initPreloader(!!sequenceCanvas);

  // 6. Initialize Animations
  initAnimations();

  // 7. Initialize Page Transitions
  initPageTransitions();

  // 8. Initialize Mobile Menu Drawer
  initMobileMenu();

  // 9. Initialize Active Nav Link
  highlightActiveNav();

  // 10. Initialize Contact Form Validation (if present)
  initContactForm();

  // 11. Initialize Back to Top
  initBackToTop(lenis);
});

/**
 * Preloader lifecycle tied to frame sequence preloading
 */
function initPreloader(hasSequence) {
  const preloader = document.getElementById('preloader');
  const percentEl = document.querySelector('.preloader-percent');
  const barFill = document.querySelector('.preloader-bar-fill');

  if (!preloader) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    preloader.style.display = 'none';
    return;
  }

  let currentPercent = 0;
  let targetPercent = 0;
  let isDone = false;

  // Lock scrolling while the preloader curtain is up
  getLenis()?.stop();

  function setVisualPercent(val) {
    if (percentEl) percentEl.textContent = `${Math.round(val)}%`;
    if (barFill) barFill.style.width = `${Math.min(100, Math.round(val))}%`;
  }

  window.updatePreloader = function (ratio) {
    if (isDone) return;
    targetPercent = Math.min(100, Math.round(ratio * 100));

    // When at least 30% frames loaded, unlock the hero
    if (ratio >= 0.3) {
      targetPercent = 100;
    }
  };

  const ticker = setInterval(() => {
    if (currentPercent < targetPercent) {
      currentPercent += Math.ceil((targetPercent - currentPercent) * 0.25) || 1;
      setVisualPercent(currentPercent);
    }

    if (currentPercent >= 100 && !isDone) {
      isDone = true;
      clearInterval(ticker);
      setTimeout(() => {
        preloader.classList.add('loaded');
        document.body.classList.remove('loading');
        getLenis()?.start();
      }, 250);
    }
  }, 30);

  // Fallback safety timeout if frames take long or page doesn't have sequence
  // The canvas scene is drawn procedurally (no image frames to download), so keep the curtain short
  const safetyTimeout = hasSequence ? 700 : 450;
  setTimeout(() => {
    if (!isDone) {
      targetPercent = 100;
    }
  }, safetyTimeout);
}

/**
 * Mobile Navigation Drawer
 */
function initMobileMenu() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const drawer = document.getElementById('mobile-drawer');

  if (!menuBtn || !drawer) return;

  function toggleMenu() {
    const isOpen = drawer.classList.contains('open');
    if (isOpen) {
      drawer.classList.remove('open');
      menuBtn.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      getLenis()?.start();
    } else {
      drawer.classList.add('open');
      menuBtn.classList.add('open');
      menuBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      getLenis()?.stop();
    }
  }

  menuBtn.addEventListener('click', toggleMenu);

  // Close drawer on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) {
      toggleMenu();
    }
  });

  // Close when clicking inside drawer links
  drawer.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      if (drawer.classList.contains('open')) {
        toggleMenu();
      }
    });
  });
}

/**
 * Mark active navigation link
 */
function highlightActiveNav() {
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.nav-link, .mobile-drawer-link');

  navLinks.forEach((link) => {
    link.classList.remove('active');
    link.removeAttribute('aria-current');

    const href = link.getAttribute('href');
    if (!href) return;
    const linkPath = href.split('/').pop();

    if (linkPath === currentPath || (currentPath === '' && linkPath === 'index.html')) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
}

/**
 * Contact Form validation and submission
 */
function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const waBtn = document.getElementById('whatsapp-send-btn');
  if (waBtn) {
    waBtn.addEventListener('click', () => {
      const name = document.getElementById('contact-name');
      const message = document.getElementById('contact-message');
      const nameError = document.getElementById('name-error');
      const messageError = document.getElementById('message-error');
      const nameOk = !!name.value.trim();
      const msgOk = message.value.trim().length >= 10;
      nameError?.classList.toggle('visible', !nameOk);
      messageError?.classList.toggle('visible', !msgOk);
      if (!nameOk || !msgOk) return;
      const text = encodeURIComponent(`Hi Elliot, I'm ${name.value.trim()}.\n\n${message.value.trim()}`);
      window.open(`https://wa.me/233591260963?text=${text}`, '_blank', 'noopener');
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const nameInput = document.getElementById('contact-name');
    const emailInput = document.getElementById('contact-email');
    const messageInput = document.getElementById('contact-message');

    const nameError = document.getElementById('name-error');
    const emailError = document.getElementById('email-error');
    const messageError = document.getElementById('message-error');
    const formStatus = document.getElementById('form-status');

    let isValid = true;

    // Validate Name
    if (!nameInput.value.trim()) {
      nameError?.classList.add('visible');
      isValid = false;
    } else {
      nameError?.classList.remove('visible');
    }

    // Validate Email
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(emailInput.value.trim())) {
      emailError?.classList.add('visible');
      isValid = false;
    } else {
      emailError?.classList.remove('visible');
    }

    // Validate Message
    if (!messageInput.value.trim() || messageInput.value.trim().length < 10) {
      messageError?.classList.add('visible');
      isValid = false;
    } else {
      messageError?.classList.remove('visible');
    }

    if (!isValid) return;

    // Mailto fallback dispatch
    const subject = encodeURIComponent(`Project Inquiry from ${nameInput.value.trim()}`);
    const body = encodeURIComponent(
      `Name: ${nameInput.value.trim()}\nEmail: ${emailInput.value.trim()}\n\nMessage:\n${messageInput.value.trim()}`
    );
    const mailtoUrl = `mailto:lanoelliot@gmail.com?subject=${subject}&body=${body}`;

    if (formStatus) {
      formStatus.textContent = 'Opening your email client to send message...';
      formStatus.className = 'form-status success';
    }

    setTimeout(() => {
      window.location.href = mailtoUrl;
    }, 400);
  });
}

/**
 * Back to top button
 */
function initBackToTop(lenis) {
  const backToTopBtn = document.getElementById('back-to-top-btn');
  if (!backToTopBtn) return;

  backToTopBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (lenis) {
      lenis.scrollTo(0, { duration: 1.2 });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}
