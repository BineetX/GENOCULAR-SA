import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  HelpCircle,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  PlayCircle,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider.jsx";
import { apiJson } from "../lib/api.js";
import { listJobs } from "../lib/jobStore.js";
import { usePersistentState } from "../lib/usePersistentState.js";
import GenocularLogo from "./GenocularLogo.jsx";
import DisplaySettingsMenu from "./DisplaySettingsMenu.jsx";

const navIconCls = "h-4 w-4";

function normalizeState(state = "") {
  const value = String(state || "").toLowerCase();
  if (/(fail|error|cancel|abort)/.test(value)) return "failed";
  if (/(queue|queued|pending|wait)/.test(value)) return "queued";
  if (/(run|running|in[_-]?progress|active|start)/.test(value)) return "running";
  if (/(complete|completed|done|success|succeeded|finished|ok)/.test(value)) {
    return "completed";
  }
  return "unknown";
}

function statusDotClass(state = "") {
  const normalized = normalizeState(state);
  if (normalized === "failed") return "bg-rose-500";
  if (normalized === "running") return "bg-sky-500";
  if (normalized === "queued") return "bg-amber-500";
  if (normalized === "completed") return "bg-emerald-500";
  return "bg-slate-300";
}

function statusLabel(state = "") {
  const normalized = normalizeState(state);
  if (normalized === "unknown") return "Not checked";
  return normalized.replace(/^\w/, (char) => char.toUpperCase());
}

function displaySample(sampleId = "") {
  const value = String(sampleId || "").trim();
  if (!value) return "Untitled job";
  if (["sample", "sample1", "s1", "job", "job1"].includes(value.toLowerCase())) {
    return "Untitled job";
  }
  return value;
}

function shortJobId(jobId = "") {
  const value = String(jobId || "");
  return value.length > 10 ? value.slice(0, 8) : value || "No job ID";
}

