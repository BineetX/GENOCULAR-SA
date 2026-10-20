import React from 'react';

const WGSSRHexbinDashboard = () => {
  const charcoal = "#1a1a1a";

  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        
        {/* Static Title matching the Nature-standard formatting */}
        <h2 style={{ textAlign: 'center', marginBottom: '40px', color: charcoal, fontSize: '24px' }}>
          <b>Per-base quality density heatmap</b>
        </h2>
        
        {/* Direct SVG Import for rendering the heavy Hexbin points natively without lag */}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <img 
            src="/PerBaseQuality_Density_WGS_SR.svg" 
            alt="Per-base Quality Density Heatmap" 
            style={{ 
              maxWidth: '100%', 
              height: 'auto', 
              maxHeight: '600px', 
              display: 'block' 
            }} 
          />
        </div>
        
      </div>

    </div>
  );
};

export default WGSSRHexbinDashboard;