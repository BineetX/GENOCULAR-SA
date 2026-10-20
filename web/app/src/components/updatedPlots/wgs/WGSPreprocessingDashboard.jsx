import React, { useState, useEffect } from 'react';
import Plot from "../UpdatedPlot.jsx";



const WGSPreprocessingDashboard = ({ src }) => {
  const [plotData, setPlotData] = useState(null);

  useEffect(() => {
    fetch(src)
      .then((response) => response.json())
      .then((data) => setPlotData(data))
      .catch((error) => console.error("Error loading Preprocessing data:", error));
  }, [src]);

  if (!plotData) {
    return <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif' }}>Loading QC Data...</div>;
  }

  // Preprocessing Scientific Palette
  const C_RAW = "#D95F02";
  const C_FILT = "#134074";
  const C_ZONE_GOOD = "#EAF7EA";
  const C_ZONE_OK = "#FFFBEA";
  const C_ZONE_BAD = "#FFF0F0";
  const charcoal = "#1a1a1a";

  const journalAxis = {
    showline: true, linewidth: 2, linecolor: charcoal, mirror: false,
    ticks: 'outside', tickwidth: 2, ticklen: 6, tickcolor: charcoal,
    tickfont: { family: 'Arial, Helvetica, sans-serif', size: 14, color: charcoal, weight: 'bold' },
    showgrid: false, zeroline: false,
  };

  // Pre-calculate max counts for Y-axis ranges
  const maxGC = Math.max(...plotData.gc_content.raw_y, ...plotData.gc_content.clean_y);
  const maxReadQ = Math.max(...plotData.read_quality.raw_y, ...plotData.read_quality.clean_y);

  return (
    <div style={{ padding: '30px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      {/* ---------------- PLOT 1: PER-BASE QUALITY[cite: 19] ---------------- */}
      <div style={{ width: '100%', marginBottom: '60px' }}>
        <Plot
          data={[
            // Raw IQR (Lower then Upper filled to next y)
            { x: plotData.per_base.x, y: plotData.per_base.raw_lower, type: 'scatter', mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'none' },
            { x: plotData.per_base.x, y: plotData.per_base.raw_upper, type: 'scatter', mode: 'lines', fill: 'tonexty', fillcolor: 'rgba(217, 95, 2, 0.25)', line: { width: 0 }, name: 'Raw reads (IQR)', hoverinfo: 'none' },
            
            // Clean IQR
            { x: plotData.per_base.x_clean, y: plotData.per_base.clean_lower, type: 'scatter', mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'none' },
            { x: plotData.per_base.x_clean, y: plotData.per_base.clean_upper, type: 'scatter', mode: 'lines', fill: 'tonexty', fillcolor: 'rgba(19, 64, 116, 0.28)', line: { width: 0 }, name: 'Trimmed reads (IQR)', hoverinfo: 'none' },
            
            // Medians
            { x: plotData.per_base.x, y: plotData.per_base.raw_median, type: 'scatter', mode: 'lines', line: { color: C_RAW, width: 3 }, name: 'Raw — median' },
            { x: plotData.per_base.x_clean, y: plotData.per_base.clean_median, type: 'scatter', mode: 'lines', line: { color: C_FILT, width: 3 }, name: 'Trimmed — median' }
          ]}
          layout={{
            title: { text: '<b>Per-base sequence quality</b>', font: { size: 22, color: charcoal, family: 'Arial' }, x: 0.05 },
            plot_bgcolor: 'white', paper_bgcolor: 'white',
            margin: { l: 80, r: 120, t: 80, b: 70 },
            xaxis: { 
              ...journalAxis, title: '<b>Base position (bp)</b>', titlefont: { size: 18 },
              tickmode: 'array', tickvals: plotData.per_base.xtick_pos, ticktext: plotData.per_base.xtick_labels
            },
            yaxis: { ...journalAxis, title: '<b>Phred quality score</b>', titlefont: { size: 18 }, range: [0, 42], tick0: 0, dtick: 5 },
            legend: { x: 0.02, y: 0.05, font: { size: 14, color: charcoal } },
            shapes: [
              // Semantic Quality Zones[cite: 19]
              { type: 'rect', x0: 0, x1: 1, xref: 'paper', y0: 28, y1: 42, fillcolor: C_ZONE_GOOD, line: { width: 0 }, layer: 'below' },
              { type: 'rect', x0: 0, x1: 1, xref: 'paper', y0: 20, y1: 28, fillcolor: C_ZONE_OK, line: { width: 0 }, layer: 'below' },
              { type: 'rect', x0: 0, x1: 1, xref: 'paper', y0: 0, y1: 20, fillcolor: C_ZONE_BAD, line: { width: 0 }, layer: 'below' },
              { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 28, y1: 28, line: { color: '#aaaaaa', width: 1.5, dash: 'dash' } },
              { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 20, y1: 20, line: { color: '#aaaaaa', width: 1.5, dash: 'dash' } }
            ],
            annotations: [
              { x: 1.01, y: 35, xref: 'paper', yref: 'y', text: '<b>Good (Q≥28)</b>', showarrow: false, font: { size: 13, color: '#2E7D32' }, xanchor: 'left' },
              { x: 1.01, y: 24, xref: 'paper', yref: 'y', text: '<b>Acceptable</b>', showarrow: false, font: { size: 13, color: '#E65100' }, xanchor: 'left' },
              { x: 1.01, y: 10, xref: 'paper', yref: 'y', text: '<b>Poor (&lt;Q20)</b>', showarrow: false, font: { size: 13, color: '#C62828' }, xanchor: 'left' }
            ]
          }}
          useResizeHandler={true} style={{ width: '100%', height: '550px' }}
        />
      </div>

      {/* ---------------- BOTTOM ROW: GC DIST & READ DENSITY ---------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px' }}>
        
        {/* Plot 2: Per-sequence GC Content[cite: 20] */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[
              { x: plotData.gc_content.raw_x, y: plotData.gc_content.raw_y, type: 'scatter', mode: 'lines', fill: 'tozeroy', line: { color: C_RAW, width: 3 }, fillcolor: 'rgba(217, 95, 2, 0.25)', name: '<b>Raw reads</b>' },
              { x: plotData.gc_content.clean_x, y: plotData.gc_content.clean_y, type: 'scatter', mode: 'lines', fill: 'tozeroy', line: { color: C_FILT, width: 3 }, fillcolor: 'rgba(19, 64, 116, 0.28)', name: '<b>Trimmed reads</b>' }
            ]}
            layout={{
              title: { text: '<b>Per-sequence GC content</b>', font: { size: 20, color: charcoal, family: 'Arial' }, x: 0.05 },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 90, r: 30, t: 60, b: 70 },
              xaxis: { ...journalAxis, title: '<b>GC content (%)</b>', titlefont: { size: 18 }, range: [0, 100] },
              yaxis: { ...journalAxis, title: '<b>Fraction of reads</b>', titlefont: { size: 18 }, range: [0, maxGC * 1.15] },
              legend: { x: 0.05, y: 0.95, font: { size: 14, color: charcoal } }
            }}
            useResizeHandler={true} style={{ width: '100%', height: '450px' }}
          />
        </div>

        {/* Plot 3: Per-read Quality Score Density[cite: 21] */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[
              { x: plotData.read_quality.raw_x, y: plotData.read_quality.raw_y, type: 'scatter', mode: 'lines', fill: 'tozeroy', line: { color: C_RAW, width: 3 }, fillcolor: 'rgba(217, 95, 2, 0.3)', name: '<b>Raw reads</b>' },
              { x: plotData.read_quality.clean_x, y: plotData.read_quality.clean_y, type: 'scatter', mode: 'lines', fill: 'tozeroy', line: { color: C_FILT, width: 3 }, fillcolor: 'rgba(19, 64, 116, 0.35)', name: '<b>Trimmed reads</b>' }
            ]}
            layout={{
              title: { text: '<b>Per-read quality score density</b>', font: { size: 20, color: charcoal, family: 'Arial' }, x: 0.05 },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 90, r: 30, t: 60, b: 70 },
              xaxis: { ...journalAxis, title: '<b>Mean per-read Phred quality score</b>', titlefont: { size: 18 }, range: [0, 42] },
              yaxis: { ...journalAxis, title: '<b>Fraction of reads</b>', titlefont: { size: 18 }, range: [0, maxReadQ * 1.15] },
              legend: { x: 0.05, y: 0.95, font: { size: 14, color: charcoal } },
              shapes: [
                // Q28 Benchmark Line[cite: 21]
                { type: 'line', x0: 28, x1: 28, y0: 0, y1: 1, yref: 'paper', line: { color: '#2E7D32', width: 1.5, dash: 'dash' } }
              ],
              annotations: [
                { x: 28.5, y: maxReadQ * 0.8, text: '<b>Q28 Benchmark</b>', showarrow: false, font: { size: 14, color: '#2E7D32' }, xanchor: 'left' }
              ]
            }}
            useResizeHandler={true} style={{ width: '100%', height: '450px' }}
          />
        </div>
        
      </div>
    </div>
  );
};

export default WGSPreprocessingDashboard;