function formatJobTime(ts) {
  if (!ts) return "";
  try {
    const numeric = typeof ts === "number" ? ts : Number(ts);
    const value = Number.isFinite(numeric) ? (Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric) : ts;
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export default function SidebarNav() {
  const { user, logout, role } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = usePersistentState(
    "gv:sidebarCollapsed",
    false
  );
  const [jobsOpen, setJobsOpen] = useState(false);
  const [recentJobs, setRecentJobs] = useState([]);
  const [statusMap, setStatusMap] = useState({});

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("gv:sidebarCollapsedChanged", { detail: collapsed })
    );
  }, [collapsed]);

  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || "";
  const isAdmin =
    !!user &&
    ((role && role.toLowerCase() === "admin") ||
      (adminEmail &&
        user.email &&
        user.email.toLowerCase() === adminEmail.toLowerCase()));

  const initial = (user?.displayName || user?.email || "?")
    .slice(0, 1)
    .toUpperCase();

  const providerPhoto = useMemo(
    () =>
      user?.providerData?.find((provider) => provider?.providerId === "google.com")
        ?.photoURL || "",
    [user]
  );
  const basePhoto = user?.photoURL || providerPhoto || "";
  const computedPhoto = useMemo(() => {
    if (!basePhoto) return "";
    return basePhoto.includes("googleusercontent.com")
      ? `${basePhoto}?sz=96`
      : basePhoto;
  }, [basePhoto]);

  const [showImg, setShowImg] = useState(Boolean(computedPhoto));
  useEffect(() => {
    setShowImg(Boolean(computedPhoto));
  }, [computedPhoto]);

  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      if (!user?.uid) {
        setRecentJobs([]);
        return;
      }

      try {
        const response = await apiJson(
          `/user-jobs?user_id=${encodeURIComponent(user.uid)}`
        );
        if (cancelled) return;
        const jobs = Array.isArray(response?.jobs) ? response.jobs : [];
        setRecentJobs(jobs.slice(0, 5));
      } catch {
        if (!cancelled) setRecentJobs(listJobs(user.uid).slice(0, 5));
      }
    }

    loadJobs();
    const timer = setInterval(loadJobs, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    if (!recentJobs.length) {
      setStatusMap({});
      return;
    }

    let active = true;

    async function refreshStatuses() {
      await Promise.all(
        recentJobs.map(async (job) => {
          if (!job.jobId) return;
          try {
            const status = await apiJson(`/jobs/${job.jobId}/status`);
            if (!active) return;
            setStatusMap((current) => ({ ...current, [job.jobId]: status }));
          } catch {
            if (!active) return;
            setStatusMap((current) => ({
              ...current,
              [job.jobId]: current[job.jobId] || { state: "unknown" },
            }));
          }
        })
      );
    }

    refreshStatuses();
    const timer = setInterval(refreshStatuses, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [recentJobs]);

  const navItems = [
    { to: "/run", label: "Run", icon: PlayCircle },
    { to: "/analysis", label: "Analysis", icon: BarChart3 },
    ...(isAdmin ? [{ to: "/admin", label: "Admin", icon: LayoutDashboard }] : []),
    { to: "/about", label: "About", icon: HelpCircle },
  ];

  const expanded = !collapsed;
  const sidebarWidth = expanded ? "w-72" : "w-16";

  const BrandIcon = (
    <GenocularLogo className="h-10 w-10" priority />
  );

  const Brand = (
    <Link
      to="/"
      className={[
        "flex min-h-11 items-center rounded-xl text-slate-950 transition hover:bg-slate-100",
        expanded ? "gap-3 px-2" : "justify-center",
      ].join(" ")}
      title="GENOCULAR"
    >
      {BrandIcon}
      {expanded && (
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-tight">
            GENOCULAR
          </span>
          <span className="block text-[11px] text-slate-500">
            Workflow dashboard
          </span>
        </span>
      )}
    </Link>
  );

  const NavItem = ({ item }) => {
    const Icon = item.icon;
    return (
      <NavLink
        to={item.to}
        title={item.label}
        className={({ isActive }) =>
          [
            "group flex h-11 items-center rounded-xl text-sm font-medium transition",
            expanded ? "gap-3 px-3" : "justify-center",
            isActive
              ? "bg-slate-950 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
          ].join(" ")
        }
      >
        <Icon className={navIconCls} />
        {expanded && <span>{item.label}</span>}
      </NavLink>
    );
  };

  const JobsSection = (
    <div>
      <div
        className={[
          "flex h-11 items-center rounded-xl text-sm font-medium transition",
          expanded ? "gap-2 px-3" : "justify-center",
          location.pathname === "/jobs"
            ? "bg-slate-950 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
        ].join(" ")}
      >
        <Link
          to="/jobs"
          title="Jobs"
          className={[
            "flex min-w-0 flex-1 items-center",
            expanded ? "gap-3" : "justify-center",
          ].join(" ")}
        >
          <Clock3 className={navIconCls} />
          {expanded && <span>Jobs</span>}
        </Link>
        {expanded && (
          <button
            type="button"
            onClick={() => setJobsOpen((open) => !open)}
            aria-label={jobsOpen ? "Collapse recent jobs" : "Expand recent jobs"}
            aria-expanded={jobsOpen}
            className={[
              "grid h-7 w-7 place-items-center rounded-lg transition",
              location.pathname === "/jobs"
                ? "text-white/80 hover:bg-white/10 hover:text-white"
                : "text-slate-400 hover:bg-white hover:text-slate-700",
            ].join(" ")}
          >
            <ChevronDown
              className={[
                "h-4 w-4 transition-transform",
                jobsOpen ? "rotate-180" : "",
              ].join(" ")}
            />
          </button>
        )}
      </div>

      {expanded && jobsOpen && (
        <div className="mt-2 space-y-1 border-l border-slate-200 pl-3 ml-5">
          {recentJobs.length ? (
            recentJobs.map((job) => {
              const status = statusMap[job.jobId]?.state || "unknown";
              const normalizedStatus = normalizeState(status);
              const opensProgress = normalizedStatus !== "completed";
              return (
                <Link
                  key={job.jobId}
                  to={
                    opensProgress
                      ? `/run?job_id=${encodeURIComponent(job.jobId || "")}`
                      : `/jobs?job_id=${encodeURIComponent(job.jobId || "")}&view=explorer`
                  }
                  state={
                    opensProgress
                      ? undefined
                      : {
                        openArtifactExplorer: true,
                        jobId: job.jobId,
                        openedAt: Date.now(),
                      }
                  }
                  className="block rounded-lg px-3 py-2 text-left transition hover:bg-slate-100"
                  title={job.jobId}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={[
                        "h-2 w-2 shrink-0 rounded-full",
                        statusDotClass(status),
                      ].join(" ")}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">
                      {displaySample(job.sampleId)}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>{statusLabel(status)}</span>
                    <span>{formatJobTime(job.ts) || shortJobId(job.jobId)}</span>
                  </span>
                </Link>
              );
            })
          ) : (
            <div className="rounded-lg px-3 py-2 text-xs text-slate-500">
              No recent jobs
            </div>
          )}
        </div>
      )}
    </div>
  );

  const AccountArea = user ? (
    <div
      className={[
        "genocular-sidebar-account mt-auto border-t border-slate-200 pt-4",
        expanded ? "space-y-2" : "flex flex-col items-center gap-3",
      ].join(" ")}
    >
      <Link
        to="/profile"
        title="Profile and preferences"
        className={[
          "genocular-sidebar-profile-link flex items-center rounded-xl transition",
          expanded ? "gap-3 px-2 py-2" : "justify-center py-2",
          expanded
            ? "hover:bg-slate-100"
            : "h-11 w-11 hover:bg-slate-100",
        ].join(" ")}
      >
        <span className="genocular-sidebar-avatar grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-800">
          {showImg && computedPhoto ? (
            <img
              src={computedPhoto}
              alt="Profile"
              className="h-9 w-9 object-cover"
              referrerPolicy="no-referrer"
              onError={() => setShowImg(false)}
            />
          ) : (
            initial
          )}
        </span>
        {expanded && (
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-slate-900">
              {user.displayName || user.email}
            </span>
            <span className="block text-[11px] text-slate-500">
              Preferences
            </span>
          </span>
        )}
      </Link>

      <div className={expanded ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
        <Link
          to="/profile"
          title="Preferences"
          className={[
            "genocular-sidebar-account-action grid place-items-center rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950",
            expanded ? "h-9" : "h-10 w-10",
          ].join(" ")}
        >
          {expanded ? "Profile" : <UserRound className="h-4 w-4" />}
        </Link>
        <button
          type="button"
          onClick={logout}
          title="Logout"
          className={[
            "genocular-sidebar-account-action grid place-items-center rounded-xl border bg-white text-xs font-medium transition",
            expanded
              ? "h-9 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              : "h-10 w-10 border-rose-100 text-rose-600 hover:border-rose-200 hover:bg-rose-50",
          ].join(" ")}
        >
          {expanded ? "Logout" : <LogOut className="h-4 w-4" />}
        </button>
      </div>
    </div>
  ) : (
    <div className="mt-auto border-t border-slate-200 pt-4">
      <DisplaySettingsMenu expanded={expanded} placement="top" />
    </div>
  );

  const SidebarContent = ({ mobile = false }) => (
    <>
      <div
        className={[
          "flex gap-2",
          expanded ? "items-center justify-between" : "flex-col items-center gap-3",
        ].join(" ")}
      >
        {expanded ? Brand : BrandIcon}
        <button
          type="button"
          onClick={() => (mobile ? setMobileOpen(false) : setCollapsed(!collapsed))}
          aria-label={
            mobile
              ? "Close navigation menu"
              : expanded
                ? "Collapse navigation menu"
                : "Expand navigation menu"
          }
          title={
            mobile
              ? "Close"
              : expanded
                ? "Collapse sidebar"
                : "Expand sidebar"
          }
          className={[
            "grid shrink-0 place-items-center border bg-white transition",
            expanded || mobile
              ? "h-9 w-9 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              : "h-8 w-11 rounded-full border-slate-200 text-slate-500 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950",
          ].join(" ")}
        >
          {mobile ? (
            <X className="h-4 w-4" />
          ) : expanded ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="mt-5 space-y-1.5" aria-label="Primary navigation">
        <NavLink
          to="/"
          title="Home"
          className={({ isActive }) =>
            [
              "flex h-11 items-center rounded-xl text-sm font-medium transition",
              expanded ? "gap-3 px-3" : "justify-center",
              isActive
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
            ].join(" ")
          }
        >
          <Home className={navIconCls} />
          {expanded && <span>Home</span>}
        </NavLink>

        <NavItem item={navItems[0]} />
        {user && JobsSection}
        {navItems.slice(1).map((item) => (
          <NavItem key={item.to} item={item} />
        ))}
      </nav>

      {AccountArea}
    </>
  );

  return (
    <>
      <div className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur-md lg:hidden">
        {Brand}
        <button
          type="button"
          onClick={() => {
            setCollapsed(false);
            setMobileOpen(true);
          }}
          aria-label="Open navigation menu"
          className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <aside
        className={[
          "genocular-sidebar-shell fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-slate-200 bg-white py-4 shadow-sm transition-[width] duration-200 lg:flex",
          expanded ? "px-3" : "px-2",
          sidebarWidth,
        ].join(" ")}
      >
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation backdrop"
            className="absolute inset-0 bg-slate-950/35"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="genocular-sidebar-shell absolute inset-y-0 left-0 flex w-80 max-w-[86vw] flex-col bg-white px-4 py-4 shadow-2xl">
            <SidebarContent mobile />
          </aside>
        </div>
      )}
    </>
  );
}
