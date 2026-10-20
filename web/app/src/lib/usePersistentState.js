// src/lib/usePersistentState.js
import { useEffect, useRef, useState } from "react";

/**
 * Persist any serializable state to localStorage or sessionStorage.
 *
 * @param {string} key - storage key
 * @param {*} initialValue - initial value if nothing stored
 * @param {"local"|"session"} storageKind - default "local"
 * @param {number} debounceMs - write debounce (ms)
 */
export function usePersistentState(key, initialValue, storageKind = "local", debounceMs = 200) {
  const storage = storageKind === "session" ? window.sessionStorage : window.localStorage;

  // Hydrate once
  const hydrated = useRef(false);
  const [state, setState] = useState(() => {
    try {
      const raw = storage.getItem(key);
      return raw != null ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  // Debounced writer
  const timer = useRef(null);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        storage.setItem(key, JSON.stringify(state));
      } catch {
        // storage full or blocked — ignore
      }
    }, debounceMs);
    return () => clearTimeout(timer.current);
  }, [key, state, debounceMs, storage]);

  return [state, setState];
}

/** Same API, but always uses sessionStorage */
export function useSessionState(key, initialValue, debounceMs = 200) {
  return usePersistentState(key, initialValue, "session", debounceMs);
}

