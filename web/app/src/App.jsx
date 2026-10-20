import React, { useEffect, useState } from "react";
import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import NavBar from "./components/NavBar.jsx";
import SidebarNav from "./components/SidebarNav.jsx";
import CursorFX from "./components/CursorFX.jsx";
import Protected from "./auth/Protected.jsx";
import Shell from "./layouts/Shell.jsx";
import { useNavPrefs, NAV_STYLES } from "./lib/NavPrefsContext.jsx";

import UploadAndRun from "./pages/UploadAndRun.jsx";
import JobsHistory from "./pages/JobsHistory.jsx";
import Profile from "./pages/Profile.jsx";
import SignIn from "./pages/SignIn.jsx";
import GenomeViewer from "./pages/GenomeViewer.jsx";
import About from "./pages/About.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import Initiating from "./pages/Initiating.jsx";

import AssistantChat from "./components/AssistantChat.jsx";
import GlobalUploadProgress from "./components/GlobalUploadProgress.jsx";
export default function App() {
  const location = useLocation();
  const { navStyle } = useNavPrefs();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("gv:sidebarCollapsed")) === true;
    } catch {
      return false;
    }
  });
  const isAuthRoute =
    location.pathname === "/signin" || location.pathname === "/signup";
  const isTemporaryLaunchRoute = location.pathname === "/initiating";
  const showCursorFX = location.pathname === "/";
  const useSidebar =
    !isAuthRoute && !isTemporaryLaunchRoute && navStyle === NAV_STYLES.SIDEBAR;
  const sidebarOffset = sidebarCollapsed ? "lg:pl-16" : "lg:pl-72";

  useEffect(() => {
    const onSidebarChange = (event) => {
      setSidebarCollapsed(Boolean(event.detail));
    };
    window.addEventListener("gv:sidebarCollapsedChanged", onSidebarChange);
    return () => {
      window.removeEventListener("gv:sidebarCollapsedChanged", onSidebarChange);
    };
  }, []);

  return (
    <>
      {showCursorFX && <CursorFX />}
      {!isAuthRoute && !isTemporaryLaunchRoute && !useSidebar && <NavBar />}
      {useSidebar && <SidebarNav />}
      <div
        className={
          useSidebar
            ? `${sidebarOffset}${sidebarCollapsed ? "" : " genocular-content-sidebar-expanded"}`
            : undefined
        }
      >
        <Routes location={location}>
          {/* Public routes. Private job data is protected by a per-job
              capability rather than a required account session. */}
          <Route element={<Shell />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/run" element={<UploadAndRun />} />
            <Route path="/analysis" element={<GenomeViewer />} />
            <Route path="/viewer" element={<GenomeViewer />} />
            <Route path="/about" element={<About />} />
          </Route>

          {/* Optional account history/preferences and administration */}
          <Route
            element={
              <Protected>
                <Shell />
              </Protected>
            }
          >
            <Route path="/jobs" element={<JobsHistory />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>

          {/* Auth pages (public) */}
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<Navigate to="/signin" replace />} />
          <Route path="/initiating" element={<Initiating />} />
        </Routes>
      </div>

      {/* Global GENOCULAR assistant – always available on every page */}
      {!isTemporaryLaunchRoute && <AssistantChat />}

      {/* Global upload progress widget */}
      {!isTemporaryLaunchRoute && <GlobalUploadProgress />}
    </>
  );
}
