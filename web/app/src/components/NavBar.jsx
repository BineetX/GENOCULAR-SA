import React, { useMemo, useState, useEffect } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../auth/AuthProvider.jsx";
import GenocularLogo from "./GenocularLogo.jsx";
import DisplaySettingsMenu from "./DisplaySettingsMenu.jsx";

export default function NavBar() {
  const { user, logout, role } = useAuth();

  const initial = (user?.displayName || user?.email || "?")
    .slice(0, 1)
    .toUpperCase();

  // Optional: allow a single hard-coded admin email via env
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || "";
  const isAdmin =
    !!user &&
    (
      (role && role.toLowerCase() === "admin") ||
      (adminEmail &&
        user.email &&
        user.email.toLowerCase() === adminEmail.toLowerCase())
    );

  // Build a robust avatar URL:
  // 1) prefer Firebase user.photoURL
  // 2) fallback to providerData[google].photoURL
  // 3) if googleusercontent, request a crisp size (?sz=96)
  const providerPhoto = useMemo(
    () =>
      user?.providerData?.find(p => p?.providerId === "google.com")?.photoURL ||
      "",
    [user]
  );
  const basePhoto = user?.photoURL || providerPhoto || "";
  const computedPhoto = useMemo(() => {
    if (!basePhoto) return "";
    return basePhoto.includes("googleusercontent.com")
      ? `${basePhoto}?sz=96`
      : basePhoto;
  }, [basePhoto]);

  // If the image fails to load, fall back to initials
  const [showImg, setShowImg] = useState(Boolean(computedPhoto));
  useEffect(() => {
    setShowImg(Boolean(computedPhoto));
  }, [computedPhoto]);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const linkCls = ({ isActive }) =>
    [
      "relative inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium transition",
      isActive
        ? "text-slate-900"
        : "text-slate-700 hover:bg-white/70 hover:text-slate-900",
    ].join(" ");

  const navItems = [
    { to: "/run", label: "Run" },
    ...(user ? [{ to: "/jobs", label: "My jobs" }] : []),
    ...(isAdmin ? [{ to: "/admin", label: "Admin" }] : []),
    { to: "/analysis", label: "Analysis" },
    { to: "/about", label: "About" },
  ];

  return (
    <header className="sticky top-0 z-50 isolate border-b border-slate-200/70 bg-white/75 backdrop-blur-md">
      <style>{`
        @keyframes gv-orbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes gv-helix {
          0%, 100% { transform: translateY(-1px); opacity: 0.6; }
          50% { transform: translateY(1px); opacity: 1; }
        }
        @keyframes gv-shimmer {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.7; }
        }
      `}</style>
      <div className="flex h-16 w-full items-center justify-between gap-2 px-3 sm:gap-4 sm:px-8 lg:px-14 xl:px-20">
        {/* Left: brand */}
        <Link
          to="/"
          className="flex min-w-0 shrink items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-900 min-[380px]:text-base sm:gap-2 sm:text-lg"
        >
          <GenocularLogo className="h-9 w-9 sm:h-10 sm:w-10" priority />
          <span className="whitespace-nowrap">GENOCULAR</span>
        </Link>

        {/* Center: main nav */}
        <nav className="hidden sm:flex items-center gap-1 rounded-full border border-slate-200/70 bg-white/70 px-2 py-1 shadow-sm">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <NavLink key={item.to} to={item.to} className={linkCls}>
                {active && (
                  <Motion.span
                    layoutId="navActiveBubble"
                    className="absolute inset-0 -z-10 rounded-full bg-white shadow-[0_10px_24px_-10px_rgba(15,23,42,0.4),0_0_16px_rgba(56,189,248,0.18)] ring-1 ring-slate-200/80"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <span
                  className={
                    active
                      ? "font-semibold text-sky-700 text-[13px] sm:text-[15px]"
                      : undefined
                  }
                >
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </nav>

        {/* Right: auth area */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {user ? (
            <>
              {/* Logged-in view: user info + avatar + logout */}
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-medium text-slate-700">
                  {user.displayName || user.email}
                </span>
                {isAdmin && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">
                    Admin
                  </span>
                )}
              </div>

              {/* Avatar -> navigates to /profile */}
              <Link
                to="/profile"
                title="Open profile"
                aria-label="Open profile"
                className="w-9 h-9 rounded-full overflow-hidden grid place-items-center border border-slate-200 bg-white shadow-sm"
              >
                {showImg && computedPhoto ? (
                  <img
                    src={computedPhoto}
                    alt="Profile"
                    className="w-8 h-8 object-cover rounded-full"
                    referrerPolicy="no-referrer"
                    onError={() => setShowImg(false)}
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-900 text-white grid place-items-center font-medium text-xs">
                    {initial}
                  </div>
                )}
              </Link>

              <button
                onClick={logout}
                className="bg-rose-600 text-white text-xs sm:text-sm px-3.5 py-1.5 border border-rose-700 rounded-full hover:bg-rose-700 transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <DisplaySettingsMenu />
          )}

          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="sm:hidden p-1.5 ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
            aria-label="Toggle menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {isMobileMenuOpen ? (
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {isMobileMenuOpen && (
        <div className="sm:hidden absolute top-full left-0 w-full border-b border-slate-200/70 bg-white/95 backdrop-blur-md shadow-lg py-3 px-4 flex flex-col gap-1 z-40">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <NavLink 
                key={item.to} 
                to={item.to} 
                onClick={() => setIsMobileMenuOpen(false)}
                className={`block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${active ? 'bg-sky-50 text-sky-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                {item.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </header>
  );
}
