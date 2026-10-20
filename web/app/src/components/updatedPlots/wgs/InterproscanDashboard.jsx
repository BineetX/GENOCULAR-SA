import React, { useState, useEffect } from 'react';
import Plot from "../UpdatedPlot.jsx";



const InterproscanDashboard = ({ src }) => {
  const [plotData, setPlotData] = useState(null);

  useEffect(() => {
    fetch(src)
      .then((response) => response.json())
      .then((data) => setPlotData(data))
      .catch((error) => console.error("Error loading InterProScan data:", error));
  }, [src]);

  if (!plotData) {
    return <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif' }}>Loading InterProScan Data...</div>;
  }

  // Classic Nature Publishing Group (NPG) Scientific Color Palette
  const nature = {
    red: '#E64B35',          // High-contrast red (Medians, specific domains)
    lightBlue: '#4DBBD5',    // Crisp light blue
    teal: '#00A087',         // Vibrant teal
    darkBlue: '#3C5488',     // Deep primary blue
    orange: '#F39B7F',       // Muted orange
    purple: '#8491B4',       // Soft purple
    mint: '#91D1C2',         // Mint green
    charcoal: '#1a1a1a',     // Crisp, near-black for text and axes
    faintGrid: 'rgba(0,0,0,0.05)', // Barely-there grid
    greyBackbone: '#d3d3d3'  // For protein sequence architecture lines
  };

  // Generate a reliable color mapping for the domain architecture legends
  const domainColors = [nature.teal, nature.red, nature.darkBlue, nature.orange, nature.lightBlue, nature.purple, nature.mint, '#DC0000', '#7E6148', '#B09C85'];
  const getDomainColor = (index) => domainColors[index % domainColors.length];

  // Ultra-crisp, Nature Journal Axis Layout
  const journalAxis = {
    showline: true,
    linewidth: 2,
    linecolor: nature.charcoal,
    mirror: false,
    ticks: 'outside',
    tickwidth: 2,
    ticklen: 6,
    tickcolor: nature.charcoal,
    tickfont: { family: 'Arial, Helvetica, sans-serif', size: 14, color: nature.charcoal, weight: 'bold' },
    showgrid: true,
    gridcolor: nature.faintGrid,
    gridwidth: 1,
    zeroline: false,
  };

  // --- Construct Plotly Shapes for Plot 2 (Domain Architecture) ---
  const archShapes = [];
  const archLegendTraces = [];
  
  if (plotData.plot2_arch) {
    // 1. Draw Protein Backbones (Grey lines)
    plotData.plot2_arch.lengths.forEach((len, i) => {
      archShapes.push({
        type: 'line', x0: 0, x1: len, y0: i, y1: i,
        line: { color: nature.greyBackbone, width: 4 },
        layer: 'below'
      });
    });

    // 2. Draw Domain Rectangles
    plotData.plot2_arch.domains.forEach((dom) => {
      const colorIdx = plotData.plot2_arch.unique_domains.indexOf(dom.desc);
      archShapes.push({
        type: 'rect',
        x0: dom.start, x1: dom.end,
        y0: dom.prot_idx - 0.25, y1: dom.prot_idx + 0.25,
        fillcolor: getDomainColor(colorIdx),
        line: { color: 'white', width: 1 },
        layer: 'above'
      });
    });

    // 3. Create dummy traces to render the interactive Legend for Domains
    plotData.plot2_arch.unique_domains.forEach((desc, idx) => {
      // Truncate overly long domain names for the legend
      const shortDesc = desc.length > 35 ? desc.substring(0, 32) + '...' : desc;
      archLegendTraces.push({
        x: [null], y: [null],
        type: 'bar',
        name: `<b>${shortDesc}</b>`,
        marker: { color: getDomainColor(idx) }
      });
    });
  }

  return (
    <div style={{ padding: '30px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      {/* Top Row: DB Dist & Protein Length */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', marginBottom: '60px' }}>
        
        {/* Plot 1a: Database distribution */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[{
              x: plotData.plot1a_db.x,
              y: plotData.plot1a_db.y,
              type: 'bar',
              marker: { 
                color: plotData.plot1a_db.x.map((_, i) => domainColors[i % domainColors.length]), 
                line: { color: nature.charcoal, width: 1.5 } 
              },
              text: plotData.plot1a_db.y.map(String),
              textposition: 'outside',
              textfont: { family: 'Arial', size: 13, color: nature.charcoal, weight: 'bold' }
            }]}
            layout={{
              title: { text: '<b>Database distribution</b>', font: { size: 20, color: nature.charcoal, family: 'Arial' } },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 80, r: 30, t: 60, b: 120 },
              xaxis: { ...journalAxis, tickangle: 45, showgrid: false },
              yaxis: { ...journalAxis, title: '<b>Number of hits</b>', titlefont: { size: 18 }, range: [0, Math.max(...plotData.plot1a_db.y) * 1.15] },
            }}
            useResizeHandler={true} style={{ width: '100%', height: '450px' }}
          />
        </div>

        {/* Plot 1b: Protein length distribution */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[{
              x: plotData.plot1b_len.x,
              y: plotData.plot1b_len.y,
              type: 'bar',
              marker: { color: nature.lightBlue, line: { color: nature.charcoal, width: 0.8 } },
            }]}
            layout={{
              title: { text: '<b>Protein length distribution</b>', font: { size: 20, color: nature.charcoal, family: 'Arial' } },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 80, r: 30, t: 60, b: 70 },
              xaxis: { ...journalAxis, title: '<b>Protein length (aa)</b>', titlefont: { size: 18 }, showgrid: false },
              yaxis: { ...journalAxis, title: '<b>Count</b>', titlefont: { size: 18 } },
              shapes: [{
                type: 'line', x0: plotData.plot1b_len.median, x1: plotData.plot1b_len.median, y0: 0, y1: 1, yref: 'paper', 
                line: { color: nature.red, dash: 'dash', width: 2.5 }
              }],
              annotations: [{
                x: plotData.plot1b_len.median, y: 1.05, yref: 'paper', text: `<b>Median = ${plotData.plot1b_len.median} aa</b>`, 
                showarrow: false, font: { color: nature.red, family: 'Arial', size: 14 }
              }]
            }}
            useResizeHandler={true} style={{ width: '100%', height: '450px' }}
          />
        </div>
      </div>

      {/* Middle Row: Top Entries & E-value */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', marginBottom: '60px' }}>
        
        {/* Plot 1c: Top 20 IPR */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[{
              x: plotData.plot1c_ipr.x,
              y: plotData.plot1c_ipr.y,
              type: 'bar',
              orientation: 'h',
              marker: { color: nature.darkBlue, line: { color: nature.charcoal, width: 1.5 } },
            }]}
            layout={{
              title: { text: '<b>Top 20 InterPro entries</b>', font: { size: 20, color: nature.charcoal, family: 'Arial' } },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 280, r: 40, t: 60, b: 70 },
              xaxis: { ...journalAxis, title: '<b>Number of proteins</b>', titlefont: { size: 18 } },
              yaxis: { 
                ...journalAxis, 
                autorange: 'reversed', 
                showgrid: false,
                automargin: true,
                tickfont: { family: 'Arial, Helvetica, sans-serif', size: 11, color: nature.charcoal, weight: 'bold' } 
              },
            }}
            useResizeHandler={true} style={{ width: '100%', height: '500px' }}
          />
        </div>

        {/* Plot 1d: E-value distribution */}
        {plotData.plot1d_eval && (
          <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
            <Plot
              data={[{
                x: plotData.plot1d_eval.x,
                y: plotData.plot1d_eval.y,
                type: 'bar',
                marker: { color: nature.teal, line: { color: nature.charcoal, width: 0.8 } },
              }]}
              layout={{
                title: { text: '<b>E-value distribution</b>', font: { size: 20, color: nature.charcoal, family: 'Arial' } },
                plot_bgcolor: 'white', paper_bgcolor: 'white',
                margin: { l: 80, r: 30, t: 60, b: 70 },
                xaxis: { ...journalAxis, title: '<b>log₁₀(E-value)</b>', titlefont: { size: 18 }, showgrid: false },
                yaxis: { ...journalAxis, title: '<b>Count</b>', titlefont: { size: 18 } },
              }}
              useResizeHandler={true} style={{ width: '100%', height: '500px' }}
            />
          </div>
        )}
      </div>

      {/* Bottom Row: Domain Architecture Timeline */}
      {plotData.plot2_arch && (
        <div style={{ width: '100%', marginTop: '30px', borderTop: `2px solid ${nature.faintGrid}`, paddingTop: '50px' }}>
          <Plot
            data={archLegendTraces} // Injects the dummy traces strictly for rendering the domain legend
            layout={{
              title: { text: '<b>Domain architecture — top 20 multi-domain proteins</b>', font: { size: 22, color: nature.charcoal, family: 'Arial' }, y: 0.98 },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 150, r: 250, t: 80, b: 80 }, // Wide right margin for the extensive legend
              xaxis: { 
                ...journalAxis, 
                title: '<b>Amino acid position</b>', 
                titlefont: { size: 18 },
                range: [0, Math.max(...plotData.plot2_arch.lengths) * 1.05]
              },
              yaxis: { 
                ...journalAxis, 
                tickmode: 'array',
                tickvals: plotData.plot2_arch.proteins.map((_, i) => i),
                ticktext: plotData.plot2_arch.proteins.map(p => `<b>${p}</b>`),
                showline: false,
                ticks: '',
                showgrid: true,
                gridcolor: nature.faintGrid
              },
              shapes: archShapes, // Renders the actual protein backbones and colored domain boxes
              showlegend: true,
              legend: {
                title: { text: '<b>Domain Annotations</b>', font: { size: 14, color: nature.charcoal } },
                font: { family: 'Arial, sans-serif', size: 12, color: nature.charcoal },
                bgcolor: 'rgba(255,255,255,0.95)',
                bordercolor: nature.charcoal,
                borderwidth: 1,
                y: 1,
                yanchor: 'top',
                x: 1.02,
                xanchor: 'left'
              }
            }}
            useResizeHandler={true} style={{ width: '100%', height: `${Math.max(500, plotData.plot2_arch.proteins.length * 40)}px` }}
          />
        </div>
      )}
    </div>
  );
};

export default InterproscanDashboard;
