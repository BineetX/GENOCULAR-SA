import React, { useState, useEffect } from 'react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

const Plot = createPlotlyComponent(Plotly);

const KofamDashboard = () => {
  const [plotData, setPlotData] = useState(null);

  useEffect(() => {
    fetch('/kofam_plots_data.json')
      .then((response) => response.json())
      .then((data) => setPlotData(data))
      .catch((error) => console.error("Error loading plot data:", error));
  }, []);

  if (!plotData) {
    return <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial' }}>Loading KofamScan Data...</div>;
  }

  // Nature/Science standard color palette
  const colors = {
    red: '#E64B35', teal: '#00A087', blue: '#3C5488', 
    lightBlue: '#4DBBD5', darkGrey: '#333333'
  };

  // Shared Journal-Standard Axis Layout
  const journalAxis = {
    showline: true,
    linewidth: 1.5,
    linecolor: 'black',
    mirror: false,
    ticks: 'outside',
    tickwidth: 1.5,
    tickcolor: 'black',
    tickfont: { family: 'Arial, sans-serif', size: 14, color: 'black' },
    showgrid: false,
    zeroline: false,
  };

  // Shared Journal-Standard Legend Layout
  const journalLegend = {
    font: { family: 'Arial, sans-serif', size: 14, color: 'black' },
    bgcolor: 'rgba(255,255,255,0.9)',
    bordercolor: 'black',
    borderwidth: 1,
    x: 0.98,
    xanchor: 'right',
    y: 0.95
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px', marginBottom: '50px' }}>
        
        {/* Plot 1: KO hits per gene (Focused on Median) */}
        <div style={{ flex: '1 1 45%', minWidth: '400px' }}>
          <Plot
            data={[{
              x: plotData.plot1_ko_hits.x,
              y: plotData.plot1_ko_hits.y,
              type: 'bar',
              marker: { color: colors.blue, line: { color: 'black', width: 0.5 } },
              opacity: 0.95,
            }]}
            layout={{
              title: { text: '<b>KO hits per gene</b>', font: { size: 18, color: 'black', family: 'Arial' }, x: 0.05 },
              plot_bgcolor: 'white',
              paper_bgcolor: 'white',
              margin: { l: 70, r: 20, t: 60, b: 60 },
              xaxis: { 
                ...journalAxis, 
                title: '<b>Number of KO hits</b>', 
                titlefont: { size: 16 },
                range: [0, Math.max(15, plotData.plot1_ko_hits.median * 3)] 
              },
              yaxis: { ...journalAxis, title: '<b>Number of genes</b>', titlefont: { size: 16 } },
              shapes: [{
                type: 'line',
                x0: plotData.plot1_ko_hits.median, x1: plotData.plot1_ko_hits.median,
                y0: 0, y1: 1, yref: 'paper',
                line: { color: colors.red, dash: 'dash', width: 2.5 }
              }],
              annotations: [{
                x: plotData.plot1_ko_hits.median, y: 0.95, yref: 'paper',
                text: `<b>Median = ${plotData.plot1_ko_hits.median}</b>`,
                showarrow: false, xanchor: 'left', xshift: 10,
                font: { family: 'Arial', size: 14, color: 'black' }
              }]
            }}
            useResizeHandler={true} style={{ width: '100%', height: '400px' }}
          />
        </div>

        {/* Plot 2: Score Distribution */}
        <div style={{ flex: '1 1 45%', minWidth: '400px' }}>
          <Plot
            data={[
              {
                x: plotData.plot2_score_dist.x,
                y: plotData.plot2_score_dist.fail_y,
                type: 'bar',
                name: `<b>Below threshold (n=${plotData.plot2_score_dist.fail_count.toLocaleString()})</b>`,
                marker: { color: colors.red, line: { color: 'black', width: 0.5 } },
                opacity: 0.85,
              },
              {
                x: plotData.plot2_score_dist.x,
                y: plotData.plot2_score_dist.pass_y,
                type: 'bar',
                name: `<b>Above threshold (n=${plotData.plot2_score_dist.pass_count.toLocaleString()})</b>`,
                marker: { color: colors.teal, line: { color: 'black', width: 0.5 } },
                opacity: 0.95,
              }
            ]}
            layout={{
              title: { text: '<b>KO score distribution</b>', font: { size: 18, color: 'black', family: 'Arial' }, x: 0.05 },
              plot_bgcolor: 'white',
              paper_bgcolor: 'white',
              margin: { l: 70, r: 20, t: 60, b: 60 },
              xaxis: { ...journalAxis, title: '<b>KofamScan score</b>', titlefont: { size: 16 } },
              yaxis: { ...journalAxis, title: '<b>Count</b>', titlefont: { size: 16 } },
              barmode: 'overlay',
              legend: journalLegend
            }}
            useResizeHandler={true} style={{ width: '100%', height: '400px' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px', marginBottom: '50px' }}>
        
        {/* Plot 3: E-value Distribution */}
        <div style={{ flex: '1 1 45%', minWidth: '400px' }}>
          <Plot
            data={[{
              x: plotData.plot3_evalue_dist.x,
              y: plotData.plot3_evalue_dist.y,
              type: 'bar',
              marker: { color: colors.lightBlue, line: { color: 'black', width: 0.5 } },
              opacity: 0.95,
            }]}
            layout={{
              title: { text: '<b>E-value distribution</b>', font: { size: 18, color: 'black', family: 'Arial' }, x: 0.05 },
              plot_bgcolor: 'white',
              paper_bgcolor: 'white',
              margin: { l: 70, r: 20, t: 60, b: 60 },
              xaxis: { ...journalAxis, title: '<b>log₁₀(E-value)</b>', titlefont: { size: 16 } },
              yaxis: { ...journalAxis, title: '<b>Count</b>', titlefont: { size: 16 } },
              shapes: [{
                type: 'line',
                x0: plotData.plot3_evalue_dist.threshold_line, x1: plotData.plot3_evalue_dist.threshold_line,
                y0: 0, y1: 1, yref: 'paper',
                line: { color: 'black', dash: 'dot', width: 2 }
              }],
              annotations: [{
                x: plotData.plot3_evalue_dist.threshold_line, y: 0.95, yref: 'paper',
                text: '<b>E = 1×10⁻⁵</b>',
                showarrow: false, xanchor: 'right', xshift: -10,
                font: { family: 'Arial', size: 14, color: 'black' }
              }]
            }}
            useResizeHandler={true} style={{ width: '100%', height: '400px' }}
          />
        </div>

        {/* Plot 4: Functional Categories */}
        <div style={{ flex: '1 1 45%', minWidth: '400px' }}>
          <Plot
            data={[{
              x: plotData.plot4_categories.x,
              y: plotData.plot4_categories.y,
              type: 'bar', 
              orientation: 'h',
              marker: { 
                color: [colors.red, colors.teal, colors.blue, colors.lightBlue, '#F39B7F', '#8491B4', '#91D1C2', '#DC0000', '#7E6148', '#B09C85'],
                line: { color: 'black', width: 0.8 } 
              },
              text: plotData.plot4_categories.x.map(String),
              textposition: 'outside',
              textfont: { family: 'Arial', size: 13, color: 'black', weight: 'bold' }
            }]}
            layout={{
              title: { text: '<b>Functional category (best KO hit)</b>', font: { size: 18, color: 'black', family: 'Arial' }, x: 0.05 },
              plot_bgcolor: 'white',
              paper_bgcolor: 'white',
              margin: { l: 200, r: 50, t: 60, b: 60 },
              xaxis: { ...journalAxis, title: '<b>Number of genes</b>', titlefont: { size: 16 } },
              yaxis: { ...journalAxis, autorange: 'reversed' },
            }}
            useResizeHandler={true} style={{ width: '100%', height: '400px' }}
          />
        </div>
      </div>

      {/* Plot 5: Heatmap */}
      <div style={{ width: '100%', marginTop: '30px' }}>
        <Plot
          data={[{
            z: plotData.plot5_heatmap.z, 
            x: plotData.plot5_heatmap.x.map(cat => `<b>${cat}</b>`), 
            y: plotData.plot5_heatmap.y.map(id => `<b>${id}</b>`),
            type: 'heatmap',
            colorscale: [[0, '#FFFFFF'], [0.25, '#C6DBEF'], [0.5, '#6BAED6'], [0.75, '#2171B5'], [1, '#084594']],
            showscale: true, 
            colorbar: { 
              title: '<b>Score</b>',
              tickfont: { family: 'Arial, sans-serif', size: 14, color: 'black' },
              titlefont: { family: 'Arial, sans-serif', size: 16, color: 'black' },
              outlinewidth: 1.5,
              outlinecolor: 'black'
            }
          }]}
          layout={{
            title: { text: '<b>KofamScan score — top 30 genes across functional categories</b>', font: { size: 18, color: 'black', family: 'Arial' }, x: 0.05 },
            plot_bgcolor: 'white',
            paper_bgcolor: 'white',
            xaxis: { 
              ...journalAxis, 
              title: '<b>Functional categories</b>', 
              titlefont: { size: 16 }, 
              tickangle: -35 
            },
            yaxis: { 
              ...journalAxis, 
              title: '<b>Protein IDs</b>', 
              titlefont: { size: 16 }, 
              autorange: 'reversed' 
            },
            margin: { l: 220, b: 150, t: 60, r: 20 },
            height: 850
          }}
          useResizeHandler={true} style={{ width: '100%' }}
        />
      </div>
    </div>
  );
};

export default KofamDashboard;