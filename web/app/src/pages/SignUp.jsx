import React, { useState } from "react";
import GenocularLogo from "../components/GenocularLogo.jsx";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.jsx";

export default function SignUp() {
  const { signUpEmail, signInGoogle, getRememberPreference } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [remember, setRemember] = useState(getRememberPreference());
  const [showEmail, setShowEmail] = useState(false);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setMsg(null); setErr(null);
    if (pw !== pw2) { setErr("Passwords do not match."); return; }
    if (pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    try {
      setPending(true);
      await signUpEmail(email.trim(), pw, name.trim(), remember);
      setMsg("Account created. Redirecting…");
      nav("/run", { replace: true });
    } catch (e2) {
      if (e2?.code === "auth/email-already-in-use") {
        setErr("An account already uses this email. Sign in instead, preferably with Google.");
      } else {
        setErr(e2?.message || "Unable to create the account.");
      }
      setPending(false);
    }
  }

  async function onGoogle() {
    setMsg(null);
    setErr(null);
    try {
      setPending(true);
      await signInGoogle(remember);
      nav("/run", { replace: true });
    } catch (error) {
      if (error?.code === "auth/account-exists-with-different-credential") {
        setErr(
          "This email already has an email-password account. Open the sign-in page, choose Google, then enter your existing password once to connect both methods."
        );
      } else if (error?.code !== "auth/popup-closed-by-user") {
        setErr(error?.message || "Unable to continue with Google.");
      }
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_38%),linear-gradient(to_bottom,_#f8fafc,_#ffffff)] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.45)]">
        <div className="mb-6 text-center">
          <GenocularLogo className="mx-auto mb-4 h-16 w-16" priority />
          <h1 className="genocular-auth-title">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">Google is the recommended sign-up method.</p>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={onGoogle}
            disabled={pending}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-sm font-bold text-blue-600">G</span>
            {pending && !showEmail ? "Connecting to Google…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">or</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {!showEmail ? (
            <button
              type="button"
              onClick={() => setShowEmail(true)}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Register with email instead
            </button>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" placeholder="Full name" autoComplete="name" required value={name} onChange={(e)=>setName(e.target.value)} />
              <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" placeholder="you@example.com" type="email" autoComplete="email" required value={email} onChange={(e)=>setEmail(e.target.value)} />
              <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" placeholder="Password (minimum 8 characters)" type="password" autoComplete="new-password" required value={pw} onChange={(e)=>setPw(e.target.value)} />
              <input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" placeholder="Confirm password" type="password" autoComplete="new-password" required value={pw2} onChange={(e)=>setPw2(e.target.value)} />
              <button disabled={pending} className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
                {pending ? "Creating account…" : "Create email account"}
              </button>
            </form>
          )}

          <label className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={remember} onChange={(e)=>setRemember(e.target.checked)} />
            Keep me signed in on this device
          </label>

          <div className="text-center text-sm text-slate-600">
            Already have an account? <Link className="font-semibold text-sky-700" to="/signin">Sign in</Link>
          </div>
          {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{msg}</div>}
          {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{err}</div>}
        </div>
      </div>
    </div>
  );
}
