// src/lib/NavPrefsContext.jsx
import React, { createContext, useContext } from "react";
import { usePersistentState } from "./usePersistentState.js";

const NavPrefsCtx = createContext(null);

export const NAV_STYLES = {
  TOPBAR: "topbar",
  SIDEBAR: "sidebar",
};

export function NavPrefsProvider({ children }) {
  const [navStyle, setNavStyle] = usePersistentState(
    "gv:navStyle",
    NAV_STYLES.TOPBAR
  );

  return (
    <NavPrefsCtx.Provider value={{ navStyle, setNavStyle }}>
      {children}
    </NavPrefsCtx.Provider>
  );
}

export function useNavPrefs() {
  const ctx = useContext(NavPrefsCtx);
  if (!ctx) {
    throw new Error("useNavPrefs must be used within a NavPrefsProvider");
  }
  return ctx;
}
