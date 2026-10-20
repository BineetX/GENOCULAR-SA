import React, { useState, useEffect } from 'react';
import Plot from "../UpdatedPlot.jsx";



const EmapperDashboard = ({ src }) => {
  const [plotData, setPlotData] = useState(null);

  useEffect(() => {
    fetch(src)
      .then((response) => response.json())
      .then((data) => setPlotData(data))
      .catch((error) => console.error("Error loading Emapper data:", error));
  }, [src]);

  if (!plotData) {
    return <div style={{ padding: '2rem', fontWeight: 'bold', fontFamily: 'Arial, Helvetica, sans-serif' }}>Loading eggNOG-mapper Data...</div>;
  }

  // Nature Publishing Group (NPG) Scientific Color Palette
  const npg = {
    red: '#E64B35', blue: '#4DBBD5', teal: '#00A087', darkBlue: '#3C5488',
    orange: '#F39B7F', purple: '#8491B4', mint: '#91D1C2', darkRed: '#DC0000',
    charcoal: '#1a1a1a', faintGrid: 'rgba(0,0,0,0.05)',
  };

  // Specific Group Palette for COG Super-categories (Nature Genetics style)
  const cogGroupPalette = {
    "Information storage & processing": { dark: "#3C5488", light: "rgba(60, 84, 136, 0.12)" }, // NPG Dark Blue
    "Cellular processes & signalling": { dark: "#E64B35", light: "rgba(230, 75, 53, 0.12)" },   // NPG Red
    "Metabolism": { dark: "#00A087", light: "rgba(0, 160, 135, 0.12)" },                        // NPG Teal
    "Poorly characterized": { dark: "#7E6148", light: "rgba(126, 97, 72, 0.12)" },              // NPG Brown
  };

  const journalAxis = {
    showline: true, linewidth: 2, linecolor: npg.charcoal, mirror: false,
    ticks: 'outside', tickwidth: 2, ticklen: 6, tickcolor: npg.charcoal,
    tickfont: { family: 'Arial, Helvetica, sans-serif', size: 14, color: npg.charcoal, weight: 'bold' },
    showgrid: false, zeroline: false,
  };

  // --- Process COG Plot Traces and Shading ---
  const cogY = plotData.cog_lollipop.cogs.map((c, i) => i);
  const cogX = plotData.cog_lollipop.cogs.map(c => c.count);
  
  // Format text securely for Plotly Bar outside placement
  const cogText = plotData.cog_lollipop.cogs.map(c => `${c.count.toLocaleString()} (${c.percentage}%)`); 
  const cogColors = plotData.cog_lollipop.cogs.map(c => cogGroupPalette[c.super_category].dark);
  const cogYTickText = plotData.cog_lollipop.cogs.map(c => `<b>[${c.letter}]</b> ${c.description}`);
  
  // Generate background shading blocks for COG super-categories
  const cogBackgroundShapes = [];
  let currentGroup = null;
  let startIdx = 0;

  plotData.cog_lollipop.cogs.forEach((c, idx) => {
    if (c.super_category !== currentGroup) {
      if (currentGroup !== null) {
        cogBackgroundShapes.push({
          type: 'rect', x0: 0, x1: 1, xref: 'paper', y0: startIdx - 0.5, y1: idx - 0.5,
          fillcolor: cogGroupPalette[currentGroup].light, line: { width: 0 }, layer: 'below'
        });
      }
      currentGroup = c.super_category;
      startIdx = idx;
    }
  });
  
  if (currentGroup !== null) {
    cogBackgroundShapes.push({
      type: 'rect', x0: 0, x1: 1, xref: 'paper', y0: startIdx - 0.5, y1: plotData.cog_lollipop.cogs.length - 0.5,
      fillcolor: cogGroupPalette[currentGroup].light, line: { width: 0 }, layer: 'below'
    });
  }

  return (
    <div style={{ padding: '30px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      {/* ---------------- TOP ROW: EC DONUT & PFAM BAR CHART ---------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', marginBottom: '60px' }}>
        
        {/* Plot 1: EC Enzyme Classification */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[{
              values: plotData.ec_donut.values,
              labels: plotData.ec_donut.labels,
              type: 'pie',
              hole: 0.55,
              marker: { colors: [npg.darkBlue, npg.teal, npg.orange, npg.red, npg.purple, npg.mint, npg.blue], line: { color: 'white', width: 2.5 } },
              textinfo: 'label+percent',
              textposition: 'outside',
              textfont: { family: 'Arial', size: 14, color: npg.charcoal, weight: 'bold' }
            }]}
            layout={{
              title: { text: '<b>EC Enzyme Classification</b>', font: { size: 22, color: npg.charcoal, family: 'Arial' } },
              margin: { t: 80, b: 40, l: 40, r: 40 },
              showlegend: false
            }}
            useResizeHandler={true} style={{ width: '100%', height: '500px' }}
          />
        </div>

        {/* Plot 2: PFAM Domain Families (Converted to Nature-Standard Bar Chart) */}
        <div style={{ flex: '1 1 45%', minWidth: 'min(100%, 450px)' }}>
          <Plot
            data={[{
              x: plotData.pfam_lollipop.x,
              y: plotData.pfam_lollipop.y,
              type: 'bar',
              orientation: 'h',
              marker: { color: npg.darkBlue, line: { color: npg.charcoal, width: 1.5 } },
              text: plotData.pfam_lollipop.x.map(String),
              textposition: 'outside',
              textfont: { family: 'Arial', size: 14, color: npg.charcoal, weight: 'bold' },
              cliponaxis: false
            }]}
            layout={{
              title: { text: '<b>Top PFAM Domain Families</b>', font: { size: 22, color: npg.charcoal, family: 'Arial' }, x: 0.02 },
              plot_bgcolor: 'white', paper_bgcolor: 'white',
              margin: { l: 150, r: 50, t: 70, b: 70 },
              xaxis: { ...journalAxis, title: '<b>Gene Count</b>', titlefont: { size: 18 } },
              yaxis: { ...journalAxis, showgrid: false, tickfont: { size: 13, color: npg.charcoal, weight: 'bold' } },
            }}
            useResizeHandler={true} style={{ width: '100%', height: '500px' }}
          />
        </div>
      </div>

      {/* ---------------- BOTTOM ROW: COG GROUPED BAR CHART ---------------- */}
      <div style={{ width: '100%', borderTop: `2px solid ${npg.faintGrid}`, paddingTop: '50px' }}>
        <Plot
          data={[{
            x: cogX,
            y: cogY,
            text: cogText,
            type: 'bar', // Converted to scientifically precise bar chart
            orientation: 'h',
            textposition: 'outside',
            textfont: { family: 'Arial', size: 13, color: npg.charcoal, weight: 'bold' },
            cliponaxis: false,
            marker: { color: cogColors, line: { color: npg.charcoal, width: 1.2 } },
            width: 0.7 // Leaves clean spacing between bars inside the shaded groups
          }]}
          layout={{
            title: { 
              text: '<b>COG Functional Category Distribution</b><br><span style="font-size: 15px; color: #555;">Grouped into standard COG super-categories</span>', 
              font: { size: 24, color: npg.charcoal, family: 'Arial' }, 
              x: 0.02 
            },
            plot_bgcolor: 'white', paper_bgcolor: 'white',
            margin: { l: 450, r: 120, t: 90, b: 80 }, 
            xaxis: { ...journalAxis, title: '<b>Number of Genes</b>', titlefont: { size: 18 }, range: [0, Math.max(...cogX) * 1.15] },
            yaxis: { 
              ...journalAxis, 
              tickmode: 'array', tickvals: cogY, ticktext: cogYTickText,
              showline: true, ticks: 'outside', tickfont: { size: 13, color: npg.charcoal }
            },
            shapes: cogBackgroundShapes,
            showlegend: false
          }}
          useResizeHandler={true} 
          style={{ width: '100%', height: `${Math.max(600, plotData.cog_lollipop.cogs.length * 40)}px` }}
        />
      </div>

    </div>
  );
};

export default EmapperDashboard;