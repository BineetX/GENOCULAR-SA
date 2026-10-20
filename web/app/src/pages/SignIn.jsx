// src/pages/SignIn.jsx
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider.jsx";
import { auth, googleProvider } from "../lib/firebase.js";
import {
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import GenocularLogo from "../components/GenocularLogo.jsx";

const GOOGLE_LINK_MESSAGE =
  "This email already has an email-and-password account. Sign in with that password once to securely connect Google.";

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return "The email or password is incorrect.";
  }
  if (code === "auth/user-not-found") {
    return "No email-password account was found. Try Google sign-in.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "Google sign-in was cancelled.";
  }
  return error?.message || "Unable to sign in. Please try again.";
}

export default function SignIn() {
  const {
    signInEmail,
    getRememberPreference,
    signInGoogle,
    linkGoogleCredential,
    user,
  } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedNext = String(searchParams.get("next") || "");
  const nextPath = requestedNext.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/run";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(getRememberPreference());
  const [showEmail, setShowEmail] = useState(false);
  const [pendingGoogleCredential, setPendingGoogleCredential] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [pending, setPending] = useState(false);
  const authFlowInProgress = useRef(false);

  useEffect(() => {
    if (user && !authFlowInProgress.current) {
      navigate(nextPath, { replace: true });
    }
  }, [user, navigate, nextPath]);

  useEffect(() => {
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) navigate(nextPath, { replace: true });
      })
      .catch((error) => {
        if (error?.code === "auth/account-exists-with-different-credential") {
          const credential = GoogleAuthProvider.credentialFromError(error);
          setPendingGoogleCredential(credential);
          setEmail(error?.customData?.email || "");
          setShowEmail(true);
          setErr(GOOGLE_LINK_MESSAGE);
          return;
        }
        setErr(authErrorMessage(error));
      });
  }, [navigate, nextPath]);

  async function onEmail(event) {
    event.preventDefault();
    setMsg(null);
    setErr(null);
    authFlowInProgress.current = true;
    try {
      setPending(true);
      await signInEmail(email.trim(), password, remember);
      if (pendingGoogleCredential) {
        await linkGoogleCredential(pendingGoogleCredential);
        setMsg("Google has been connected to your existing account.");
      }
      navigate(nextPath, { replace: true });
    } catch (error) {
      setErr(authErrorMessage(error));
      authFlowInProgress.current = false;
      setPending(false);
    }
  }

  async function onGoogle() {
    setMsg(null);
    setErr(null);
    authFlowInProgress.current = true;
    try {
      setPending(true);
      await signInGoogle(remember);
      navigate(nextPath, { replace: true });
    } catch (error) {
      if (error?.code === "auth/account-exists-with-different-credential") {
        const credential = GoogleAuthProvider.credentialFromError(error);
        setPendingGoogleCredential(credential);
        setEmail(error?.customData?.email || "");
        setShowEmail(true);
        setErr(GOOGLE_LINK_MESSAGE);
        authFlowInProgress.current = false;
        setPending(false);
        return;
      }
      if (
        error?.code === "auth/popup-blocked" ||
        error?.code === "auth/unauthorized-domain"
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
          setMsg("Redirecting to Google…");
        } catch (redirectError) {
          setErr(authErrorMessage(redirectError));
          authFlowInProgress.current = false;
          setPending(false);
        }
      } else {
        setErr(authErrorMessage(error));
        authFlowInProgress.current = false;
        setPending(false);
      }
    }
  }

  return (
    <div className="genocular-auth-page min-h-screen grid place-items-center bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.14),_transparent_38%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] px-4 py-10">
      <div className="genocular-auth-card w-full max-w-md overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.45)] backdrop-blur">
        <div className="border-b border-slate-100 px-6 pb-5 pt-7 text-center">
          <GenocularLogo className="mx-auto mb-4 h-16 w-16" priority />
          <h1 className="genocular-auth-title">
            Staff sign in
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Administration access
          </p>
        </div>

        <div className="space-y-4 px-6 py-6">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onGoogle}
            disabled={pending}
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-sm font-bold text-blue-600">
              G
            </span>
            {pending && !showEmail ? "Connecting to Google…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
              or
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {!showEmail ? (
            <button
              type="button"
              onClick={() => setShowEmail(true)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Sign in with email instead
            </button>
          ) : (
            <form onSubmit={onEmail} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Email address
                </label>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="you@example.com"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Password
                </label>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="Enter your password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  Keep me signed in
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setShowEmail(false);
                    setPendingGoogleCredential(null);
                    setErr(null);
                  }}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
              </div>
              <button
                className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pending}
              >
                {pending
                  ? "Signing in…"
                  : pendingGoogleCredential
                    ? "Sign in and connect Google"
                    : "Sign in with email"}
              </button>
            </form>
          )}

          <label className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Keep me signed in on this device
          </label>

          <div className="text-center">
            <Link className="text-xs font-medium text-slate-500 hover:text-slate-800" to="/">
              Return to GENOCULAR
            </Link>
          </div>

          {msg && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-700">
              {msg}
            </div>
          )}
          {err && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs leading-5 text-rose-700">
              {err}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
