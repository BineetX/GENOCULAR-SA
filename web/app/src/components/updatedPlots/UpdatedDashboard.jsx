/* eslint-disable react-refresh/only-export-components -- dashboard registry is shared with report export */
import React, { Suspense, lazy, useEffect, useMemo } from "react";
import { UpdatedPlotTheme } from "./UpdatedPlot.jsx";
import "./dashboards.css";

const DASHBOARDS = {
  wgs_preprocessing: lazy(() => import("./wgs/WGSPreprocessingDashboard.jsx")),
  wgs_lr_preprocessing: lazy(() => import("./wgs/WGSLRPreprocessingDashboard.jsx")),
  wgs_quality_v2: lazy(() => import("./wgs/WGSCheckmBuscoDashboard.jsx")),
  wgs_prokka_v2: lazy(() => import("./wgs/ProkkaDashboard.jsx")),
  wgs_interpro_v2: lazy(() => import("./wgs/InterproscanDashboard.jsx")),
  wgs_kofam_v2: lazy(() => import("./wgs/KofamDashboard.jsx")),
  wgs_cazymes_v2: lazy(() => import("./wgs/CazymeDashboard.jsx")),
  wgs_cog_v2: lazy(() => import("./wgs/EmapperDashboard.jsx")),
  wgs_amr_v2: lazy(() => import("./wgs/AMRDashboard.jsx")),
  wgs_repeats_v2: lazy(() => import("./wgs/RepeatmaskerDashboard.jsx")),
  wgs_sr_hexbin_v2: lazy(() => import("./wgs/WGSSRHexbinDashboard.jsx")),
  mag_assembly_v2: lazy(() => import("./meta/MAGAssemblyDashboard.jsx")),
  mag_binning_v2: lazy(() => import("./meta/MAGBinningDashboard.jsx")),
  mag_busco_v2: lazy(() => import("./meta/MAGBuscoDashboard.jsx")),
  mag_barrnap_v2: lazy(() => import("./meta/MAGBarrnapDashboard.jsx")),
  mag_prokka_v2: lazy(() => import("./meta/MAGProkkaDashboard.jsx")),
  mag_dbcan_v2: lazy(() => import("./meta/MAGDbcanDashboard.jsx")),
  mag_hadeg_v2: lazy(() => import("./meta/MAGHadegDashboard.jsx")),
  mag_metaphlan_v2: lazy(() => import("./meta/MAGMetaphlanDashboard.jsx")),
  mag_metaphlan_alpha_v2: lazy(() => import("./meta/MAGMetaphlanAlphaDashboard.jsx")),
  mag_virsorter_v2: lazy(() => import("./meta/MAGVirsorterDashboard.jsx")),
  mag_nonpareil_v2: lazy(() => import("./meta/MAGNonpareilDashboard.jsx")),
};

export const UPDATED_DASHBOARD_RENDERERS = new Set(Object.keys(DASHBOARDS));

export default function UpdatedDashboard({
  renderer,
  payload,
  assetUrl,
  plotStyle = "modern",
  publicationPalette = "okabe_ito",
}) {
  const Dashboard = DASHBOARDS[renderer];
  const src = useMemo(
    () => payload ? URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" })) : "",
    [payload]
  );
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  const theme = useMemo(() => ({
    plotStyle, publicationPalette, renderer,
    sample: payload?.sample_id || payload?.sample || payload?.isolate_name || "",
    captions: [payload?.meta?.caption, payload?.meta?.source_line],
  }), [plotStyle, publicationPalette, renderer, payload]);
  if (!Dashboard || !src) return null;
  return (
    <UpdatedPlotTheme.Provider value={theme}>
      <div className="updated-dashboard min-w-0 max-w-full overflow-x-auto bg-white text-slate-900" data-dashboard-family={renderer.startsWith("mag_") ? "meta" : "wgs"}>
        <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-sky-50" />}>
          <Dashboard src={src} assetUrl={assetUrl} />
        </Suspense>
      </div>
    </UpdatedPlotTheme.Provider>
  );
}
