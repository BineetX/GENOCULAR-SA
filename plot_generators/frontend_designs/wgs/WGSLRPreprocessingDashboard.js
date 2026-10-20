import React, { useState, useEffect } from 'react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

const Plot = createPlotlyComponent(Plotly);

const WGSLRPreprocessingDashboard = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/wgs_lr_preprocessing_data.json')
      .then((response) => response.json())
      .then((json) => setData(json))
      .catch((error) => console.error("Error loading Long-Read QC data:", error));
  }, []);

  if (!data) return <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif' }}>Loading Long-Read Data...</div>;

  // Nature Publishing Group (NPG) Scientific Palette
  const C_RAW = "#D95F02";  // Rust / Orange
  const C_FILT = "#134074"; // Deep Navy
  const charcoal = "#1a1a1a";
  const headerColor = "#0090B0";
  const rowShade = "#D6F3F7";

  const journalAxis = {
    showline: true, linewidth: 2, linecolor: charcoal, mirror: false,
    ticks: 'outside', tickwidth: 2, ticklen: 6, tickcolor: charcoal,
    tickfont: { family: 'Arial, Helvetica, sans-serif', size: 14, color: charcoal, weight: 'bold' },
    showgrid: false, zeroline: false,
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      {/* ---------------- ROW 1: SUMMARY TABLE & LENGTH DIST ---------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', marginBottom: '60px' }}>
        
        {/* Plot 1: Summary Statistics Table[cite: 27] */}
        <div style={{ flex: '1 1 45%', minWidth: '450px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '15px', color: charcoal, fontSize: '20px' }}><b>Summary statistics: {data.sample}</b></h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: `1.5px solid ${charcoal}` }}>
            <thead>
              <tr>
                <th style={{ backgroundColor: headerColor, color: 'white', padding: '10px 15px', textAlign: 'left', borderBottom: `1.5px solid ${charcoal}`, fontSize: '15px' }}><b>Metric</b></th>
                <th style={{ backgroundColor: headerColor, color: 'white', padding: '10px 15px', textAlign: 'center', borderBottom: `1.5px solid ${charcoal}`, fontSize: '15px' }}><b>Raw</b></th>
                <th style={{ backgroundColor: headerColor, color: 'white', padding: '10px 15px', textAlign: 'center', borderBottom: `1.5px solid ${charcoal}`, fontSize: '15px' }}><b>Filtered</b></th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Reads", raw: data.summary.raw.n_reads.toLocaleString(), filt: data.summary.filtered.n_reads.toLocaleString() },
                { label: "Total bases", raw: data.summary.raw.total_bases.toLocaleString(), filt: data.summary.filtered.total_bases.toLocaleString() },
                { label: "N50 (bp)", raw: data.summary.raw.n50.toLocaleString(), filt: data.summary.filtered.n50.toLocaleString() },
                { label: "Mean length (bp)", raw: data.summary.raw.mean_len.toFixed(0), filt: data.summary.filtered.mean_len.toFixed(0) },
                { label: "Median length (bp)", raw: data.summary.raw.median_len.toFixed(0), filt: data.summary.filtered.median_len.toFixed(0) },
                { label: "Mean quality (Q)", raw: data.summary.raw.mean_qual.toFixed(1), filt: data.summary.filtered.mean_qual.toFixed(1) },
                { label: "Median quality (Q)", raw: data.summary.raw.median_qual.toFixed(1), filt: data.summary.filtered.median_qual.toFixed(1) },
                { label: "Mean GC (%)", raw: data.summary.raw.mean_gc.toFixed(1), filt: data.summary.filtered.mean_gc.toFixed(1) }
              ].map((row, idx) => (
                <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? rowShade : 'white' }}>
                  <td style={{ padding: '10px 15px', borderBottom: `1px solid ${charcoal}`, fontSize: '14px', fontWeight: 'bold', color: charcoal }}>{row.label}</td>
                  <td style={{ padding: '10px 15px', textAlign: 'center', borderBottom: `1px solid ${charcoal}`, fontSize: '14px', fontWeight: 'bold', color: C_RAW }}>{row.raw}</td>
                  <td style={{ padding: '10px 15px', textAlign: 'center', borderBottom: `1px solid ${charcoal}`, fontSize: '14px', fontWeight: 'bold', color: C_FILT }}>{row.filt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Plot 2: Read length distribution[cite: 24] */}
        <div style={{ flex: '1 1 45%', minWidth: '450px' }}>
          <Plot
            data={[
              { x: data.length_dist.x, y: data.length_dist.raw_y, type: 'bar', marker: { color: 'rgba(217, 95, 2, 0.5)', line: { color: C_RAW, width: 1 } }, name: '<b>Raw reads</b>' },
              { x: data.length_dist.x, y: data.length_dist.filt_y, type: 'bar', marker: { color: 'rgba(19, 64, 116, 0.5)', line: { color: C_FILT, width: 1 } }, name: '<b>Filtered reads</b>' }
            ]}
            layout={{
              title: { text: `<b>Read length distribution: ${data.sample}</b>`, font: { size: 20, color: charcoal, family: 'Arial' }, x: 0.05 },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 80, r: 30, t: 60, b: 70 },
              barmode: 'overlay',
              xaxis: { ...journalAxis, type: 'log', title: '<b>Read length (bp)</b>', titlefont: { size: 18 } },
              yaxis: { ...journalAxis, title: '<b>Read count</b>', titlefont: { size: 18 } },
              legend: { x: 0.02, y: 0.98, font: { size: 14, color: charcoal } },
              shapes: [
                { type: 'line', x0: data.summary.raw.n50, x1: data.summary.raw.n50, y0: 0, y1: 1, yref: 'paper', line: { color: C_RAW, width: 2, dash: 'dash' } },
                { type: 'line', x0: data.summary.filtered.n50, x1: data.summary.filtered.n50, y0: 0, y1: 1, yref: 'paper', line: { color: C_FILT, width: 2, dash: 'dash' } }
              ]
            }}
            useResizeHandler={true} style={{ width: '100%', height: '450px' }}
          />
        </div>
      </div>

      {/* ---------------- ROW 2: QUALITY VIOLINS & GC DENSITY ---------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', marginBottom: '60px' }}>
        
        {/* Plot 3: Quality Summary (Violin + Box)[cite: 25] */}
        <div style={{ flex: '1 1 45%', minWidth: '450px' }}>
          <Plot
            data={[
              { y: data.quality_violin.raw_quals, type: 'violin', name: 'Raw reads', box: { visible: true, width: 0.15 }, meanline: { visible: true }, line: { color: charcoal, width: 1.5 }, fillcolor: 'rgba(217, 95, 2, 0.55)', marker: { color: charcoal } },
              { y: data.quality_violin.filt_quals, type: 'violin', name: 'Filtered reads', box: { visible: true, width: 0.15 }, meanline: { visible: true }, line: { color: charcoal, width: 1.5 }, fillcolor: 'rgba(19, 64, 116, 0.55)', marker: { color: charcoal } }
            ]}
            layout={{
              title: { text: `<b>WGS long read quality summary: ${data.sample}</b>`, font: { size: 20, color: charcoal, family: 'Arial' }, x: 0.05 },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 80, r: 40, t: 70, b: 60 },
              xaxis: { ...journalAxis, tickfont: { size: 15, color: charcoal, weight: 'bold' } },
              yaxis: { ...journalAxis, title: '<b>Mean Phred quality score</b>', titlefont: { size: 18 }, range: [0, 60] },
              showlegend: false,
              shapes: [
                { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 30, y1: 30, line: { color: '#666666', width: 1.5, dash: 'dash' }, layer: 'below' },
                { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 20, y1: 20, line: { color: '#999999', width: 1.5, dash: 'dash' }, layer: 'below' }
              ],
              annotations: [
                { x: 1, y: 31, xref: 'paper', text: '<b>Q30 (99.9%)</b>', showarrow: false, font: { size: 12, color: '#333333' }, xanchor: 'right', yanchor: 'bottom' },
                { x: 1, y: 21, xref: 'paper', text: '<b>Q20 (99.0%)</b>', showarrow: false, font: { size: 12, color: '#666666' }, xanchor: 'right', yanchor: 'bottom' },
                { x: 0, y: 55, xref: 'x', yref: 'y', text: `<b>Mean Q: ${data.summary.raw.mean_qual.toFixed(1)}<br>≥Q30: ${data.quality_violin.raw_q30_pct}%</b>`, showarrow: false, font: { size: 13, color: '#A63603' }, bgcolor: '#FFF0F0', bordercolor: '#A63603', borderwidth: 1.5, borderpad: 6 },
                { x: 1, y: 55, xref: 'x', yref: 'y', text: `<b>Mean Q: ${data.summary.filtered.mean_qual.toFixed(1)}<br>≥Q30: ${data.quality_violin.filt_q30_pct}%</b>`, showarrow: false, font: { size: 13, color: '#0B2545' }, bgcolor: '#EEF4F8', bordercolor: '#0B2545', borderwidth: 1.5, borderpad: 6 }
              ]
            }}
            useResizeHandler={true} style={{ width: '100%', height: '450px' }}
          />
        </div>

        {/* Plot 4: GC Content Density[cite: 26] */}
        {data.gc_density && (
          <div style={{ flex: '1 1 45%', minWidth: '450px' }}>
            <Plot
              data={[
                { x: data.gc_density.x, y: data.gc_density.raw_y, type: 'scatter', mode: 'lines', fill: 'tozeroy', line: { color: C_RAW, width: 2.8, dash: 'dash' }, fillcolor: 'rgba(217, 95, 2, 0.25)', name: '<b>Raw reads</b>' },
                { x: data.gc_density.x, y: data.gc_density.filt_y, type: 'scatter', mode: 'lines', fill: 'tozeroy', line: { color: C_FILT, width: 2.2 }, fillcolor: 'rgba(19, 64, 116, 0.25)', name: '<b>Filtered reads</b>' }
              ]}
              layout={{
                title: { text: `<b>Per-read GC content distribution: ${data.sample}</b>`, font: { size: 20, color: charcoal, family: 'Arial' }, x: 0.05 },
                plot_bgcolor: 'white', paper_bgcolor: 'white',
                margin: { l: 80, r: 30, t: 70, b: 70 },
                xaxis: { ...journalAxis, title: '<b>GC content (%)</b>', titlefont: { size: 18 }, range: [0, 100] },
                yaxis: { ...journalAxis, title: '<b>Density</b>', titlefont: { size: 18 } },
                legend: { x: 0.7, y: 0.95, font: { size: 14, color: charcoal } }
              }}
              useResizeHandler={true} style={{ width: '100%', height: '450px' }}
            />
          </div>
        )}
      </div>

      {/* ---------------- ROW 3: SVG HEXBIN DENSITY PLOT ---------------- */}
      <div style={{ width: '100%', borderTop: `2px solid ${charcoal}`, paddingTop: '40px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px', color: charcoal, fontSize: '20px', fontFamily: 'Arial' }}>
          <b>Read length vs quality density: {data.sample}</b>
        </h2>
        
        {/* Direct SVG Import for rendering heavy Hexbin natively[cite: 28] */}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <img 
            src="/LengthQuality_Density_WGS_LR.svg" 
            alt="Hexbin Length Quality Density" 
            style={{ maxWidth: '100%', height: 'auto', maxHeight: '550px' }} 
          />
        </div>
      </div>

    </div>
  );
};

export default WGSLRPreprocessingDashboard;