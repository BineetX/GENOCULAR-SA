/* eslint-disable react-refresh/only-export-components -- plot theme context is shared with dashboards */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { scientificFigure } from "../AnalysisPlot.jsx";
import { compactLayout } from "./compactLayout.js";
import PlotControls from "../PlotControls.jsx";
import { copyPlotFigure, plotConfiguration } from "../plotControls.js";

export const UpdatedPlotTheme = createContext({
  plotStyle: "modern",
  publicationPalette: "okabe_ito",
});

let plotlyPromise;
const EMPTY_CONFIG = {};
function loadPlotly() {
  if (!plotlyPromise) {
    plotlyPromise = import("plotly.js-dist-min").then((module) => module.default || module);
  }
  return plotlyPromise;
}

export default function UpdatedPlot({ data = [], layout = {}, config = EMPTY_CONFIG, style = {}, panelTitle = "" }) {
  const node = useRef(null);
  const plotly = useRef(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const theme = useContext(UpdatedPlotTheme);
  const figure = useMemo(
    () => scientificFigure({ data, layout: compactLayout(layout, { ...theme, panelTitle }) }, theme),
    [data, layout, theme, panelTitle]
  );
  const plotConfig = useMemo(() => plotConfiguration(config), [config]);

  useEffect(() => {
    let active = true;
    const target = node.current;
    if (!target) return undefined;
    setReady(false);
    loadPlotly()
      .then(async (instance) => {
        if (!active) return;
        plotly.current = instance;
        const original = copyPlotFigure(figure);
        await instance.react(target, original.data, original.layout, plotConfig);
        if (active) { setError(""); setReady(true); }
      })
      .catch((cause) => {
        if (active) setError(cause?.message || String(cause));
      });
    return () => { active = false; };
  }, [figure, plotConfig]);

  useEffect(() => {
    const target = node.current;
    return () => {
      if (plotly.current && target) plotly.current.purge(target);
    };
  }, []);

  return (
    <div className="relative min-w-0" data-updated-plot style={{ width: "100%", ...style, height: "auto" }}>
      <div className="mb-1 flex justify-end px-1" data-plot-toolbar>
        <PlotControls plotRef={node} plotlyRef={plotly} figure={figure} config={plotConfig} disabled={!ready || Boolean(error)} publication={theme.plotStyle === "publication"} filename={config.toImageButtonOptions?.filename || `${theme.sample || "analysis"}_${theme.renderer || "plot"}`} />
      </div>
      <div ref={node} className="min-w-0" style={{ width: "100%", height: style.height || figure.layout.height || 420 }} />
      {error && <div className="px-3 py-2 text-xs text-rose-700">{error}</div>}
    </div>
  );
}
