import React, { createContext, useContext, useEffect, useMemo } from "react";
import { usePersistentState } from "./usePersistentState.js";

const ThemeCtx = createContext(null);

export const THEMES = {
  LIGHT: "light",
  DARK: "dark",
};

const STORAGE_KEY = "gv:theme";

function normalizeTheme(value) {
  return value === THEMES.DARK ? THEMES.DARK : THEMES.LIGHT;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeValue] = usePersistentState(STORAGE_KEY, THEMES.LIGHT);
  const activeTheme = normalizeTheme(theme);

  useEffect(() => {
    const root = document.documentElement;
    const isDark = activeTheme === THEMES.DARK;

    root.classList.toggle("dark", isDark);
    root.classList.toggle("genocular-dark", isDark);
    root.dataset.theme = activeTheme;
  }, [activeTheme]);

  const value = useMemo(
    () => ({
      theme: activeTheme,
      isDark: activeTheme === THEMES.DARK,
      setTheme: (nextTheme) => setThemeValue(normalizeTheme(nextTheme)),
      toggleTheme: () =>
        setThemeValue((currentTheme) =>
          normalizeTheme(currentTheme) === THEMES.DARK
            ? THEMES.LIGHT
            : THEMES.DARK
        ),
    }),
    [activeTheme, setThemeValue]
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
