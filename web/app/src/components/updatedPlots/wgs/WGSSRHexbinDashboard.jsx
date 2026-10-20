import React from 'react';

const WGSSRHexbinDashboard = ({ assetUrl }) => {

  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, Helvetica, sans-serif', maxWidth: '1400px', margin: '0 auto', backgroundColor: '#FFFFFF' }}>
      
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        
        
        {/* Direct SVG Import for rendering the heavy Hexbin points natively without lag */}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <img 
            src={assetUrl} 
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
