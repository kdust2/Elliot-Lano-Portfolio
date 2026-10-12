/**
 * @file animations.js
 * Cinematic Scroll-Reveal Animations, Kinetic Marquee, and Magnetic Interactions
 */

export function initAnimations() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  const hasGsap = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

  if (hasGsap) {
    const gsap = window.gsap;
    const ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);

    initGsapReveals(gsap, ScrollTrigger);
  } else {
    initIntersectionFallback();
  }

  initMagneticButtons();
}

/**
 * GSAP ScrollTrigger Section & Element Reveals
 */
function initGsapReveals(gsap, ScrollTrigger) {
  // 1. Hero headline line/word masked reveal
  const heroLines = document.querySelectorAll('.hero-title, .hero-subtitle, .hero-actions, .hero-eyebrow');
  if (heroLines.length > 0) {
    gsap.from(heroLines, {
      y: 40,
      opacity: 0,
      duration: 1.1,
      stagger: 0.15,
      ease: 'power3.out',
      delay: 0.2
    });
  }

  // 2. Section headers scroll reveal
  const headers = document.querySelectorAll('.section-header');
  headers.forEach((header) => {
    gsap.from(header.children, {
      scrollTrigger: {
        trigger: header,
        start: 'top 85%',
        once: true
      },
      y: 35,
      opacity: 0,
      duration: 0.9,
      stagger: 0.12,
      ease: 'power3.out'
    });
  });

  // 3. Project cards staggered entrance with image clip-path wipe
  const projectCards = document.querySelectorAll('.project-card');
  projectCards.forEach((card) => {
    const img = card.querySelector('.project-mockup-img');

    gsap.from(card, {
      scrollTrigger: {
        trigger: card,
        start: 'top 85%',
        once: true
      },
      y: 50,
      opacity: 0,
      duration: 1,
      ease: 'power3.out'
    });

    if (img) {
      gsap.fromTo(
        img,
        { scale: 1.15, clipPath: 'inset(15% 0% 15% 0%)' },
        {
          scrollTrigger: {
            trigger: card,
            start: 'top 80%',
            once: true
          },
          scale: 1,
          clipPath: 'inset(0% 0% 0% 0%)',
          duration: 1.2,
          ease: 'power3.out'
        }
      );
    }
  });

  // 4. Case study browser mockup frame reveal
  const caseFrames = document.querySelectorAll('.case-browser-frame');
  caseFrames.forEach((frame) => {
    gsap.from(frame, {
      scrollTrigger: {
        trigger: frame,
        start: 'top 80%',
        once: true
      },
      y: 60,
      opacity: 0,
      duration: 1.2,
      ease: 'power3.out'
    });
  });

  // 5. Service cards and Process steps stagger
  const grids = document.querySelectorAll('.services-grid, .process-grid, .contact-grid, .about-grid');
  grids.forEach((grid) => {
    gsap.from(grid.children, {
      scrollTrigger: {
        trigger: grid,
        start: 'top 82%',
        once: true
      },
      y: 40,
      opacity: 0,
      duration: 0.9,
      stagger: 0.15,
      ease: 'power3.out'
    });
  });

  // 6. Timeline items reveal
  const timelineItems = document.querySelectorAll('.timeline-item');
  timelineItems.forEach((item) => {
    gsap.from(item, {
      scrollTrigger: {
        trigger: item,
        start: 'top 85%',
        once: true
      },
      x: -30,
      opacity: 0,
      duration: 0.8,
      ease: 'power3.out'
    });
  });
}

/**
 * Infinite Skills Marquee reacting to scroll velocity
 */
function initVelocityMarquee(gsap, ScrollTrigger) {
  const marqueeTrack = document.querySelector('.marquee-track');
  if (!marqueeTrack) return;

  // Duplicate content to ensure seamless loop
  marqueeTrack.innerHTML += marqueeTrack.innerHTML;

  let currentPos = 0;
  let baseSpeed = 0.8;
  let scrollVelocity = 0;

  // Track scroll velocity via ScrollTrigger
  ScrollTrigger.create({
    onUpdate: (self) => {
      scrollVelocity = self.getVelocity() / 300;
    }
  });

  function animate() {
    // Lerp velocity back to 0
    scrollVelocity *= 0.92;
    const speed = baseSpeed + Math.abs(scrollVelocity);

    currentPos -= speed;
    const halfWidth = marqueeTrack.scrollWidth / 2;
    if (Math.abs(currentPos) >= halfWidth) {
      currentPos = 0;
    }

    marqueeTrack.style.transform = `translateX(${currentPos}px)`;
    requestAnimationFrame(animate);
  }

  animate();
}

/**
 * Magnetic button micro-interaction on desktop
 */
function initMagneticButtons() {
  if (window.matchMedia('(pointer: coarse)').matches) return;

  const magneticElements = document.querySelectorAll('.btn-primary, .theme-toggle-btn, .brand-monogram');

  magneticElements.forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - (rect.left + rect.width / 2);
      const y = e.clientY - (rect.top + rect.height / 2);

      el.style.transform = `translate(${x * 0.22}px, ${y * 0.22}px)`;
    });

    el.addEventListener('mouseleave', () => {
      el.style.transform = 'translate(0px, 0px)';
      el.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
    });

    el.addEventListener('mouseenter', () => {
      el.style.transition = 'none';
    });
  });
}

/**
 * Native IntersectionObserver fallback if GSAP is unavailable
 */
function initIntersectionFallback() {
  const revealElements = document.querySelectorAll(
    '.section-header, .project-card, .service-card, .process-step, .timeline-item, .contact-form'
  );

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  revealElements.forEach((el) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
    observer.observe(el);
  });
}
