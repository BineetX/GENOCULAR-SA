import React, { useEffect, useId, useRef, useState } from "react";
import { Check, KeyRound, Moon, PanelLeft, PanelTop, Settings2, Sun } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { FONT_SIZES, useFontSize } from "../lib/FontSizeContext.jsx";
import { NAV_STYLES, useNavPrefs } from "../lib/NavPrefsContext.jsx";
import { THEMES, useTheme } from "../lib/ThemeContext.jsx";

const textSizes = [
  { value: FONT_SIZES.XSMALL, label: "XS" },
  { value: FONT_SIZES.SMALL, label: "S" },
  { value: FONT_SIZES.MEDIUM, label: "M" },
  { value: FONT_SIZES.LARGE, label: "L" },
  { value: FONT_SIZES.XLARGE, label: "XL" },
];

function ChoiceButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition",
        active
          ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
          : "text-slate-500 hover:bg-white/70 hover:text-slate-800",
      ].join(" ")}
    >
      {children}
      {active && <Check className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />}
    </button>
  );
}

export default function DisplaySettingsMenu({ expanded = false, placement = "bottom" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { fontSize, setFontSize } = useFontSize();
  const { navStyle, setNavStyle } = useNavPrefs();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const menuPosition =
    placement === "top"
      ? "bottom-full left-0 mb-2"
      : "right-0 top-full mt-2";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="Display settings"
        aria-label="Display settings"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={[
          "grid place-items-center border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950",
          expanded
            ? "h-10 w-full grid-cols-[auto_1fr_auto] gap-2 rounded-xl px-3 text-sm font-medium"
            : "h-9 w-9 rounded-full",
        ].join(" ")}
      >
        <Settings2 className="h-4 w-4" aria-hidden="true" />
        {expanded && <span className="text-left">Display</span>}
        {expanded && <span className="text-xs text-slate-400">Aa</span>}
      </button>

      {open && (
        <div
          id={menuId}
          role="dialog"
          aria-label="Display settings"
          className={`absolute z-[70] w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_22px_60px_-28px_rgba(15,23,42,0.55)] ${menuPosition}`}
        >
          <div className="px-1 pb-3">
            <div className="text-sm font-semibold text-slate-900">Display</div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="mb-1.5 px-1 text-xs font-medium text-slate-500">Theme</div>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                <ChoiceButton
                  active={theme === THEMES.LIGHT}
                  onClick={() => setTheme(THEMES.LIGHT)}
                >
                  <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                  Light
                </ChoiceButton>
                <ChoiceButton
                  active={theme === THEMES.DARK}
                  onClick={() => setTheme(THEMES.DARK)}
                >
                  <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                  Dark
                </ChoiceButton>
              </div>
            </div>

            <div>
              <div className="mb-1.5 px-1 text-xs font-medium text-slate-500">Text size</div>
              <div className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1">
                {textSizes.map((size) => (
                  <button
                    key={size.value}
                    type="button"
                    aria-label={`${size.value} text`}
                    aria-pressed={fontSize === size.value}
                    onClick={() => setFontSize(size.value)}
                    className={[
                      "grid h-9 place-items-center rounded-lg text-xs font-semibold transition",
                      fontSize === size.value
                        ? "bg-white text-sky-700 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-500 hover:bg-white/70 hover:text-slate-800",
                    ].join(" ")}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 px-1 text-xs font-medium text-slate-500">Navigation</div>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                <ChoiceButton
                  active={navStyle === NAV_STYLES.TOPBAR}
                  onClick={() => setNavStyle(NAV_STYLES.TOPBAR)}
                >
                  <PanelTop className="h-3.5 w-3.5" aria-hidden="true" />
                  Top
                </ChoiceButton>
                <ChoiceButton
                  active={navStyle === NAV_STYLES.SIDEBAR}
                  onClick={() => setNavStyle(NAV_STYLES.SIDEBAR)}
                >
                  <PanelLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Side
                </ChoiceButton>
              </div>
            </div>
          </div>

          <div className="mt-3 border-t border-slate-100 pt-2">
            <Link
              to="/signin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              Staff sign in
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
