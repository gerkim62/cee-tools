import { useState, useEffect } from 'react';

export type ThemePreference = 'system' | 'dark' | 'light';

export function useTheme() {
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    // 1. Read stored preference
    try {
      chrome.storage.local.get(['saka_theme'], (res) => {
        if (res.saka_theme === 'dark' || res.saka_theme === 'light' || res.saka_theme === 'system') {
          setThemePreference(res.saka_theme);
        }
      });
    } catch {}

    // 2. Listen for storage changes across popup windows, tabs, and content scripts
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.saka_theme) {
        const next = changes.saka_theme.newValue;
        if (next === 'dark' || next === 'light' || next === 'system') {
          setThemePreference(next);
        }
      }
    };
    try {
      chrome.storage.onChanged.addListener(handleStorageChange);
    } catch {}

    // 3. Listen for OS theme changes
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
    };
    media.addEventListener('change', handleMediaChange);

    return () => {
      try {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      } catch {}
      media.removeEventListener('change', handleMediaChange);
    };
  }, []);

  const setTheme = (pref: ThemePreference) => {
    setThemePreference(pref);
    try {
      chrome.storage.local.set({ saka_theme: pref }).catch(() => {});
    } catch {}
  };

  const toggleTheme = () => {
    const activeIsDark = themePreference === 'dark' || (themePreference === 'system' && systemIsDark);
    const next: ThemePreference = activeIsDark ? 'light' : 'dark';
    setTheme(next);
  };

  const isDark = themePreference === 'dark' || (themePreference === 'system' && systemIsDark);

  return {
    themePreference,
    setTheme,
    toggleTheme,
    isDark,
    effectiveTheme: isDark ? 'dark' : 'light',
  };
}
