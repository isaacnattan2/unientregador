import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { getAppTheme } from './api';
import type { DriverAppTheme } from './api';

const defaults = { primary: '#1762d1', secondary: '#152844' };

function luminance(color: string) {
  return [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => {
    const value = parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return total + weight * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  }, 0);
}

function palette(theme: DriverAppTheme) {
  const primaryLuminance = luminance(theme.primary);
  const secondaryLuminance = luminance(theme.secondary);
  return {
    ...theme,
    onPrimary: primaryLuminance <= 0.179 ? '#fff' : '#000',
    onSecondary: secondaryLuminance <= 0.179 ? '#fff' : '#000',
    primaryInk: primaryLuminance <= 0.17 ? theme.primary : defaults.secondary,
    secondaryInk: secondaryLuminance <= 0.17 ? theme.secondary : defaults.secondary,
  };
}

export type AppPalette = ReturnType<typeof palette>;
const ThemeContext = createContext<AppPalette>(palette(defaults));

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState(defaults);
  const colors = useMemo(() => palette(theme), [theme]);

  useEffect(() => {
    let request: AbortController | undefined;
    function refresh() {
      request?.abort();
      const current = new AbortController();
      request = current;
      void getAppTheme(current.signal).then((next) => {
        if (!current.signal.aborted) setTheme(next);
      }).catch(() => undefined);
    }
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      subscription.remove();
      request?.abort();
    };
  }, []);

  return <ThemeContext.Provider value={colors}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
