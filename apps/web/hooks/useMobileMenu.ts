'use client';

import { useState, useEffect, useCallback } from 'react';

export function useMobileMenu() {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  // Close when viewport reaches desktop breakpoint
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');

    function handleChange(e: MediaQueryListEvent) {
      if (e.matches) setMenuOpen(false);
    }

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  // Manage body overflow + inert on main/footer
  useEffect(() => {
    const main = document.querySelector('main');
    const footer = document.querySelector('footer');

    if (menuOpen) {
      document.body.style.overflow = 'hidden';
      main?.setAttribute('inert', '');
      footer?.setAttribute('inert', '');
    } else {
      document.body.style.overflow = '';
      main?.removeAttribute('inert');
      footer?.removeAttribute('inert');
    }

    return () => {
      document.body.style.overflow = '';
      // Re-query to avoid stale closure refs after DOM replacement
      document.querySelector('main')?.removeAttribute('inert');
      document.querySelector('footer')?.removeAttribute('inert');
    };
  }, [menuOpen]);

  const close = useCallback(() => setMenuOpen(false), []);
  const toggle = useCallback(() => setMenuOpen((prev) => !prev), []);

  return { menuOpen, close, toggle } as const;
}
