import React, { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { usePersistentState, useSessionState } from "../lib/usePersistentState.js";
import { apiJson } from "../lib/api.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import { useTheme } from "../lib/ThemeContext.jsx";
import { motion } from "framer-motion";
import {
  FileUp,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Image as ImageIcon,
  FileJson as FileJsonIcon,
  SlidersHorizontal,
  Layers,
  Palette,
  X,
} from "lucide-react";
import "cgview/dist/cgview.css";

/* ---------- UI defaults ---------- */
const DEFAULT_UI = {
  theme: "light",             // light | dark
  format: "circular",         // circular | linear
  showLabels: true,
  showShading: true,          // parsed path still handled via JSON build
  legendPos: "bottom-right",  // keep away from sticky header by default
  arrowLen: 0.30,             // 0.10 – 0.60 looks good
  showCDS: true,
  showTRNA: true,
  showRRNA: true,
  showGCContent: true,
  showGCSkew: true,
  plotThickness: 2,           // 1–4
};

/* Build a CGView config from current UI settings (used on initial load & rebuilds) */
function buildConfig(ui) {
  const isDark = ui.theme === "dark";
  const base = {
    settings: {
      backgroundColor: isDark ? "#0b0f19" : "#ffffff",
      format: ui.format,                  // <-- important
      arrowHeadLength: ui.arrowLen,
    },
    ruler: { font: "sans-serif, plain, 10", color: isDark ? "#e5e7eb" : "black" },
    legend: {
      position: ui.legendPos,
      defaultFont: "sans-serif, plain, 14",
      defaultFontColor: isDark ? "#e5e7eb" : "#111827",
      backgroundColor: isDark ? "rgba(17,24,39,0.85)" : "#ffffff",
      items: [
        { name: "CDS",        swatchColor: isDark ? "rgba(88,141,255,0.55)" : "rgba(0,0,153,0.5)", decoration: "arrow" },
        { name: "tRNA",       swatchColor: isDark ? "rgba(220,105,255,0.55)" : "rgba(153,0,153,0.5)" },
        { name: "rRNA",       swatchColor: isDark ? "rgba(80,220,160,0.55)" : "rgba(0,153,53,0.5)" },
        { name: "GC Content", swatchColor: isDark ? "rgba(255,255,255,0.6)"  : "rgba(0,0,0,0.6)" },
        { name: "GC Skew+",   swatchColor: "rgba(231,76,60,0.7)" },
        { name: "GC Skew−",   swatchColor: "rgba(52,152,219,0.7)" },
      ],
    },
    tracks: [],
  };

  if (ui.showGCContent) {
    base.tracks.push({
      name: "GC Content",
      thicknessRatio: ui.plotThickness,
      position: "inside",
      dataType: "plot",
      dataMethod: "sequence",
      dataKeys: "gc-content",
    });
  }
  if (ui.showGCSkew) {
    base.tracks.push({
      name: "GC Skew",
      thicknessRatio: ui.plotThickness,
      position: "inside",
      dataType: "plot",
      dataMethod: "sequence",
      dataKeys: "gc-skew",
    });
  }
  return base;
}

function findAssemblyGbk(items = []) {
  const exact =
    items.find((it) => /antismash_results\/assembly\.gbk$/i.test(String(it?.key || ""))) ||
    items.find((it) => /assembly\.gbk$/i.test(String(it?.key || "")));
  if (exact) return exact;

  const antiSmashGbks = items.filter((it) =>
    /antismash_results\/.+\.(gbk|gb|genbank)$/i.test(String(it?.key || ""))
  );
  return antiSmashGbks[0] || null;
}

function findAntiSmashIndex(items = []) {
  return items.find((it) => /antismash_results\/index\.html$/i.test(String(it?.key || ""))) || null;
}

function findNanoPlotIndex(items = []) {
  return items.find((it) => /nanoplot\/nanoplot-report\.html$/i.test(String(it?.key || ""))) || null;
}

function findCrisprPlot(items = []) {
  return items.find((it) => /crispr_output\/plot\.png$/i.test(String(it?.key || ""))) || null;
}

function findAnalysisIndex(items = []) {
  return items.find((it) => /analysis\/index\.json$/i.test(String(it?.key || ""))) || null;
}

function isRelativeAssetRef(ref = "") {
  const s = String(ref || "").trim();
  if (!s) return false;
  if (s.startsWith("#")) return false;
  if (/^(https?:)?\/\//i.test(s)) return false;
  if (/^(data|mailto|tel|javascript):/i.test(s)) return false;
  return true;
}

function rewriteReportHtmlWithSignedAssets(html, reportKey, items = []) {
  const prefix = reportKey.slice(0, reportKey.lastIndexOf("/") + 1);
  const urlByRel = new Map();
  for (const it of items) {
    const key = String(it?.key || "");
    if (!key.startsWith(prefix)) continue;
    const rel = key.slice(prefix.length);
    if (!rel) continue;
    const signed = it?.url || "";
    if (!signed) continue;
    urlByRel.set(rel, signed);
    urlByRel.set(rel.replace(/^\.\/+/, ""), signed);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const baseEl = doc.querySelector("base") || doc.createElement("base");
  // srcDoc pages resolve relative/hash URLs against the parent page unless base is set.
  baseEl.setAttribute("href", "about:srcdoc");
  baseEl.setAttribute("target", "_self");
  if (!doc.querySelector("base") && doc.head) doc.head.prepend(baseEl);

  for (const n of doc.querySelectorAll("a[target], form[target], button[formtarget], input[formtarget], base[target]")) {
    if (n.hasAttribute("target")) n.setAttribute("target", "_self");
    if (n.hasAttribute("formtarget")) n.setAttribute("formtarget", "_self");
  }

  const attrs = ["href", "src", "poster", "data", "action", "formaction"];
  for (const attr of attrs) {
    const nodes = doc.querySelectorAll(`[${attr}]`);
    for (const el of nodes) {
      const raw = el.getAttribute(attr) || "";
      if (attr === "href" && raw.startsWith("#")) {
        el.setAttribute(attr, `about:srcdoc${raw}`);
        continue;
      }
      if (!isRelativeAssetRef(raw)) continue;
      const relPath = new URL(raw, "http://local/").pathname.replace(/^\/+/, "");
      const signed = urlByRel.get(relPath) || urlByRel.get(relPath.replace(/^\.\/+/, ""));
      if (signed) {
        el.setAttribute(attr, signed);
      } else if (attr === "href" || attr === "action" || attr === "formaction") {
        // Avoid navigating to app routes from embedded reports.
        if (raw.startsWith("/")) {
          if (attr === "href") el.setAttribute(attr, "#");
          else el.removeAttribute(attr);
        }
      }
    }
  }

  // Guard against form/link-driven navigation to app routes from embedded reports.
  const guard = doc.createElement("script");
  guard.textContent = `
    (function() {
      function isBlockedLocalPath(v) {
        var s = String(v || "").trim();
        if (!s) return true;
        return s.startsWith("/");
      }
      document.addEventListener("submit", function(ev) {
        var form = ev.target;
        if (!form || !form.getAttribute) return;
        var action = form.getAttribute("action");
        if (isBlockedLocalPath(action)) ev.preventDefault();
      }, true);
      document.addEventListener("click", function(ev) {
        var el = ev.target;
        if (!el || !el.closest) return;
        var a = el.closest("a[href]");
        if (!a) return;
        var href = a.getAttribute("href");
        if (isBlockedLocalPath(href)) ev.preventDefault();
      }, true);
    })();
  `;
  if (doc.body) doc.body.appendChild(guard);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export default function GenomeViewer() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const authUserId = user?.uid || "";
  const [searchParams] = useSearchParams();
  const jobIdFromQuery = String(searchParams.get("job_id") || "").trim();
  const isAnalyzeLaunch = Boolean(jobIdFromQuery);
  const fileInputRef   = useRef(null);
  const jsonInputRef   = useRef(null);
  const surfaceRef     = useRef(null);
  const viewerRef      = useRef(null);
  const CGViewRef      = useRef(null);
  const CGParseRef     = useRef(null);
  const lastJSONRef    = useRef(null);    // current map JSON (if any)
  const originalTextRef= useRef("");      // original GenBank text for rebuilds
  const viewerIdRef    = useRef(`cgv-${Math.random().toString(36).slice(2)}`);

  const [ready, setReady]       = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [preloadNote, setPreloadNote] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [jobResultItems, setJobResultItems] = useState([]);
  const [crisprPlotItem, setCrisprPlotItem] = useState(null);
  const [antiSmashIndexItem, setAntiSmashIndexItem] = useState(null);
  const [antiSmashSrcDoc, setAntiSmashSrcDoc] = useState("");
  const [antiSmashBusy, setAntiSmashBusy] = useState(false);
  const [antiSmashError, setAntiSmashError] = useState("");
  const [nanoPlotIndexItem, setNanoPlotIndexItem] = useState(null);
  const [nanoPlotSrcDoc, setNanoPlotSrcDoc] = useState("");
  const [nanoPlotBusy, setNanoPlotBusy] = useState(false);
  const [nanoPlotError, setNanoPlotError] = useState("");
  const [analysisIndexItem, setAnalysisIndexItem] = useState(null);
  const [analysisCards, setAnalysisCards] = useState([]);
  const [analysisCardsBusy, setAnalysisCardsBusy] = useState(false);
  const [analysisCardsError, setAnalysisCardsError] = useState("");
  /*const [fileName, setFileName] = useState("");
  const [bpLength, setBpLength] = useState(null);
  const [ui, setUI]             = useState(DEFAULT_UI);*/
  const [fileName, setFileName] = usePersistentState("gv:fileName", "");
  const [bpLength, setBpLength] = usePersistentState("gv:bpLen", null);
  const [ui, setUI]             = usePersistentState("gv:ui", DEFAULT_UI);
  const [lastMapJSON, setLastMapJSON] = useSessionState("gv:mapJSON", null);
  const lastAutoLoadJobRef = useRef("");
  

  /* ---------- Load libs ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [CGView, CGParse] = await Promise.all([import("cgview"), import("cgparse")]);
        if (cancelled) return;
        CGViewRef.current  = CGView;
        CGParseRef.current = CGParse;
        setReady(true);
      } catch (e) {
        setError(`Failed to initialize viewer: ${e?.message || e}`);
      }
    })();
    return () => { cancelled = true; try { viewerRef.current?.reset?.(); } catch {} };
  }, []);

  /* ---------- Fill viewport ---------- */
  const sizeSurfaceToViewport = useCallback(() => {
    if (!surfaceRef.current) return;
    const bottomPad = 16;
    const top = surfaceRef.current.getBoundingClientRect().top;
    surfaceRef.current.style.height = `${Math.max(520, Math.floor(window.innerHeight - top - bottomPad))}px`;
  }, []);

  /* ---------- Create/resize/draw viewer (only when JSON exists) ---------- */
  const ensureViewer = useCallback(() => {
    if (!ready || !surfaceRef.current || !CGViewRef.current) return;
    const mountSel = `#${viewerIdRef.current}`;

    if (!lastJSONRef.current) {
      if (viewerRef.current) { try { viewerRef.current.reset?.(); } catch {} viewerRef.current = null; }
      const mount = document.querySelector(mountSel);
      if (mount) mount.innerHTML = "";
      return;
    }

    const rect = surfaceRef.current.getBoundingClientRect();
    const width  = Math.max(520, Math.floor(rect.width));
    const height = Math.max(520, Math.floor(rect.height));

    if (!viewerRef.current) {
      viewerRef.current = new CGViewRef.current.Viewer(mountSel, { width, height });
    } else if (typeof viewerRef.current.resize === "function") {
      viewerRef.current.resize(width, height);
    }
    viewerRef.current.io.loadJSON(lastJSONRef.current);
    viewerRef.current.draw();
  }, [ready]);

  const clearAnalysisArtifacts = useCallback(() => {
    setJobResultItems([]);
    setCrisprPlotItem(null);
    setAntiSmashIndexItem(null);
    setAntiSmashSrcDoc("");
    setAntiSmashError("");
    setNanoPlotIndexItem(null);
    setNanoPlotSrcDoc("");
    setNanoPlotError("");
    setAnalysisIndexItem(null);
    setAnalysisCards([]);
    setAnalysisCardsError("");
  }, []);

  const clearRenderedGenome = useCallback(() => {
    lastJSONRef.current = null;
    originalTextRef.current = "";
    setFileName("");
    setBpLength(null);
    setLastMapJSON(null);
    ensureViewer();
  }, [ensureViewer, setBpLength, setFileName, setLastMapJSON]);

  useEffect(() => {
    if (!ready) return;
    sizeSurfaceToViewport();
    ensureViewer();
    const onResize = () => { sizeSurfaceToViewport(); ensureViewer(); };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => onResize());
    ro.observe(document.body);
    return () => { window.removeEventListener("resize", onResize); ro.disconnect(); };
  }, [ready, sizeSurfaceToViewport, ensureViewer]);

  useEffect(() => {
    lastAutoLoadJobRef.current = "";
    clearAnalysisArtifacts();
    if (isAnalyzeLaunch) {
      clearRenderedGenome();
      setPreloadNote("");
    }
  }, [authUserId, isAnalyzeLaunch, clearAnalysisArtifacts, clearRenderedGenome]);

  /* ---------- Helper: which features to exclude when (re)parsing ---------- */
  const computeExclude = (state) => {
    const ex = ["source", "exon"];
    if (!state.showCDS)  ex.push("CDS");
    if (!state.showTRNA) ex.push("tRNA");
    if (!state.showRRNA) ex.push("rRNA");
    return ex;
  };

  /* ---------- Live styling (no rebuild) ---------- */
  const applyLiveStyling = useCallback((nextUI) => {
    const v = viewerRef.current;
    const s = nextUI || ui;
    if (!v || !lastJSONRef.current) return;

    const isDark = s.theme === "dark";
    // Settings (+ format) and background
    v.settings.update({
      backgroundColor: isDark ? "#0b0f19" : "#ffffff",
      format: s.format,                      // instant circular/linear switch
    });
    // Legend visibility & style
    v.legend.update({
      position: s.legendPos,
      defaultFontColor: isDark ? "#e5e7eb" : "#111827",
      backgroundColor: isDark ? "rgba(17,24,39,0.85)" : "#ffffff",
    });
    // Ruler color for dark/light
    try { v.ruler.color = isDark ? "#e5e7eb" : "black"; } catch {}
    // Labels on/off (annotation)
    try { v.annotation.update({ visible: s.showLabels }); } catch {}
    v.draw();
  }, [ui]);

  /* ---------- Rebuild from original GenBank text ---------- */
  const rebuildFromUI = useCallback(() => {
    if (!originalTextRef.current || !CGParseRef.current) return;
    try {
      const seq = new CGParseRef.current.SequenceFile(originalTextRef.current);
      const json = seq.toCGViewJSON({
        config: buildConfig(ui),
        excludeFeatures: computeExclude(ui),
        excludeQualifiers: ["translation"],
      });
      lastJSONRef.current = json;
      setBpLength(json?.sequence?.length || json?.sequence?.bpLength || null);
      ensureViewer();
      // Apply live tweaks again (legend/ruler/theme might need reinforcing)
      applyLiveStyling();
    } catch (e) {
      setError(`Failed to rebuild: ${e?.message || e}`);
    }
  }, [ui, ensureViewer, applyLiveStyling]);

  /* ---------- Loaders ---------- */
  const loadGenbankText = useCallback(async (text, name = "") => {
    if (!ready || !CGParseRef.current) return;
    setBusy(true); setError(null);
    try {
      originalTextRef.current = text;
      const seq = new CGParseRef.current.SequenceFile(text);
      const json = seq.toCGViewJSON({
        config: buildConfig(ui),
        excludeFeatures: computeExclude(ui),
        excludeQualifiers: ["translation"],
      });
      lastJSONRef.current = json;
      sizeSurfaceToViewport();
      ensureViewer();
      // Apply live styling right after first draw
      applyLiveStyling();
      setFileName(name || "");
      setBpLength(json?.sequence?.length || json?.sequence?.bpLength || null);
    } catch (e) {
      setError(`Failed to parse GenBank: ${e?.message || e}`);
      lastJSONRef.current = null; setFileName(""); setBpLength(null); ensureViewer();
    } finally { setBusy(false); }
  }, [ready, ui, sizeSurfaceToViewport, ensureViewer, applyLiveStyling]);

  const loadCGViewJSON = async (file) => {
    setBusy(true); setError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      lastJSONRef.current = json;
      originalTextRef.current = ""; // unknown
      setFileName(file.name || "map.json");
      setBpLength(json?.sequence?.length || json?.sequence?.bpLength || null);
      sizeSurfaceToViewport(); ensureViewer();
      applyLiveStyling();
    } catch (e) {
      setError(`Invalid CGView JSON: ${e?.message || e}`);
    } finally { setBusy(false); }
  };

  /* ---------- Auto preload from job results ---------- */
  useEffect(() => {
    if (!ready) return;
    if (!jobIdFromQuery) return;
    if (lastAutoLoadJobRef.current === jobIdFromQuery) return;

    let cancelled = false;
    (async () => {
      setPreloadNote(`Loading antiSMASH assembly for job ${jobIdFromQuery}...`);
      setError(null);
      clearAnalysisArtifacts();
      clearRenderedGenome();
      try {
        const r = await apiJson(`/jobs/${jobIdFromQuery}/results`);
        const items = Array.isArray(r?.items) ? r.items : [];
        if (!cancelled) {
          setJobResultItems(items);
          setCrisprPlotItem(findCrisprPlot(items));
          setAntiSmashIndexItem(findAntiSmashIndex(items));
          setNanoPlotIndexItem(findNanoPlotIndex(items));
          setAnalysisIndexItem(findAnalysisIndex(items));
        }
        const target = findAssemblyGbk(items);
        if (!target?.url) {
          throw new Error("`antismash_results/assembly.gbk` not found in job outputs.");
        }

        const resp = await fetch(target.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`Failed to fetch assembly.gbk (HTTP ${resp.status}).`);
        const text = await resp.text();
        if (cancelled) return;
        await loadGenbankText(text, target.key.split("/").pop() || "assembly.gbk");
        if (cancelled) return;
        lastAutoLoadJobRef.current = jobIdFromQuery;
        setPreloadNote(`Loaded ${target.key} from job ${jobIdFromQuery}.`);
      } catch (e) {
        if (!cancelled) {
          clearAnalysisArtifacts();
          clearRenderedGenome();
          setPreloadNote("");
          setError(`Auto-load failed for job ${jobIdFromQuery}: ${e?.message || e}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, jobIdFromQuery, loadGenbankText, authUserId, clearAnalysisArtifacts, clearRenderedGenome]);

  useEffect(() => {
    if (!isAnalyzeLaunch) return;
    if (!antiSmashIndexItem?.url || !antiSmashIndexItem?.key) {
      setAntiSmashSrcDoc("");
      setAntiSmashError("");
      return;
    }

    let cancelled = false;
    (async () => {
      setAntiSmashBusy(true);
      setAntiSmashError("");
      try {
        const resp = await fetch(antiSmashIndexItem.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`Failed to load antiSMASH report (HTTP ${resp.status}).`);
        const html = await resp.text();
        if (cancelled) return;

        setAntiSmashSrcDoc(
          rewriteReportHtmlWithSignedAssets(html, antiSmashIndexItem.key, jobResultItems)
        );
      } catch (e) {
        if (!cancelled) {
          setAntiSmashSrcDoc("");
          setAntiSmashError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setAntiSmashBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAnalyzeLaunch, antiSmashIndexItem, jobResultItems]);

  useEffect(() => {
    if (!isAnalyzeLaunch) return;
    if (!nanoPlotIndexItem?.url || !nanoPlotIndexItem?.key) {
      setNanoPlotSrcDoc("");
      setNanoPlotError("");
      return;
    }

    let cancelled = false;
    (async () => {
      setNanoPlotBusy(true);
      setNanoPlotError("");
      try {
        const resp = await fetch(nanoPlotIndexItem.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`Failed to load NanoPlot report (HTTP ${resp.status}).`);
        const html = await resp.text();
        if (cancelled) return;
        setNanoPlotSrcDoc(
          rewriteReportHtmlWithSignedAssets(html, nanoPlotIndexItem.key, jobResultItems)
        );
      } catch (e) {
        if (!cancelled) {
          setNanoPlotSrcDoc("");
          setNanoPlotError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setNanoPlotBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAnalyzeLaunch, nanoPlotIndexItem, jobResultItems]);

  useEffect(() => {
    if (!isAnalyzeLaunch) return;
    if (!analysisIndexItem?.url) {
      setAnalysisCards([]);
      setAnalysisCardsError("");
      return;
    }

    let cancelled = false;
    const bySuffix = (relPath) => {
      const needle = `/${String(relPath || "").replace(/^\/+/, "")}`;
      return (
        jobResultItems.find((it) => String(it?.key || "").endsWith(needle)) ||
        jobResultItems.find((it) => String(it?.key || "") === String(relPath || ""))
      );
    };

    (async () => {
      setAnalysisCardsBusy(true);
      setAnalysisCardsError("");
      try {
        const resp = await fetch(analysisIndexItem.url, { credentials: "include" });
        if (!resp.ok) throw new Error(`Failed to load analysis index (HTTP ${resp.status}).`);
        const idx = await resp.json();
        if (cancelled) return;

        const sections = Array.isArray(idx?.sections) ? idx.sections : [];
        const cards = [];

        for (const sec of sections) {
          const relPath = String(sec?.path || "").trim();
          if (!relPath) continue;
          const item = bySuffix(relPath);
          if (!item?.url || !item?.key) continue;

          const card = {
            id: String(sec?.id || relPath),
            title: String(sec?.title || relPath.split("/").pop() || "Analysis"),
            type: String(sec?.type || "file").toLowerCase(),
            source: String(sec?.source || ""),
            path: relPath,
            url: item.url,
            key: item.key,
            srcDoc: "",
            error: "",
          };

          if (card.type === "html") {
            try {
              const hr = await fetch(item.url, { credentials: "include" });
              if (!hr.ok) throw new Error(`HTTP ${hr.status}`);
              const html = await hr.text();
              card.srcDoc = rewriteReportHtmlWithSignedAssets(html, item.key, jobResultItems);
            } catch (e) {
              card.error = e?.message || String(e);
            }
          }

          cards.push(card);
        }

        setAnalysisCards(cards);
      } catch (e) {
        if (!cancelled) {
          setAnalysisCards([]);
          setAnalysisCardsError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setAnalysisCardsBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAnalyzeLaunch, analysisIndexItem, jobResultItems]);

  /* ---------- File helpers ---------- */
  const chooseFile  = () => fileInputRef.current?.click();
  const chooseJSON  = () => jsonInputRef.current?.click();
  const onFile      = async (f) => { if (!f) return; loadGenbankText(await f.text(), f.name); };
  const onFileInput = (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); };
  const onJSONInput = (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) loadCGViewJSON(f); };
  const onDrop      = (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (!f) return; (/\.json$/i.test(f.name)) ? loadCGViewJSON(f) : onFile(f); };
  const onDragOver  = (e) => e.preventDefault();

  /* ---------- Controls ---------- */
  const clearAll  = () => {
    lastJSONRef.current = null; originalTextRef.current = "";
    try { viewerRef.current?.reset?.(); } catch {}
    viewerRef.current = null;
    const m = document.getElementById(viewerIdRef.current); if (m) m.innerHTML = "";
    setFileName(""); setBpLength(null); setError(null);
    setPreloadNote("");
    sizeSurfaceToViewport();
  };
  const zoomIn    = () => { try { viewerRef.current?.zoomIn?.(); } catch {} };
  const zoomOut   = () => { try { viewerRef.current?.zoomOut?.(); } catch {} };
  const fitToView = () => { try { viewerRef.current?.update?.(); viewerRef.current?.draw?.(); } catch {} };
  const exportPNG = () => {
    try {
      const H = 2600;
      const W = (viewerRef.current.width / viewerRef.current.height) * H;
      viewerRef.current.io.downloadImage(W, H, (fileName || "genome") + ".png");
    } catch {}
  };
  const exportSVG = () => { try { viewerRef.current.io.downloadSVG((fileName || "genome") + ".svg"); } catch {} };
  const exportJSON = () => {
    try {
      const blob = new Blob([JSON.stringify(lastJSONRef.current, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = (fileName?.replace(/\.(gb|gbk|genbank)$/i,"") || "map") + ".cgview.json";
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch {}
  };

  /* ---------- UI change helpers ---------- */
  const setAndRebuild = (patch) => {
    // Use rebuild path only for things that need seq→JSON regeneration (tracks, filters, arrowLen...)
    setUI(prev => {
      const next = { ...prev, ...patch };
      setTimeout(() => { if (lastJSONRef.current && originalTextRef.current) rebuildFromUI(); else ensureViewer(); }, 0);
      return next;
    });
  };

  const setAndApplyLive = (patch) => {
    // For format, theme, legendPos, showLabels — avoid heavy rebuild
    setUI(prev => {
      const next = { ...prev, ...patch };
      setTimeout(() => applyLiveStyling(next), 0);
      return next;
    });
  };

  useEffect(() => {
    const nextTheme = isDark ? "dark" : "light";
    setUI(prev => {
      if (prev.theme === nextTheme) return prev;
      const next = { ...prev, theme: nextTheme };
      setTimeout(() => applyLiveStyling(next), 0);
      return next;
    });
  }, [isDark, setUI, applyLiveStyling]);

  /* =================== RENDER =================== */
  return (
    <div className="genocular-analysis min-h-screen flex flex-col bg-gradient-to-b from-slate-50 via-white to-slate-50 text-slate-900">
      {/* Header */}
      <div
        className={
          isAnalyzeLaunch
            ? "px-4 lg:px-8 pt-5 pb-4 border-b border-slate-200/70 bg-white/95"
            : "px-4 lg:px-8 pt-5 pb-4 border-b border-slate-200/70 bg-white/70 backdrop-blur sticky top-0 z-30"
        }
      >
        <div className="w-full flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight truncate bg-clip-text text-transparent bg-gradient-to-r from-sky-600 to-emerald-500">
              Analysis
            </h1>
            <p className="text-sm text-slate-600 truncate">
              {isAnalyzeLaunch
                ? `Analyzing completed job ${jobIdFromQuery}.`
                : "Load a GenBank (.gb / .gbk) or CGView JSON and explore the genome map."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isAnalyzeLaunch && (
              <>
                <button
                  onClick={clearAll}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm hover:bg-slate-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
                <button
                  onClick={chooseFile}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-xs sm:text-sm text-white hover:bg-slate-800"
                >
                  <FileUp className="h-4 w-4" />
                  Choose file
                </button>
                <button
                  onClick={chooseJSON}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm hover:bg-slate-50"
                >
                  <FileJsonIcon className="h-4 w-4" />
                  Load JSON
                </button>
              </>
            )}
            <button
              onClick={() => setControlsOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm hover:bg-slate-50"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Controls
            </button>
            <input ref={fileInputRef} type="file" accept=".gb,.gbk,.genbank,.txt" className="hidden" onChange={onFileInput} />
            <input ref={jsonInputRef} type="file" accept=".json" className="hidden" onChange={onJSONInput} />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="w-full mt-2 sm:mt-3">
        <div className="px-4 lg:px-8 py-4">
          <div className="space-y-4">
            {(busy || preloadNote || error) && (
              <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                {busy && <div className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded p-2">Updating…</div>}
                {preloadNote && <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">{preloadNote}</div>}
                {error && <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</div>}
              </div>
            )}
            {/* Viewer card */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white/90 rounded-3xl border border-slate-200 shadow-[0_30px_60px_-32px_rgba(15,23,42,0.35)] overflow-hidden"
            >
              {/* Toolbar */}
              <div className="flex flex-col gap-3 border-b border-slate-200/70 bg-gradient-to-r from-slate-50 via-white to-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                    <span className="text-slate-500">File:</span> {fileName || "-"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                    <span className="text-slate-500">Length:</span>{" "}
                    {bpLength ? `${bpLength.toLocaleString()} bp` : "-"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={zoomOut} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50" title="Zoom out">
                    <ZoomOut className="h-3.5 w-3.5" /> Zoom
                  </button>
                  <button onClick={fitToView} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50" title="Fit">
                    <Maximize2 className="h-3.5 w-3.5" /> Fit
                  </button>
                  <button onClick={zoomIn} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50" title="Zoom in">
                    <ZoomIn className="h-3.5 w-3.5" /> Zoom
                  </button>
                  <div className="w-px h-6 bg-slate-200 mx-1" />
                  <button onClick={exportPNG} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50">
                    <ImageIcon className="h-3.5 w-3.5" /> PNG
                  </button>
                  <button onClick={exportSVG} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50">
                    <ImageIcon className="h-3.5 w-3.5" /> SVG
                  </button>
                  <button disabled={!lastJSONRef.current} onClick={exportJSON} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">
                    <FileJsonIcon className="h-3.5 w-3.5" /> JSON
                  </button>
                </div>
              </div>

              {/* Canvas surface */}
              <div className="relative">
                <div
                  ref={surfaceRef}
                  className="w-full"
                  style={{ background: ui.theme === "dark" ? "#0b0f19" : "#f9fafb" }}
                >
                  <div id={viewerIdRef.current} className="w-full h-full" />
                </div>

                {busy && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-sm">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
                      <div className="flex items-center gap-3 text-sm text-slate-700">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
                        <span className="font-medium">Genome is loading...</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Drag & drop overlay (until a map is loaded) */}
                {!lastJSONRef.current && !isAnalyzeLaunch && (
                  <div
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    className="absolute inset-0 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 z-10"
                  >
                    <div className="text-slate-800 text-base sm:text-lg font-medium">
                      Drag & drop a <span className="text-slate-900">.gb / .gbk</span> or <span className="text-slate-900">.json</span> file
                    </div>
                    <div className="text-xs text-slate-500 mt-1">or choose from your computer</div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={chooseFile} className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-3 py-2 text-xs hover:bg-slate-800">
                        <FileUp className="h-4 w-4" />
                        Choose file
                      </button>
                      <button onClick={chooseJSON} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50">
                        <FileJsonIcon className="h-4 w-4" />
                        Load JSON
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>

            {isAnalyzeLaunch && (
              <section className="space-y-4">
                {analysisCardsBusy && (
                  <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
                      Loading analysis outputs...
                    </div>
                  </div>
                )}

                {!analysisCardsBusy && analysisCardsError && (
                  <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700 shadow-sm">
                    {analysisCardsError}
                  </div>
                )}

                {!analysisCardsBusy && !analysisCardsError && analysisCards.length > 0 && (
                  <div className="space-y-4">
                    {analysisCards.map((card) => (
                      <div key={card.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
                            <p className="text-xs text-slate-500">
                              Rendered from <code>{card.path}</code>
                            </p>
                          </div>
                          <a
                            href={card.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            Open full file
                          </a>
                        </div>
                        {card.type === "html" && card.srcDoc && (
                          <iframe
                            title={card.title}
                            srcDoc={card.srcDoc}
                            className="mt-3 h-[900px] w-full rounded-2xl border border-slate-200 bg-white shadow-inner"
                            sandbox="allow-same-origin allow-scripts allow-forms"
                          />
                        )}
                        {card.type === "html" && !card.srcDoc && (
                          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                            {card.error || "Could not render this HTML report."}
                          </div>
                        )}
                        {card.type === "image" && (
                          <a
                            href={card.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
                          >
                            <img
                              src={card.url}
                              alt={card.title}
                              className="h-[480px] w-full object-contain bg-white"
                              loading="lazy"
                            />
                          </a>
                        )}
                        {card.type !== "image" && card.type !== "html" && (
                          <div className="mt-3 text-sm text-slate-500">
                            This file type is available via{" "}
                            <a href={card.url} target="_blank" rel="noreferrer" className="text-sky-700 underline">
                              download/open
                            </a>
                            .
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!analysisCardsBusy && !analysisCardsError && analysisCards.length === 0 && (
                  <>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">antiSMASH Report</h3>
                          <p className="text-xs text-slate-500">
                            Rendered from <code>antismash_results/index.html</code>
                          </p>
                        </div>
                        {antiSmashIndexItem?.url && (
                          <a
                            href={antiSmashIndexItem.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            Open full report
                          </a>
                        )}
                      </div>
                      {antiSmashBusy && (
                        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
                          Loading antiSMASH report...
                        </div>
                      )}
                      {!antiSmashBusy && antiSmashError && (
                        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                          {antiSmashError}
                        </div>
                      )}
                      {!antiSmashBusy && !antiSmashError && antiSmashSrcDoc && (
                        <iframe
                          title="antiSMASH report"
                          srcDoc={antiSmashSrcDoc}
                          className="mt-3 h-[900px] w-full rounded-2xl border border-slate-200 bg-white shadow-inner"
                          sandbox="allow-same-origin allow-scripts allow-forms"
                        />
                      )}
                      {!antiSmashBusy && !antiSmashError && !antiSmashSrcDoc && (
                        <div className="mt-3 text-sm text-slate-500">No antiSMASH HTML report found for this job.</div>
                      )}
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">NanoPlot Report</h3>
                          <p className="text-xs text-slate-500">
                            Rendered from <code>nanoplot/NanoPlot-report.html</code>
                          </p>
                        </div>
                        {nanoPlotIndexItem?.url && (
                          <a
                            href={nanoPlotIndexItem.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            Open full report
                          </a>
                        )}
                      </div>
                      {nanoPlotBusy && (
                        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
                          Loading NanoPlot report...
                        </div>
                      )}
                      {!nanoPlotBusy && nanoPlotError && (
                        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                          {nanoPlotError}
                        </div>
                      )}
                      {!nanoPlotBusy && !nanoPlotError && nanoPlotSrcDoc && (
                        <iframe
                          title="NanoPlot report"
                          srcDoc={nanoPlotSrcDoc}
                          className="mt-3 h-[900px] w-full rounded-2xl border border-slate-200 bg-white shadow-inner"
                          sandbox="allow-same-origin allow-scripts allow-forms"
                        />
                      )}
                      {!nanoPlotBusy && !nanoPlotError && !nanoPlotSrcDoc && (
                        <div className="mt-3 text-sm text-slate-500">No NanoPlot HTML report found for this job.</div>
                      )}
                    </div>

                    {crisprPlotItem?.url && (
                      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h3 className="text-base font-semibold text-slate-900">CRISPR Plot</h3>
                        <p className="text-xs text-slate-500">
                          Rendered from <code>crispr_output/plot.png</code>
                        </p>
                        <a
                          href={crisprPlotItem.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
                        >
                          <img
                            src={crisprPlotItem.url}
                            alt="CRISPR plot"
                            className="h-[480px] w-full object-contain bg-white"
                            loading="lazy"
                          />
                        </a>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {/* Controls drawer */}
            {controlsOpen && (
              <div className="fixed inset-0 z-[90]">
                <div
                  className="absolute inset-0 bg-slate-900/35"
                  onClick={() => setControlsOpen(false)}
                />
                <motion.aside
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute right-0 top-0 z-[91] h-full w-full max-w-md bg-white border-l border-slate-200 shadow-2xl overflow-y-auto p-4 space-y-5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-slate-900 text-white flex items-center justify-center">
                        <SlidersHorizontal className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="font-semibold">Map Controls</h2>
                        <p className="text-[11px] text-slate-500">Tweak display, features, and plots.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setControlsOpen(false)}
                      className="rounded-full border border-slate-200 bg-white p-1.5 hover:bg-slate-50"
                      aria-label="Close controls"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-sm space-y-1">
                <div><span className="text-slate-500">File:</span> {fileName || "-"}</div>
                <div><span className="text-slate-500">Length:</span> {bpLength ? `${bpLength.toLocaleString()} bp` : "-"}</div>
              </div>

              <div className="h-px bg-slate-200" />

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Palette className="h-4 w-4 text-slate-500" />
                  Display
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm">Theme</label>
                  <select
                    className="border border-slate-200 rounded-full px-3 py-1.5 text-sm bg-white"
                    value={ui.theme}
                    onChange={(e)=>setAndApplyLive({theme: e.target.value})}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm">Format</label>
                  <select
                    className="border border-slate-200 rounded-full px-3 py-1.5 text-sm bg-white"
                    value={ui.format}
                    onChange={(e)=>setAndApplyLive({format: e.target.value})}
                  >
                    <option value="circular">Circular</option>
                    <option value="linear">Linear</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm">Legend</label>
                  <select
                    className="border border-slate-200 rounded-full px-3 py-1.5 text-sm bg-white"
                    value={ui.legendPos}
                    onChange={(e)=>setAndApplyLive({legendPos: e.target.value})}
                  >
                    <option>bottom-right</option>
                    <option>bottom-left</option>
                    <option>top-right</option>
                    <option>top-left</option>
                  </select>
                </div>

                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Labels</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={ui.showLabels}
                      onChange={(e)=>setAndApplyLive({showLabels: e.target.checked})}
                    />
                    <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-slate-900" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                  </span>
                </label>

                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Shading</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={ui.showShading}
                      onChange={(e)=>setAndRebuild({showShading: e.target.checked})}
                    />
                    <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-slate-900" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                  </span>
                </label>

                <div className="text-sm">
                  <div className="flex items-center justify-between">
                    <span>Arrow head</span><span className="text-slate-500">{ui.arrowLen.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.10"
                    max="0.60"
                    step="0.02"
                    value={ui.arrowLen}
                    onChange={(e)=>setAndRebuild({arrowLen: parseFloat(e.target.value)})}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="h-px bg-slate-200" />

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Layers className="h-4 w-4 text-slate-500" />
                  Features
                </div>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>CDS</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={ui.showCDS}
                      onChange={(e)=>setAndRebuild({showCDS: e.target.checked})}
                    />
                    <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-slate-900" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                  </span>
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>tRNA</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={ui.showTRNA}
                      onChange={(e)=>setAndRebuild({showTRNA: e.target.checked})}
                    />
                    <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-slate-900" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                  </span>
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>rRNA</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={ui.showRRNA}
                      onChange={(e)=>setAndRebuild({showRRNA: e.target.checked})}
                    />
                    <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-slate-900" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                  </span>
                </label>
              </div>

              <div className="h-px bg-slate-200" />

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <SlidersHorizontal className="h-4 w-4 text-slate-500" />
                  Plots
                </div>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>GC Content</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={ui.showGCContent}
                      onChange={(e)=>setAndRebuild({showGCContent: e.target.checked})}
                    />
                    <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-slate-900" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                  </span>
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>GC Skew</span>
                  <span className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={ui.showGCSkew}
                      onChange={(e)=>setAndRebuild({showGCSkew: e.target.checked})}
                    />
                    <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-slate-900" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                  </span>
                </label>
                <div className="text-sm">
                  <div className="flex items-center justify-between">
                    <span>Plot thickness</span><span className="text-slate-500">{ui.plotThickness.toFixed(1)}×</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="4"
                    step="0.5"
                    value={ui.plotThickness}
                    onChange={(e)=>setAndRebuild({plotThickness: parseFloat(e.target.value)})}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="pt-2 text-xs text-slate-500">
                Tip: You can drop a <code>.json</code> exported CGView map to reload an existing figure.
              </div>
                </motion.aside>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
