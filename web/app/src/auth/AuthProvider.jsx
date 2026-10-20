import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { auth, googleProvider } from "../lib/firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  signInWithPopup,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  EmailAuthProvider,
  reauthenticateWithCredential,
  linkWithCredential,
  updatePassword,
  sendPasswordResetEmail,
} from "firebase/auth";

const EXP_KEY = "genoverse_auth_expiry";
const PREF_KEY = "genoverse_remember_me";
const DAYS7_MS = 7 * 24 * 60 * 60 * 1000;

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

/** Set Firebase persistence + remember-me flags */
async function applyPersistence(remember) {
  await setPersistence(
    auth,
    remember ? browserLocalPersistence : browserSessionPersistence
  );
  localStorage.setItem(PREF_KEY, remember ? "1" : "0");
  if (remember) {
    localStorage.setItem(EXP_KEY, String(Date.now() + DAYS7_MS));
  } else {
    localStorage.removeItem(EXP_KEY);
  }
}

/** Auto sign-out if our soft expiry passed */
function checkExpiryAndMaybeSignOut() {
  const exp = Number(localStorage.getItem(EXP_KEY) || "0");
  if (exp && Date.now() > exp) {
    localStorage.removeItem(EXP_KEY);
    auth.signOut();
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { uid, email, displayName, providerData, role, isAdmin }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkExpiryAndMaybeSignOut();

    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Set a basic user immediately to avoid auth flicker on route guards
      setUser({
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        providerData: u.providerData,
        role: "user",
        isAdmin: false,
      });
      setLoading(false);

      // Enrich Firebase user with custom claims (role)
      (async () => {
        try {
          // Force refresh once so new claims (like admin) propagate after you set them
          const tokenResult = await u.getIdTokenResult(true);
          const role = tokenResult.claims?.role || "user";

          setUser({
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            providerData: u.providerData,
            role,
            isAdmin: role === "admin",
          });
        } catch (e) {
          console.error("Failed to load custom claims:", e);
          // Fallback: treat as normal user without role
          setUser({
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            providerData: u.providerData,
            role: "user",
            isAdmin: false,
          });
        } finally {
          setLoading(false);
        }
      })();
    });

    return () => unsub();
  }, []);

  const value = useMemo(() => {
    // Helper reauth functions live here so changePassword can reuse them
    async function reauthWithEmail(currentPassword) {
      const u = auth.currentUser;
      if (!u || !u.email) throw new Error("No email user");
      const cred = EmailAuthProvider.credential(u.email, currentPassword);
      await reauthenticateWithCredential(u, cred);
    }

    return {
      user,
      loading,

      // -------- Sessions --------
      async signInEmail(email, password, remember = false) {
        await applyPersistence(remember);
        await signInWithEmailAndPassword(auth, email, password);
        if (remember) {
          localStorage.setItem(EXP_KEY, String(Date.now() + DAYS7_MS));
        }
      },

      async signUpEmail(email, password, name, remember = false) {
        await applyPersistence(remember);
        const cred = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        if (name) {
          await updateProfile(cred.user, { displayName: name });
        }
        if (remember) {
          localStorage.setItem(EXP_KEY, String(Date.now() + DAYS7_MS));
        }
      },

      async signInGoogle(remember = false) {
        await applyPersistence(remember);
        const result = await signInWithPopup(auth, googleProvider);
        if (remember) {
          localStorage.setItem(EXP_KEY, String(Date.now() + DAYS7_MS));
        }
        return result;
      },

      async linkGoogleCredential(credential) {
        const u = auth.currentUser;
        if (!u) throw new Error("Sign in with your email and password first.");
        if (!credential) throw new Error("Google account details are missing.");
        return linkWithCredential(u, credential);
      },

      async logout() {
        localStorage.removeItem(EXP_KEY);
        await signOut(auth);
      },

      // -------- Profile --------
      async updateDisplayName(name) {
        if (!auth.currentUser) throw new Error("No user");
        await updateProfile(auth.currentUser, { displayName: name });
      },

      // -------- Password helpers --------
      async changePassword({ currentPassword, newPassword }) {
        const u = auth.currentUser;
        if (!u) throw new Error("No user");

        const isEmailProvider = (u.providerData || []).some(
          (p) => p.providerId === "password"
        );

        if (!isEmailProvider) {
          throw new Error(
            "This account uses Google sign-in and does not have a GENOCULAR password."
          );
        }
        if (!currentPassword) {
          throw new Error("Current password required");
        }

        await reauthWithEmail(currentPassword);
        await updatePassword(u, newPassword);
      },

      async sendResetEmail(email) {
        await sendPasswordResetEmail(auth, email);
      },

      // -------- Token / claims helpers --------
      async getIdToken(forceRefresh = false) {
        const u = auth.currentUser;
        if (!u) throw new Error("No user");
        return u.getIdToken(forceRefresh);
      },

      async refreshClaims() {
        const u = auth.currentUser;
        if (!u) return;
        try {
          const tokenResult = await u.getIdTokenResult(true);
          const role = tokenResult.claims?.role || "user";
          setUser({
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            providerData: u.providerData,
            role,
            isAdmin: role === "admin",
          });
        } catch (e) {
          console.error("Failed to refresh claims:", e);
        }
      },

      // -------- Misc --------
      getRememberPreference() {
        return localStorage.getItem(PREF_KEY) === "1";
      },

      // Convenience flags
      isAdmin: !!user?.isAdmin,
      role: user?.role || "user",
    };
  }, [user, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
