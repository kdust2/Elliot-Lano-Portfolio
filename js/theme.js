/**
 * @file theme.js
 * Theme Controller: Dark Mode / Light Mode with View Transitions API & LocalStorage
 */

export function initTheme() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  const themeIcon = document.getElementById('theme-toggle-icon');

  function getPreferredTheme() {
    try {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
      }
    } catch {
      // LocalStorage access restricted
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateIcon(theme) {
    if (!themeIcon) return;
    if (theme === 'dark') {
      // Sun icon when currently in dark mode (click to switch to light)
      themeIcon.innerHTML = `
        <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      `;
    } else {
      // Moon icon when currently in light mode (click to switch to dark)
      themeIcon.innerHTML = `
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      `;
    }
  }

  function setTheme(theme, triggerTransition = false, event = null) {
    const apply = () => {
      document.documentElement.setAttribute('data-theme', theme);
      try {
        localStorage.setItem('theme', theme);
      } catch {
        // Ignored
      }
      updateIcon(theme);
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
      }
      window.dispatchEvent(new CustomEvent('themechanged', { detail: { theme } }));
    };

    // Circular reveal animation with View Transitions API if supported
    if (triggerTransition && document.startViewTransition && event) {
      const x = event.clientX;
      const y = event.clientY;
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      const transition = document.startViewTransition(() => {
        apply();
      });

      transition.ready.then(() => {
        const clipPath = [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`
        ];
        document.documentElement.animate(
          {
            clipPath: theme === 'dark' ? clipPath : [...clipPath].reverse()
          },
          {
            duration: 450,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            pseudoElement: theme === 'dark' ? '::view-transition-new(root)' : '::view-transition-old(root)'
          }
        );
      });
    } else {
      apply();
    }
  }

  // Set initial theme
  const initialTheme = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
  setTheme(initialTheme, false);

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      setTheme(next, true, e);
    });
  }

  // Watch system color preference changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    try {
      if (!localStorage.getItem('theme')) {
        setTheme(e.matches ? 'dark' : 'light', false);
      }
    } catch {
      setTheme(e.matches ? 'dark' : 'light', false);
    }
  });
}
