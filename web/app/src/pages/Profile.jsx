import React, { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useNavPrefs, NAV_STYLES } from "../lib/NavPrefsContext.jsx";
import { THEMES, useTheme } from "../lib/ThemeContext.jsx";
import { useFontSize, FONT_SIZES } from "../lib/FontSizeContext.jsx";

export default function Profile() {
  const { user, updateDisplayName, changePassword, sendResetEmail } = useAuth();
  const { navStyle, setNavStyle } = useNavPrefs();
  const { theme, setTheme } = useTheme();
  const { fontSize, setFontSize } = useFontSize();
  const [name, setName] = useState(user?.displayName || "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  // password form
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  async function saveName() {
    setMsg(null); setErr(null); setSaving(true);
    try {
      await updateDisplayName(name.trim());
      setMsg("Name updated.");
    } catch (e) { setErr(e.message || String(e)); }
    finally { setSaving(false); }
  }

  async function onChangePassword(e) {
    e.preventDefault();
    setMsg(null); setErr(null);
    if (newPw.length < 8) return setErr("New password must be at least 8 characters.");
    if (newPw !== newPw2) return setErr("Passwords do not match.");
    try {
      await changePassword({ currentPassword: currentPw, newPassword: newPw });
      setMsg("Password changed.");
      setCurrentPw(""); setNewPw(""); setNewPw2("");
    } catch (e) { setErr(e.message || String(e)); }
  }

  async function onSendReset() {
    setMsg(null); setErr(null);
    try {
      await sendResetEmail(user?.email);
      setMsg("Password reset email sent.");
    } catch (e) { setErr(e.message || String(e)); }
  }

  const hasPasswordProvider = (user?.providerData || []).some(p => p.providerId === "password");
  const hasGoogleProvider = (user?.providerData || []).some(p => p.providerId === "google.com");
  const activeThemeLabel = theme === THEMES.DARK ? "Dark mode" : "Light mode";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100">
      <div className="w-full px-4 sm:px-8 lg:px-14 xl:px-20 py-8">
        <div className="mb-6">
          <h1 className="genocular-page-title">Profile</h1>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
            <h2 className="genocular-section-title">Account</h2>
            <div className="text-sm text-gray-600 dark:text-gray-400">Email: <b>{user?.email}</b></div>
            <div className="flex flex-wrap gap-2 text-xs">
              {hasGoogleProvider && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700">
                  Google sign-in
                </span>
              )}
              {hasPasswordProvider && (
                <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-300">
                  Email and password
                </span>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input className="border dark:border-slate-700 dark:bg-slate-800 rounded p-2" value={name} onChange={e => setName(e.target.value)} placeholder="Display name" />
              <button onClick={saveName} disabled={saving} className="px-4 py-2 border dark:border-slate-700 rounded bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700">
                {saving ? "Saving..." : "Save name"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-sm">
            <h2 className="genocular-section-title">Security</h2>

            {hasPasswordProvider && (
              <form onSubmit={onChangePassword} className="grid gap-2 sm:grid-cols-3">
                <input className="border dark:border-slate-700 dark:bg-slate-800 rounded p-2" type="password" placeholder="Current password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
                <input className="border dark:border-slate-700 dark:bg-slate-800 rounded p-2" type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} />
                <input className="border dark:border-slate-700 dark:bg-slate-800 rounded p-2" type="password" placeholder="Confirm new password" value={newPw2} onChange={e => setNewPw2(e.target.value)} />
                <div className="sm:col-span-3">
                  <button className="px-4 py-2 bg-blue-600 text-white rounded">Change password</button>
                </div>
              </form>
            )}

            {!hasPasswordProvider && hasGoogleProvider && (
              <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 p-4 text-sm text-blue-900 dark:text-blue-100">
                <div className="font-semibold">Password managed by Google</div>
                <p className="mt-1 text-blue-800 dark:text-blue-200">
                  This GENOCULAR account does not have a separate password. Use “Continue with Google” to sign in and manage your Google password from your Google Account.
                </p>
              </div>
            )}

            {hasPasswordProvider && (
              <div className="text-sm">
                <button onClick={onSendReset} className="mt-2 px-3 py-1.5 border dark:border-slate-700 rounded hover:bg-gray-50 dark:hover:bg-slate-800">
                  Send password reset email
                </button>
              </div>
            )}

            {msg && <div className="text-xs text-green-700">{msg}</div>}
            {err && <div className="text-xs text-red-600 break-words">{err}</div>}
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-5 shadow-sm xl:col-span-2">
            <div>
              <h2 className="genocular-section-title">Preferences</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Set your workspace appearance and navigation layout.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Appearance
                    </h3>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      Select the theme for your workspace.
                    </p>
                  </div>
                  <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {activeThemeLabel}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setTheme(THEMES.LIGHT)}
                    className={
                      "group text-left rounded-2xl border p-4 transition " +
                      (theme === THEMES.LIGHT
                        ? "border-sky-400 bg-white ring-2 ring-sky-400/15 shadow-sm"
                        : "border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800")
                    }
                  >
                    <span className="flex items-center justify-between">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                        <Sun className="h-4 w-4" />
                      </span>
                      {theme === THEMES.LIGHT && (
                        <span className="text-[10px] uppercase tracking-wide text-sky-700 font-semibold">
                          Active
                        </span>
                      )}
                    </span>
                    <span className="mt-3 block text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Light
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                      Bright workspace.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTheme(THEMES.DARK)}
                    className={
                      "group text-left rounded-2xl border p-4 transition " +
                      (theme === THEMES.DARK
                        ? "border-cyan-300 bg-slate-950 ring-2 ring-cyan-300/20 shadow-[0_18px_55px_-32px_rgba(34,211,238,0.8)]"
                        : "border-slate-200 dark:border-slate-700 bg-slate-900 text-white hover:bg-slate-950")
                    }
                  >
                    <span className="flex items-center justify-between">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 via-slate-900 to-cyan-950 text-cyan-200 ring-1 ring-cyan-300/20">
                        <Moon className="h-4 w-4" />
                      </span>
                      {theme === THEMES.DARK && (
                        <span className="text-[10px] uppercase tracking-wide text-cyan-200 font-semibold">
                          Active
                        </span>
                      )}
                    </span>
                    <span className="mt-3 block text-sm font-semibold text-white">
                      Dark
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-300">
                      Layered graphite, navy, and cyan tones.
                    </span>
                  </button>
                </div>
                <div className="my-6 border-t border-slate-200/60"></div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Typography
                    </h3>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      Adjust the sitewide text scale for reading density.
                    </p>
                  </div>
                  
                  <div className="relative flex items-center gap-1 p-1 bg-slate-100/50 dark:bg-slate-800/50 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 w-fit shadow-inner">
                    {[
                      { val: FONT_SIZES.XSMALL, label: "XS", icon: "text-xs" },
                      { val: FONT_SIZES.SMALL, label: "S", icon: "text-sm" },
                      { val: FONT_SIZES.MEDIUM, label: "M", icon: "text-base" },
                      { val: FONT_SIZES.LARGE, label: "L", icon: "text-lg" },
                      { val: FONT_SIZES.XLARGE, label: "XL", icon: "text-xl" },
                    ].map((s) => {
                      const isActive = fontSize === s.val;
                      return (
                        <button
                          key={s.val}
                          type="button"
                          onClick={() => setFontSize(s.val)}
                          className={`relative flex flex-col items-center justify-center w-11 h-12 sm:w-12 sm:h-14 rounded-xl transition-all duration-300 ease-out active:scale-95 border ${
                            isActive
                              ? "bg-white border-sky-400 text-sky-700 ring-2 ring-sky-400/15 shadow-sm scale-105 z-10"
                              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-700"
                          }`}
                          title={s.val}
                        >
                          <span className={`relative z-10 ${s.icon} font-semibold font-serif leading-none`}>A</span>
                          <span className={`relative z-10 text-[9px] mt-1 font-bold uppercase tracking-widest ${isActive ? "text-sky-600" : "text-slate-400"}`}>
                            {s.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Navigation
                </h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Choose how the navigation appears across the app.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNavStyle(NAV_STYLES.TOPBAR)}
                    className={
                      "group text-left rounded-2xl border p-3 transition hover:-translate-y-0.5 " +
                      (navStyle === NAV_STYLES.TOPBAR
                        ? "border-sky-400 bg-white ring-2 ring-sky-400/15 shadow-sm"
                        : "border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800")
                    }
                  >
                    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/80 p-2">
                      <div className="aspect-[16/10] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
                        <div className="flex h-9 items-center justify-between border-b border-slate-200 bg-slate-950 px-2">
                          <div className="h-2.5 w-12 rounded-full bg-white" />
                          <div className="flex gap-1">
                            <span className="h-2.5 w-7 rounded-full bg-sky-400" />
                            <span className="h-2.5 w-7 rounded-full bg-white/55" />
                            <span className="h-2.5 w-7 rounded-full bg-white/55" />
                          </div>
                        </div>
                        <div className="space-y-2 p-2.5">
                          <div className="h-2.5 w-3/4 rounded-full bg-slate-300" />
                          <div className="grid grid-cols-3 gap-2">
                            <span className="h-7 rounded-md bg-sky-100" />
                            <span className="h-7 rounded-md bg-slate-200" />
                            <span className="h-7 rounded-md bg-slate-200" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-2">
                      <div>
                        <span className="block font-semibold text-sm text-slate-900 dark:text-slate-100">
                          Top navigation
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                          Horizontal menu for compact workflows.
                        </span>
                      </div>
                      <span
                        className={
                          "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide " +
                          (navStyle === NAV_STYLES.TOPBAR
                            ? "bg-sky-100 text-sky-700"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400")
                        }
                      >
                        {navStyle === NAV_STYLES.TOPBAR ? "Active" : "Select"}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNavStyle(NAV_STYLES.SIDEBAR)}
                    className={
                      "group text-left rounded-2xl border p-3 transition hover:-translate-y-0.5 " +
                      (navStyle === NAV_STYLES.SIDEBAR
                        ? "border-sky-400 bg-white ring-2 ring-sky-400/15 shadow-sm"
                        : "border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800")
                    }
                  >
                    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/80 p-2">
                      <div className="flex aspect-[16/10] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
                        <div className="w-11 shrink-0 border-r border-slate-200 bg-slate-950 p-2">
                          <div className="mb-3 h-5 w-5 rounded-md bg-gradient-to-br from-sky-400 to-emerald-400 shadow-sm" />
                          <div className="space-y-1.5">
                            <span className="block h-2.5 rounded-full bg-sky-300" />
                            <span className="block h-2.5 rounded-full bg-white/45" />
                            <span className="block h-2.5 rounded-full bg-white/45" />
                            <span className="block h-2.5 rounded-full bg-white/45" />
                          </div>
                        </div>
                        <div className="flex-1 space-y-2 p-2.5">
                          <div className="h-2.5 w-3/4 rounded-full bg-slate-300" />
                          <div className="grid grid-cols-2 gap-2">
                            <span className="h-7 rounded-md bg-sky-100" />
                            <span className="h-7 rounded-md bg-slate-200" />
                          </div>
                          <div className="h-4 rounded-md bg-slate-200" />
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-2">
                      <div>
                        <span className="block font-semibold text-sm text-slate-900 dark:text-slate-100">
                          Sidebar drawer
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                          Persistent left rail with quick job access.
                        </span>
                      </div>
                      <span
                        className={
                          "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide " +
                          (navStyle === NAV_STYLES.SIDEBAR
                            ? "bg-sky-100 text-sky-700"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400")
                        }
                      >
                        {navStyle === NAV_STYLES.SIDEBAR ? "Active" : "Select"}
                      </span>
                    </div>
                  </button>
                </div>
              </section>
              

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
