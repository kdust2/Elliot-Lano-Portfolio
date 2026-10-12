/**
 * @file transitions.js
 * Cinematic Page Transitions between multi-page HTML documents
 */

export function initPageTransitions() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  // Intercept internal page navigations
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    // Skip special clicks
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (link.getAttribute('target') === '_blank') return;

    const href = link.getAttribute('href');
    if (!href) return;

    // Skip in-page anchors, tel:, mailto:
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

    // Check if same origin and internal page
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;

      // Allow hash changes on same page
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      e.preventDefault();
      runExitTransition(url.href);
    } catch {
      // Fall through to normal browser navigation
    }
  });

  // Handle entry animation when page opens
  runEntryTransition();
}

function runEntryTransition() {
  const overlay = document.getElementById('transition-curtain');
  if (!overlay) return;

  // Fade/slide away
  overlay.style.transform = 'translateY(100%)';
  overlay.style.transition = 'transform 0.5s cubic-bezier(0.8, 0, 0.2, 1)';
  setTimeout(() => {
    overlay.style.display = 'none';
  }, 550);
}

function runExitTransition(destinationUrl) {
  let overlay = document.getElementById('transition-curtain');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'transition-curtain';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.backgroundColor = 'var(--bg-primary)';
    overlay.style.zIndex = '999999';
    overlay.style.transform = 'translateY(-100%)';
    overlay.style.pointerEvents = 'auto';
    document.body.appendChild(overlay);
  }

  overlay.style.display = 'block';
  // Force reflow
  void overlay.offsetHeight;

  overlay.style.transition = 'transform 0.45s cubic-bezier(0.8, 0, 0.2, 1)';
  overlay.style.transform = 'translateY(0%)';

  setTimeout(() => {
    window.location.href = destinationUrl;
  }, 450);
}
