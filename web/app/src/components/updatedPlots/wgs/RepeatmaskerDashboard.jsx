import React, { useState, useEffect } from 'react';
import Plot from "../UpdatedPlot.jsx";



const RepeatMaskerDashboard = ({ src }) => {
  const [plotData, setPlotData] = useState(null);

  useEffect(() => {
    fetch(src)
      .then((response) => response.json())
      .then((data) => setPlotData(data))
      .catch((error) => console.error("Error loading RepeatMasker data:", error));
  }, [src]);

  if (!plotData) {
    return <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif' }}>Loading RepeatMasker Data...</div>;
  }

  // Classic Nature Publishing Group (NPG) Scientific Color Palette
  const naturePalette = {
    "DNA": "#3C5488",            // Deep primary blue
    "LINE": "#4DBBD5",           // Crisp light blue
    "LTR": "#00A087",            // Vibrant teal
    "SINE": "#E64B35",           // High-contrast red
    "Satellite": "#F39B7F",      // Muted orange
    "Simple repeats": "#8491B4", // Soft purple
    "Low complexity": "#91D1C2", // Mint green
    "Other": "#7E6148"           // Brown/Grey
  };

  // Ultra-crisp, Nature Journal Axis Layout
  const journalAxis = {
    showline: true,
    linewidth: 2,
    linecolor: '#1a1a1a', // Crisp charcoal
    mirror: false,
    ticks: 'outside',
    tickwidth: 2,
    ticklen: 6,
    tickcolor: '#1a1a1a',
    tickfont: { family: 'Arial, Helvetica, sans-serif', size: 14, color: '#1a1a1a', weight: 'bold' },
    showgrid: true,
    gridcolor: 'rgba(0,0,0,0.05)', // Subtle background grid
    gridwidth: 1,
    zeroline: false,
  };

  // Construct Stacked Bar Traces from the JSON 'groups' object
  const traces = Object.keys(plotData.landscape.groups).map((groupName) => {
    return {
      x: plotData.landscape.x,
      y: plotData.landscape.groups[groupName],
      name: `<b>${groupName}</b>`,
      type: 'bar',
      marker: { 
        color: naturePalette[groupName] || '#1a1a1a',
        line: { color: '#1a1a1a', width: 0.5 } // Crisp borders on the stacked bars
      }
    };
  });

  // Construct Stats Box Text dynamically from the JSON 'stats' object
  const stats = plotData.stats;
  const statsHtml = `
    <b>Genome size:</b> ${(stats.genome_size / 1e6).toFixed(2)} Mb<br>
    <b>GC content:</b> ${stats.gc_content.toFixed(2)}%<br>
    <b>Masked DNA:</b> ${stats.masked_bp.toLocaleString()} bp<br>
    <b>Masked fraction:</b> ${stats.masked_pct.toFixed(2)}%<br>
    <b>Repeat hits:</b> ${stats.repeat_hits.toLocaleString()}
  `;

  return (
    <div style={{ padding: '30px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1200px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      <div style={{ width: '100%', marginBottom: '60px' }}>
        <Plot
          data={traces}
          layout={{
            title: { 
              text: '<b>Repeat Composition Landscape of the Representative Isolate Genome</b>', 
              font: { size: 22, color: '#1a1a1a', family: 'Arial' },
              y: 0.95
            },
            plot_bgcolor: 'white',
            paper_bgcolor: 'white',
            margin: { l: 80, r: 180, t: 80, b: 80 }, // Extra right margin to accommodate the legend
            barmode: 'stack', // Stacks the bar charts perfectly
            xaxis: { 
              ...journalAxis, 
              title: '<b>Sequence Divergence (%)</b>', 
              titlefont: { size: 18 }, 
              showgrid: false 
            },
            yaxis: { 
              ...journalAxis, 
              title: '<b>Number of Repeat Hits</b>', 
              titlefont: { size: 18 } 
            },
            // Floating Statistics Box Annotation (Top Right)
            annotations: [
              {
                x: 0.97,
                y: 0.97,
                xref: 'paper',
                yref: 'paper',
                text: statsHtml,
                showarrow: false,
                align: 'right',
                xanchor: 'right',
                yanchor: 'top',
                font: { family: 'Arial, Helvetica, sans-serif', size: 14, color: '#1a1a1a' },
                bgcolor: 'rgba(255, 255, 255, 0.95)',
                bordercolor: '#1a1a1a',
                borderwidth: 1.5,
                borderpad: 10
              }
            ],
            showlegend: true,
            legend: {
              title: { text: '<b>Repeat class</b>', font: { size: 15, color: '#1a1a1a' } },
              font: { family: 'Arial, sans-serif', size: 13, color: '#1a1a1a' },
              bgcolor: 'rgba(255,255,255,0.95)',
              bordercolor: '#1a1a1a',
              borderwidth: 1.5,
              y: 0.97,
              yanchor: 'top',
              x: 1.02,
              xanchor: 'left' // Positions legend completely outside the plot area
            }
          }}
          useResizeHandler={true} 
          style={{ width: '100%', height: '650px' }}
        />
      </div>
    </div>
  );
};

export default RepeatMaskerDashboard;