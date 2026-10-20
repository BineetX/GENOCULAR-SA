import React, { useState, useEffect } from 'react';
import Plot from "../UpdatedPlot.jsx";



const ProkkaDashboard = ({ src }) => {
  const [plotData, setPlotData] = useState(null);

  useEffect(() => {
    fetch(src)
      .then((response) => response.json())
      .then((data) => setPlotData(data))
      .catch((error) => console.error("Error loading Prokka data:", error));
  }, [src]);

  if (!plotData) {
    return <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif' }}>Loading Prokka Data...</div>;
  }

  // Deep Matte Scientific Color Palette (Science / Nature Style)
  const matte = {
    slateBlue: '#3B5262',    // Deep, muted slate for primary bars
    matteRed: '#A34641',     // Brick/matte red for length distributions
    deepTeal: '#2A6F75',     // Sophisticated teal for feature composition
    mustard: '#C18C3F',      // Matte ochre/mustard for top products
    plum: '#65506E',         // Muted plum/purple for protein lengths
    mossGreen: '#5A7D59',    // Earthy green for 'Known' pie slice
    dustyGrey: '#8A949A',    // Matte grey for 'Unknown' pie slice
    paleGold: '#DAB868',     // Soft gold for 'Hypothetical' pie slice
    charcoal: '#1f2022',     // Soft matte black for text and axes (reduces harsh contrast)
    faintGrid: 'rgba(0,0,0,0.04)'
  };

  // Ultra-crisp, Matte Journal Axis Layout
  const journalAxis = {
    showline: true,
    linewidth: 2,
    linecolor: matte.charcoal,
    mirror: false,
    ticks: 'outside',
    tickwidth: 2,
    ticklen: 6,
    tickcolor: matte.charcoal,
    tickfont: { family: 'Arial, Helvetica, sans-serif', size: 14, color: matte.charcoal, weight: 'bold' },
    showgrid: true,
    gridcolor: matte.faintGrid,
    gridwidth: 1,
    zeroline: false,
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      {/* Plot 1: Functional Summary (Bar with Inset Pie) */}
      <div style={{ width: '100%', marginBottom: '60px' }}>
        <Plot
          data={[
            {
              x: plotData.plot1_functional.bar_x,
              y: plotData.plot1_functional.bar_y,
              type: 'bar',
              marker: { color: matte.slateBlue, line: { color: matte.charcoal, width: 1.5 } },
              name: 'Annotated CDS (%)',
              text: plotData.plot1_functional.bar_y.map(v => `${v}%`),
              textposition: 'outside',
              textfont: { family: 'Arial', size: 13, color: matte.charcoal, weight: 'bold' }
            },
            {
              values: plotData.plot1_functional.pie_values,
              labels: plotData.plot1_functional.pie_labels,
              type: 'pie',
              domain: { x: [0.03, 0.38], y: [0.4, 0.98] },
              marker: { 
                colors: [matte.mossGreen, matte.dustyGrey, matte.paleGold], 
                line: { color: '#ffffff', width: 2.5 } 
              },
              textinfo: 'label+percent',
              textfont: { family: 'Arial', size: 14, color: matte.charcoal, weight: 'bold' },
              showlegend: false,
              hoverinfo: 'label+value+percent'
            }
          ]}
          layout={{
            title: { text: '<b>Functional overview of Prokka-annotated coding sequences</b>', font: { size: 22, color: matte.charcoal, family: 'Arial' }, x: 0.02 },
            plot_bgcolor: 'white',
            paper_bgcolor: 'white',
            margin: { l: 70, r: 30, t: 80, b: 180 },
            xaxis: { ...journalAxis, tickangle: 55, showgrid: false },
            yaxis: { ...journalAxis, title: '<b>Annotated CDS (%)</b>', titlefont: { size: 18 }, range: [0, Math.max(...plotData.plot1_functional.bar_y) * 1.15] },
          }}
          useResizeHandler={true} style={{ width: '100%', height: '650px' }}
        />
      </div>

      {/* Row 2: Feature Composition & Top Annotations */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', marginBottom: '60px' }}>
        
        {/* Plot 2: Feature Composition */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[{
              x: plotData.plot2_features.x,
              y: plotData.plot2_features.y,
              type: 'bar',
              marker: { color: matte.deepTeal, line: { color: matte.charcoal, width: 1.5 } },
              text: plotData.plot2_features.text,
              textposition: 'outside',
              textfont: { family: 'Arial', size: 13, color: matte.charcoal, weight: 'bold' }
            }]}
            layout={{
              title: { text: '<b>Genome feature composition</b>', font: { size: 20, color: matte.charcoal, family: 'Arial' }, x: 0.02 },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 80, r: 30, t: 70, b: 120 },
              xaxis: { ...journalAxis, title: '<b>Feature type</b>', titlefont: { size: 18 }, tickangle: 35, showgrid: false },
              yaxis: { ...journalAxis, title: '<b>Feature count</b>', titlefont: { size: 18 }, range: [0, Math.max(...plotData.plot2_features.y) * 1.2] },
            }}
            useResizeHandler={true} style={{ width: '100%', height: '500px' }}
          />
        </div>

        {/* Plot 5: Top Products */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[{
              x: plotData.plot5_top_products.x,
              y: plotData.plot5_top_products.y,
              type: 'bar',
              orientation: 'h',
              marker: { color: matte.mustard, line: { color: matte.charcoal, width: 1.5 } },
              text: plotData.plot5_top_products.x.map(String),
              textposition: 'outside',
              textfont: { family: 'Arial', size: 13, color: matte.charcoal, weight: 'bold' },
              cliponaxis: false
            }]}
            layout={{
              title: { text: '<b>Top annotated product names</b>', font: { size: 20, color: matte.charcoal, family: 'Arial' }, x: 0.02 },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 350, r: 50, t: 70, b: 70 },
              xaxis: { ...journalAxis, title: '<b>Count</b>', titlefont: { size: 18 } },
              yaxis: { 
                ...journalAxis, 
                autorange: 'reversed', 
                showgrid: false,
                automargin: true, 
                tickfont: { family: 'Arial, Helvetica, sans-serif', size: 11, color: matte.charcoal, weight: 'bold' } 
              },
            }}
            useResizeHandler={true} style={{ width: '100%', height: '500px' }}
          />
        </div>
      </div>

      {/* Row 3: Length Distributions (Conditionally Rendered) */}
      {(plotData.plot3_cds_len || plotData.plot4_prot_len) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', marginBottom: '60px' }}>
          
          {/* Plot 3: CDS Length */}
          {plotData.plot3_cds_len && (
            <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
              <Plot
                data={[{
                  x: plotData.plot3_cds_len.x,
                  y: plotData.plot3_cds_len.y,
                  type: 'bar',
                  marker: { color: matte.matteRed, line: { color: matte.charcoal, width: 0.8 } },
                }]}
                layout={{
                  title: { text: '<b>CDS length distribution</b>', font: { size: 20, color: matte.charcoal, family: 'Arial' }, x: 0.02 },
                  plot_bgcolor: 'white', paper_bgcolor: 'white',
                  margin: { l: 80, r: 30, t: 70, b: 70 },
                  xaxis: { ...journalAxis, title: '<b>CDS length (bp)</b>', titlefont: { size: 18 }, showgrid: false },
                  yaxis: { ...journalAxis, title: '<b>Number of CDS</b>', titlefont: { size: 18 } },
                  shapes: [
                    { type: 'line', x0: plotData.plot3_cds_len.mean, x1: plotData.plot3_cds_len.mean, y0: 0, y1: 1, yref: 'paper', line: { color: matte.slateBlue, dash: 'dash', width: 3 } },
                    { type: 'line', x0: plotData.plot3_cds_len.median, x1: plotData.plot3_cds_len.median, y0: 0, y1: 1, yref: 'paper', line: { color: matte.charcoal, dash: 'dot', width: 3 } }
                  ],
                  annotations: [
                    { x: plotData.plot3_cds_len.mean, y: 1.07, yref: 'paper', text: `<b>Mean: ${plotData.plot3_cds_len.mean.toFixed(1)}</b>`, showarrow: false, font: { color: matte.slateBlue, family: 'Arial', size: 14, weight: 'bold' } },
                    { x: plotData.plot3_cds_len.median, y: 0.96, yref: 'paper', text: `<b>Median: ${plotData.plot3_cds_len.median.toFixed(1)}</b>`, showarrow: false, font: { color: matte.charcoal, family: 'Arial', size: 14, weight: 'bold' } }
                  ]
                }}
                useResizeHandler={true} style={{ width: '100%', height: '450px' }}
              />
            </div>
          )}

          {/* Plot 4: Protein Length */}
          {plotData.plot4_prot_len && (
            <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
              <Plot
                data={[{
                  x: plotData.plot4_prot_len.x,
                  y: plotData.plot4_prot_len.y,
                  type: 'bar',
                  marker: { color: matte.plum, line: { color: matte.charcoal, width: 0.8 } },
                }]}
                layout={{
                  title: { text: '<b>Protein length distribution</b>', font: { size: 20, color: matte.charcoal, family: 'Arial' }, x: 0.02 },
                  plot_bgcolor: 'white', paper_bgcolor: 'white',
                  margin: { l: 80, r: 30, t: 70, b: 70 },
                  xaxis: { ...journalAxis, title: '<b>Protein length (aa)</b>', titlefont: { size: 18 }, showgrid: false },
                  yaxis: { ...journalAxis, title: '<b>Number of proteins</b>', titlefont: { size: 18 } },
                  shapes: [
                    { type: 'line', x0: plotData.plot4_prot_len.mean, x1: plotData.plot4_prot_len.mean, y0: 0, y1: 1, yref: 'paper', line: { color: matte.slateBlue, dash: 'dash', width: 3 } },
                    { type: 'line', x0: plotData.plot4_prot_len.median, x1: plotData.plot4_prot_len.median, y0: 0, y1: 1, yref: 'paper', line: { color: matte.charcoal, dash: 'dot', width: 3 } }
                  ],
                  annotations: [
                    { x: plotData.plot4_prot_len.mean, y: 1.07, yref: 'paper', text: `<b>Mean: ${plotData.plot4_prot_len.mean.toFixed(1)}</b>`, showarrow: false, font: { color: matte.slateBlue, family: 'Arial', size: 14, weight: 'bold' } },
                    { x: plotData.plot4_prot_len.median, y: 0.96, yref: 'paper', text: `<b>Median: ${plotData.plot4_prot_len.median.toFixed(1)}</b>`, showarrow: false, font: { color: matte.charcoal, family: 'Arial', size: 14, weight: 'bold' } }
                  ]
                }}
                useResizeHandler={true} style={{ width: '100%', height: '450px' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProkkaDashboard;