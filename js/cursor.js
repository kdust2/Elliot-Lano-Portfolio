/**
 * @file cursor.js
 * Custom magnetic cursor (dot + trailing ring) for desktop pointer devices
 */

export function initCursor() {
  const isFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!isFinePointer) return;

  const dot = document.querySelector('.cursor-dot');
  const ring = document.querySelector('.cursor-ring');
  if (!dot || !ring) return;

  let mouseX = -100;
  let mouseY = -100;
  let ringX = -100;
  let ringY = -100;
  let isHovered = false;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    dot.style.opacity = '1';
    ring.style.opacity = '1';
    dot.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
  });

  document.addEventListener('mouseleave', () => {
    dot.style.opacity = '0';
    ring.style.opacity = '0';
  });

  // Smooth trailing ring loop
  function updateRing() {
    ringX += (mouseX - ringX) * 0.16;
    ringY += (mouseY - ringY) * 0.16;

    ring.style.transform = `translate(${ringX}px, ${ringY}px)`;
    requestAnimationFrame(updateRing);
  }
  requestAnimationFrame(updateRing);

  // Hover triggers for links, buttons, cards, images
  function bindHoverTriggers() {
    const targets = document.querySelectorAll('a, button, input, textarea, .project-card, .service-card, canvas');
    targets.forEach((target) => {
      target.addEventListener('mouseenter', () => {
        ring.classList.add('active');
        isHovered = true;
      });
      target.addEventListener('mouseleave', () => {
        ring.classList.remove('active');
        isHovered = false;
      });
    });
  }

  bindHoverTriggers();

  // Re-bind when dynamic DOM updates occur
  window.addEventListener('rebindcursor', bindHoverTriggers);
}
