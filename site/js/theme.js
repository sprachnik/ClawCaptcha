/**
 * Theme Toggle for ClawCaptcha Landing Page
 * Supports light/dark mode with system preference detection
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'clawcaptcha-theme';
  const THEMES = ['light', 'dark'];

  /**
   * Get the current theme from storage or system preference
   */
  function getPreferredTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.includes(stored)) {
      return stored;
    }

    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    return 'light';
  }

  /**
   * Apply theme to the document
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }

  /**
   * Toggle between light and dark themes
   */
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
  }

  // Apply initial theme immediately
  applyTheme(getPreferredTheme());

  // ==================== Mobile menu ====================

  function openMenu() {
    document.getElementById('mobile-menu').classList.add('open');
    document.getElementById('mobile-menu-backdrop').classList.add('open');
  }

  function closeMenu() {
    document.getElementById('mobile-menu').classList.remove('open');
    document.getElementById('mobile-menu-backdrop').classList.remove('open');
  }

  // ==================== Coffee modal ====================

  function openCoffee() {
    var modal = document.getElementById('coffee-modal');
    if (!modal) return;
    modal.hidden = false;
    modal.classList.add('open');
  }

  function closeCoffee() {
    var modal = document.getElementById('coffee-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.hidden = true;
  }

  // ==================== Init ====================

  // Set up toggle button when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    // Theme toggles (desktop + mobile)
    var toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.addEventListener('click', toggleTheme);

    var toggleMobile = document.getElementById('theme-toggle-mobile');
    if (toggleMobile) toggleMobile.addEventListener('click', toggleTheme);

    // Mobile menu
    var menuBtn = document.getElementById('menu-toggle');
    if (menuBtn) menuBtn.addEventListener('click', openMenu);

    var closeBtn = document.getElementById('menu-close');
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);

    var backdrop = document.getElementById('mobile-menu-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeMenu);

    // Close menu when a link is tapped
    var menuLinks = document.querySelectorAll('#mobile-menu a');
    menuLinks.forEach(function(link) {
      link.addEventListener('click', closeMenu);
    });

    // Coffee modal
    var coffeeOpen = document.getElementById('coffee-open');
    if (coffeeOpen) coffeeOpen.addEventListener('click', openCoffee);

    var coffeeOpenMobile = document.getElementById('coffee-open-mobile');
    if (coffeeOpenMobile) coffeeOpenMobile.addEventListener('click', openCoffee);

    var coffeeClose = document.getElementById('coffee-close');
    if (coffeeClose) coffeeClose.addEventListener('click', closeCoffee);

    var coffeeModal = document.getElementById('coffee-modal');
    if (coffeeModal) {
      coffeeModal.addEventListener('click', function(e) {
        if (e.target === coffeeModal) closeCoffee();
      });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeCoffee();
    });

    // Listen for system theme changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        if (!localStorage.getItem(STORAGE_KEY)) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  });
})();
