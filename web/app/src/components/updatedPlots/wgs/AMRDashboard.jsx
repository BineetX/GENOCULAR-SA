import React, { useState, useEffect } from 'react';
import Plot from "../UpdatedPlot.jsx";



const AMRDashboard = ({ src }) => {
  const [plotData, setPlotData] = useState(null);

  useEffect(() => {
    fetch(src)
      .then((response) => response.json())
      .then((data) => setPlotData(data))
      .catch((error) => console.error("Error loading AMR data:", error));
  }, [src]);

  if (!plotData) {
    return <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif' }}>Loading AMR Data...</div>;
  }

  // Nature Publishing Group (NPG) Scientific Color Palette
  const npgPalette = ["#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F"];
  const charcoal = "#1a1a1a";
  
  // Table Styling Colors
  const headerColor = "#0090B0";
  const rowShade = "#D6F3F7";

  // Ultra-crisp, Nature Journal Axis Layout
  const journalAxis = {
    showline: true,
    linewidth: 2,
    linecolor: charcoal,
    mirror: false,
    ticks: 'outside',
    tickwidth: 2,
    ticklen: 6,
    tickcolor: charcoal,
    tickfont: { family: 'Arial, Helvetica, sans-serif', size: 14, color: charcoal, weight: 'bold' },
    showgrid: false,
    zeroline: false,
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      {/* ---------------- TOP ROW: BAR CHARTS ---------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', marginBottom: '80px' }}>
        
        {/* Plot 1: Hits per database */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[{
              x: plotData.hits_per_db.x,
              y: plotData.hits_per_db.y,
              type: 'bar',
              marker: { 
                color: npgPalette,
                line: { color: charcoal, width: 1.5 } 
              },
              text: plotData.hits_per_db.y.map(String),
              textposition: 'outside',
              textfont: { family: 'Arial', size: 14, color: charcoal, weight: 'bold' }
            }]}
            layout={{
              title: { text: '<b>Hits per database</b>', font: { size: 20, color: charcoal, family: 'Arial' }, x: 0.02 },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 80, r: 30, t: 70, b: 80 },
              xaxis: { ...journalAxis, tickangle: 30 },
              yaxis: { ...journalAxis, title: '<b>Number of hits</b>', titlefont: { size: 16 }, range: [0, Math.max(...plotData.hits_per_db.y) * 1.15] },
            }}
            useResizeHandler={true} style={{ width: '100%', height: '450px' }}
          />
        </div>

        {/* Plot 2: Top resistance classes */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          {plotData.top_classes ? (
            <Plot
              data={[{
                y: plotData.top_classes.y,
                x: plotData.top_classes.x,
                type: 'bar',
                orientation: 'h',
                marker: { color: npgPalette[1], line: { color: charcoal, width: 1.5 } },
              }]}
              layout={{
                title: { text: '<b>Top resistance classes</b>', font: { size: 20, color: charcoal, family: 'Arial' }, x: 0.02 },
                plot_bgcolor: 'white', paper_bgcolor: 'white',
                margin: { l: 150, r: 50, t: 70, b: 80 },
                xaxis: { ...journalAxis, title: '<b>Gene count</b>', titlefont: { size: 16 } },
                yaxis: { ...journalAxis, tickfont: { family: 'Arial', size: 13, color: charcoal, weight: 'bold' } },
              }}
              useResizeHandler={true} style={{ width: '100%', height: '450px' }}
            />
          ) : (
            <div style={{ width: '100%', height: '450px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${charcoal}` }}>
              <h3 style={{ color: charcoal }}>No resistance class data</h3>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- BOTTOM ROW: GENE TABLES ---------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px', justifyContent: 'space-between' }}>
        
        {['CARD', 'NCBI', 'VFDB', 'ResFinder'].map((dbName) => {
          const dbData = plotData.gene_tables[dbName];
          if (!dbData) return null;

          return (
            <div key={dbName} style={{ flex: '1 1 22%', minWidth: '220px', display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ textAlign: 'center', fontSize: '15px', color: charcoal, marginBottom: '10px' }}>
                <b>{dbName} AMR genes detected (n={dbData.total})</b>
              </h3>
              
              <table style={{ width: '100%', borderCollapse: 'collapse', border: `1.5px solid ${charcoal}`, borderBottom: 'none' }}>
                <thead>
                  <tr>
                    <th style={{ backgroundColor: headerColor, color: 'white', padding: '8px 12px', textAlign: 'left', borderBottom: `1.5px solid ${charcoal}`, fontSize: '14px' }}>
                      <b>Gene</b>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dbData.total === 0 ? (
                    <tr>
                      <td style={{ textAlign: 'center', padding: '10px', borderBottom: `1.5px solid ${charcoal}`, fontSize: '13px' }}>
                        <b>No genes detected</b>
                      </td>
                    </tr>
                  ) : (
                    <>
                      {dbData.shown.map((gene, idx) => (
                        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? rowShade : 'white' }}>
                          <td style={{ padding: '8px 12px', borderBottom: `1.5px solid ${charcoal}`, fontSize: '14px', fontStyle: 'italic', fontWeight: 'bold', color: charcoal }}>
                            {gene}
                          </td>
                        </tr>
                      ))}
                      {dbData.truncated && (
                        <tr>
                          <td style={{ textAlign: 'center', padding: '8px', borderBottom: `1.5px solid ${charcoal}`, fontSize: '12px', fontStyle: 'italic', color: '#444444' }}>
                            +{dbData.remainder} more not shown
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

    </div>
  );
};

export default AMRDashboard;