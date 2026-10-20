import React, { useState, useEffect } from 'react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

const Plot = createPlotlyComponent(Plotly);

const CAZymeDashboard = () => {
  const [plotData, setPlotData] = useState(null);

  useEffect(() => {
    fetch('/cazyme_plots_data.json')
      .then((response) => response.json())
      .then((data) => setPlotData(data))
      .catch((error) => console.error("Error loading CAZyme data:", error));
  }, []);

  if (!plotData) {
    return <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif' }}>Loading CAZyme Data...</div>;
  }

  // Wong (2011) colorblind-safe palette — Nature/Cell Press standard
  const palette = {
    "GH": "#E69F00",     // amber
    "GT": "#0072B2",     // cobalt blue
    "PL": "#CC79A7",     // rose pink
    "CE": "#009E73",     // teal green
    "AA": "#56B4E9",     // sky blue
    "CBM": "#D55E00",    // vermillion
    "Others": "#999999", // grey
    "charcoal": "#1a1a1a",
    "faintGrid": "rgba(0,0,0,0.05)"
  };

  // Ultra-crisp, Nature Journal Axis Layout
  const journalAxis = {
    showline: true,
    linewidth: 2,
    linecolor: palette.charcoal,
    mirror: false,
    ticks: 'outside',
    tickwidth: 2,
    ticklen: 6,
    tickcolor: palette.charcoal,
    tickfont: { family: 'Arial, Helvetica, sans-serif', size: 14, color: palette.charcoal, weight: 'bold' },
    showgrid: true,
    gridcolor: palette.faintGrid,
    gridwidth: 1,
    zeroline: false,
  };

  // YlGnBu_r gradient approximation for the Top 15 Bar Plot
  const ylGnBuGradient = [
    '#225ea8', '#1d91c0', '#41b6c4', '#41b6c4', '#7fcdbb', 
    '#7fcdbb', '#c7e9b4', '#c7e9b4', '#edf8b1', '#edf8b1',
    '#edf8b1', '#ffffd9', '#ffffd9', '#ffffd9', '#ffffd9'
  ];

  const donutLabels = plotData.donut.map(d => d.class);
  const donutValues = plotData.donut.map(d => d.count);
  const donutColors = donutLabels.map(cls => palette[cls] || palette.Others);

  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1300px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      {/* ---------------- PLOT 1: DONUT & LEGEND TABLE ---------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', marginBottom: '80px', gap: '20px' }}>
        
        {/* Left: Plotly Donut Chart */}
        <div style={{ flex: '1 1 45%', minWidth: '400px', position: 'relative' }}>
          <Plot
            data={[{
              values: donutValues,
              labels: donutLabels,
              type: 'pie',
              hole: 0.6,
              marker: { colors: donutColors, line: { color: '#ffffff', width: 3 } },
              textinfo: 'none',
              hoverinfo: 'label+value+percent'
            }]}
            layout={{
              title: { text: '<b>CAZyme Class Distribution</b>', font: { size: 22, color: palette.charcoal, family: 'Arial' }, y: 0.95 },
              showlegend: false,
              margin: { t: 80, b: 20, l: 20, r: 20 },
              annotations: [
                {
                  text: `<b>${plotData.total_genes}</b><br><span style="font-size:16px; color:#555;">CAZyme<br>Genes</span>`,
                  showarrow: false,
                  font: { size: 36, color: palette.charcoal },
                  x: 0.5, y: 0.5
                }
              ]
            }}
            useResizeHandler={true} 
            style={{ width: '100%', height: '500px' }}
          />
        </div>

        {/* Right: Custom HTML Journal Table */}
        <div style={{ flex: '1 1 50%', minWidth: '500px' }}>
          <h2 style={{ textAlign: 'center', margin: '0 0 10px 0', fontSize: '20px', color: palette.charcoal }}><b>CAZyme Classes</b></h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', color: palette.charcoal }}>
            <thead>
              <tr style={{ borderTop: '2px solid #888', borderBottom: '1px solid #bbb' }}>
                <th style={{ padding: '12px 8px', textAlign: 'left' }}>CAZyme Class</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>n</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>%</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Proportion</th>
              </tr>
            </thead>
            <tbody>
              {plotData.donut.map((row, idx) => (
                <tr key={row.class} style={{ backgroundColor: idx % 2 === 0 ? '#F5F7FA' : 'transparent', borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px 8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '16px', height: '16px', backgroundColor: palette[row.class] }}></div>
                    <span style={{ fontWeight: 'bold', color: palette[row.class], width: '45px' }}>{row.class}</span>
                    <span style={{ fontWeight: 'bold' }}>{row.full_name}</span>
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 'bold' }}>{row.count}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 'bold' }}>{row.percentage.toFixed(1)}</td>
                  <td style={{ padding: '10px 8px', verticalAlign: 'middle' }}>
                    {/* Inline Proportion Bar */}
                    <div style={{ width: '100px', height: '12px', backgroundColor: '#E2E8F0', margin: '0 auto', position: 'relative' }}>
                      <div style={{ width: `${row.percentage}%`, height: '100%', backgroundColor: palette[row.class], position: 'absolute', top: 0, left: 0 }}></div>
                    </div>
                  </td>
                </tr>
              ))}
              {/* Total Row */}
              <tr style={{ borderTop: '2px solid #888', borderBottom: '2px solid #888' }}>
                <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>Total</td>
                <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>{plotData.total_genes}</td>
                <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 'bold' }}>100.0</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------------- PLOT 2: HORIZONTAL BARPLOT ---------------- */}
      <div style={{ width: '100%', borderTop: `1px solid ${palette.faintGrid}`, paddingTop: '50px' }}>
        <Plot
          data={[{
            y: plotData.barplot.y,
            x: plotData.barplot.x,
            type: 'bar',
            orientation: 'h',
            marker: { 
              color: ylGnBuGradient.slice(0, plotData.barplot.y.length), 
              line: { color: palette.charcoal, width: 1.2 } 
            },
            text: plotData.barplot.x.map(String),
            textposition: 'outside',
            textfont: { family: 'Arial', size: 14, color: palette.charcoal, weight: 'bold' },
            cliponaxis: false
          }]}
          layout={{
            title: { text: '<b>Top 15 Most Abundant CAZyme Families</b>', font: { size: 22, color: palette.charcoal, family: 'Arial' }, x: 0.05 },
            plot_bgcolor: 'white', paper_bgcolor: 'white',
            margin: { l: 100, r: 50, t: 70, b: 70 },
            xaxis: { ...journalAxis, title: '<b>Gene Count</b>', titlefont: { size: 18 } },
            yaxis: { 
              ...journalAxis, 
              title: '<b>CAZyme Family</b>', 
              titlefont: { size: 18 }, 
              autorange: 'reversed', 
              showgrid: false 
            }
          }}
          useResizeHandler={true} 
          style={{ width: '100%', height: '650px' }}
        />
      </div>

    </div>
  );
};

export default CAZymeDashboard;