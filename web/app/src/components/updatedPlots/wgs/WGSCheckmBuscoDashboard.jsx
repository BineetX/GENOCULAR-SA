import React, { useState, useEffect } from 'react';
import Plot from "../UpdatedPlot.jsx";



const WGSSRCheckmBuscoDashboard = ({ src }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // This path perfectly matches the OUTPUT_JSON in your Python script
    fetch(src)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((json) => setData(json))
      .catch((error) => setError(error.message));
  }, [src]);

  if (error) {
    return (
      <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif', color: '#D8000C', backgroundColor: '#FFBABA', border: '1px solid #D8000C', borderRadius: '5px', margin: '20px' }}>
        Error loading Genome Quality Data: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif', color: '#333' }}>
        Loading Genome Quality Data...
      </div>
    );
  }

  // Exact Palette matching your standard
  const palette = {
    buscoSingle: '#5DADE2',      
    buscoDup: '#2E86C1',         
    buscoFrag: '#E8DA3C',        
    buscoMissing: '#F04B46',     
    checkmComp: '#A7D07C',       
    checkmContam: '#F0B35F',     
    checkmHetero: '#9FD3E6',     
    checkmRes: '#7A7A7A',        
    charcoal: '#1a1a1a',         
    faintGrid: 'rgba(0,0,0,0.05)'
  };

  const journalAxis = {
    showline: true, linewidth: 2, linecolor: palette.charcoal, mirror: false,
    ticks: 'outside', tickwidth: 2, ticklen: 6, tickcolor: palette.charcoal,
    tickfont: { family: 'Arial, Helvetica, sans-serif', size: 14, color: palette.charcoal, weight: 'bold' },
    showgrid: true, gridcolor: palette.faintGrid, gridwidth: 1, zeroline: false,
  };

  const isolate = [data.isolate_name];

  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      {/* ---------------- PLOT 1: BUSCO ASSESSMENT ---------------- */}
      <div style={{ width: '100%', marginBottom: '40px' }}>
        <Plot
          data={[
            { x: [data.busco.single], y: isolate, type: 'bar', orientation: 'h', name: '<b>Complete and single-copy</b>', marker: { color: palette.buscoSingle, line: { color: 'white', width: 2 } } },
            { x: [data.busco.duplicated], y: isolate, type: 'bar', orientation: 'h', name: '<b>Complete and duplicated</b>', marker: { color: palette.buscoDup, line: { color: 'white', width: 2 } } },
            { x: [data.busco.fragmented], y: isolate, type: 'bar', orientation: 'h', name: '<b>Fragmented</b>', marker: { color: palette.buscoFrag, line: { color: 'white', width: 2 } } },
            { x: [data.busco.missing], y: isolate, type: 'bar', orientation: 'h', name: '<b>Missing</b>', marker: { color: palette.buscoMissing, line: { color: 'white', width: 2 } } }
          ]}
          layout={{
            title: { text: '<b>BUSCO Assessment</b>', font: { size: 22, color: palette.charcoal, family: 'Arial' }, pad: { b: 20 } },
            plot_bgcolor: 'white', paper_bgcolor: 'white',
            margin: { l: 150, r: 50, t: 80, b: 100 },
            barmode: 'stack',
            xaxis: { ...journalAxis, title: '<b>% BUSCOs</b>', titlefont: { size: 18 }, range: [0, 100] },
            yaxis: { ...journalAxis, showgrid: false, tickfont: { size: 16, color: palette.charcoal, weight: 'bold' }, linewidth: 0 },
            legend: { orientation: 'h', y: 1.15, x: 1, xanchor: 'right', font: { size: 13, color: palette.charcoal } },
            annotations: [{
              x: 0.5, y: -0.45, xref: 'paper', yref: 'paper',
              text: `<b>${data.busco.summary_string}</b>`,
              showarrow: false, font: { size: 16, color: palette.charcoal }
            }]
          }}
          useResizeHandler={true} style={{ width: '100%', height: '350px' }}
        />
      </div>

      {/* ---------------- PLOT 2 & STATS PANEL ---------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', alignItems: 'stretch' }}>
        
        {/* Left: CheckM Bar Plot */}
        <div style={{ flex: '1 1 55%', minWidth: 'min(100%, 500px)' }}>
          <Plot
            data={[
              // Stacked Bars
              { x: [data.checkm.completeness], y: isolate, type: 'bar', orientation: 'h', name: '<b>Completeness</b>', marker: { color: palette.checkmComp, line: { color: 'white', width: 2 } } },
              { x: [data.checkm.contamination], y: isolate, type: 'bar', orientation: 'h', name: '<b>Contamination</b>', marker: { color: palette.checkmContam, line: { color: 'white', width: 2 } } },
              { x: [data.checkm.residual], y: isolate, type: 'bar', orientation: 'h', name: '<b>Residual</b>', marker: { color: palette.checkmRes, line: { color: 'white', width: 2 } } },
              
              // Strain Heterogeneity Scatter Point
              {
                x: [Math.min(data.checkm.heterogeneity, 100)], y: isolate, type: 'scatter', mode: 'markers', name: '<b>Strain Heterogeneity</b>',
                marker: { color: palette.checkmHetero, size: 22, line: { color: palette.charcoal, width: 1.5 } },
                hoverinfo: 'name+x'
              }
            ]}
            layout={{
              title: { text: '<b>CheckM Genome Quality</b>', font: { size: 22, color: palette.charcoal, family: 'Arial' }, pad: { b: 20 } },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 150, r: 50, t: 60, b: 120 },
              barmode: 'stack',
              xaxis: { ...journalAxis, title: '<b>Quality profile (%)</b>', titlefont: { size: 18 }, range: [0, 100] },
              yaxis: { ...journalAxis, showgrid: false, tickfont: { size: 16, color: palette.charcoal, weight: 'bold' }, linewidth: 0 },
              legend: { orientation: 'h', y: -0.3, x: 0.5, xanchor: 'center', font: { size: 13, color: palette.charcoal } },
              annotations: [
                { x: data.checkm.completeness / 2, y: 0.45, xref: 'x', yref: 'y', text: `<b>Completeness<br>${data.checkm.completeness.toFixed(2)}%</b>`, showarrow: false, font: { size: 13, color: palette.charcoal }, yanchor: 'bottom' },
                { x: data.checkm.completeness + (data.checkm.contamination / 2), y: 0.45, xref: 'x', yref: 'y', text: `<b>Contamination<br>${data.checkm.contamination.toFixed(2)}%</b>`, showarrow: false, font: { size: 13, color: palette.charcoal }, yanchor: 'bottom' },
                { x: Math.min(data.checkm.heterogeneity, 100) + 3, y: 0, xref: 'x', yref: 'y', text: `<b>Strain heterogeneity: ${data.checkm.heterogeneity.toFixed(2)}%</b>`, showarrow: false, font: { size: 13, color: palette.charcoal }, xanchor: 'left' }
              ]
            }}
            useResizeHandler={true} style={{ width: '100%', height: '400px' }}
          />
        </div>

        {/* Right: Assembly and Genome Statistics Panel */}
        <div style={{ flex: '1 1 40%', minWidth: 'min(100%, 400px)', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ textAlign: 'center', margin: '0 0 25px 0', fontSize: '22px', color: palette.charcoal }}><b>Assembly and Genome Statistics</b></h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexGrow: 1, justifyContent: 'center' }}>
            {data.stats.map((stat, idx) => (
              <div 
                key={stat.label} 
                style={{
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  backgroundColor: idx % 2 === 0 ? '#F6F8FA' : '#EDF3F8',
                  border: '1.5px solid #444444',
                  borderRadius: '6px',
                  padding: '12px 20px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                }}
              >
                <span style={{ fontSize: '16px', fontWeight: 'bold', color: palette.charcoal }}>{stat.label}</span>
                <span style={{ fontSize: '16px', fontWeight: 'bold', color: palette.charcoal }}>{stat.value}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default WGSSRCheckmBuscoDashboard;
