import React, { createContext, PropsWithChildren, useCallback, useContext, useMemo, useState } from 'react';

import { buildThemeColors, type RuntimeThemeColors } from './themeUtils';

type ThemeContextValue = {
  colors: RuntimeThemeColors;
  themePrimaryColor: string;
  setThemePrimaryColor: (color: string) => Promise<void>;
  refreshThemeFromSettings: () => Promise<void>;
};

const defaultPrimary = '#E03131';

const ThemeContext = createContext<ThemeContextValue>({
  colors: buildThemeColors(defaultPrimary),
  themePrimaryColor: defaultPrimary,
  setThemePrimaryColor: async () => undefined,
  refreshThemeFromSettings: async () => undefined,
});

export function ThemeProvider({ children }: PropsWithChildren) {
  const [themePrimaryColor, setThemePrimaryColorState] = useState(defaultPrimary);

  const refreshThemeFromSettings = useCallback(async () => undefined, []);

  const setThemePrimaryColor = useCallback(async (color: string) => {
    const normalizedColor = buildThemeColors(color).primary;
    setThemePrimaryColorState(normalizedColor);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    colors: buildThemeColors(themePrimaryColor),
    refreshThemeFromSettings,
    setThemePrimaryColor,
    themePrimaryColor,
  }), [refreshThemeFromSettings, setThemePrimaryColor, themePrimaryColor]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeColors() {
  return useContext(ThemeContext).colors;
}

export function useThemeSettings() {
  return useContext(ThemeContext);
}
