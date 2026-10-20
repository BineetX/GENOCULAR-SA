import React, { createContext, useContext, useEffect, useMemo } from "react";
import { usePersistentState } from "./usePersistentState.js";

const FontSizeCtx = createContext(null);

export const FONT_SIZES = {
  XSMALL: "xsmall",
  SMALL: "small",
  MEDIUM: "medium", // Default
  LARGE: "large",
  XLARGE: "xlarge",
};

const STORAGE_KEY = "gv:fontSize";

function normalizeFontSize(value) {
  if (Object.values(FONT_SIZES).includes(value)) return value;
  return FONT_SIZES.MEDIUM;
}

export function FontSizeProvider({ children }) {
  const [fontSize, setFontSizeValue] = usePersistentState(STORAGE_KEY, FONT_SIZES.MEDIUM);
  const activeFontSize = normalizeFontSize(fontSize);

  useEffect(() => {
    const root = document.documentElement;
    // Map font size names to pixel values for the root element.
    // Tailwind rem values will scale based on this root size.
    let rootSize = "16px"; // medium/default
    if (activeFontSize === FONT_SIZES.XSMALL) rootSize = "12px";
    if (activeFontSize === FONT_SIZES.SMALL) rootSize = "14px";
    if (activeFontSize === FONT_SIZES.LARGE) rootSize = "18px";
    if (activeFontSize === FONT_SIZES.XLARGE) rootSize = "20px";
    
    root.style.fontSize = rootSize;
    root.dataset.fontSize = activeFontSize;
  }, [activeFontSize]);

  const value = useMemo(
    () => ({
      fontSize: activeFontSize,
      setFontSize: (nextSize) => setFontSizeValue(normalizeFontSize(nextSize)),
    }),
    [activeFontSize, setFontSizeValue]
  );

  return <FontSizeCtx.Provider value={value}>{children}</FontSizeCtx.Provider>;
}

export function useFontSize() {
  const ctx = useContext(FontSizeCtx);
  if (!ctx) {
    throw new Error("useFontSize must be used within a FontSizeProvider");
  }
  return ctx;
}
