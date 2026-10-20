import React from "react";
import { Outlet, useLocation } from "react-router-dom";

export default function Shell() {
  const location = useLocation();
  const isLanding = location.pathname === "/";

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Main content */}
      <main className="flex-1 w-full">
        {isLanding ? (
          // Landing page: full-bleed (no max-width wrapper)
          <Outlet />
        ) : (
          // Other pages: full-width; each page controls its own internal composition.
          <Outlet />
        )}
      </main>

      {/* (Optional) If you already have a footer elsewhere, remove this. */}
      <footer className="border-t border-gray-200 bg-white text-xs text-gray-500 py-3 text-center">
        © {new Date().getFullYear()} CBB LAB · ILS Bhubaneswar
      </footer>
    </div>
  );
}
