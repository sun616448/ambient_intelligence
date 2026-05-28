import { useRef, useState, useEffect } from 'react';
import { SensorDot } from './SensorDot';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const FS = A11Y_THEME.fontMin;
const TEXT_MUTED = A11Y_THEME.textMuted;
const TEXT_SOFT = A11Y_THEME.textSoft;

const STYLE_ID = 'floorplan-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes sensorPulse {
      0%, 100% { transform: translate(-50%, -50%) scale(1); }
      50%       { transform: translate(-50%, -50%) scale(1.3); }
    }
  `;
  document.head.appendChild(style);
}

export function FloorPlan({ sensors, onSensorClick, editLocation, onFloorPlanPlace }) {
  const containerRef = useRef(null);
  const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 });
  const [rendered, setRendered] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      const aspect = naturalSize.width / naturalSize.height;
      let w = width;
      let h = width / aspect;
      if (h > height) { h = height; w = height * aspect; }
      setRendered({ width: w, height: h });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [naturalSize]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const isClickMode  = editLocation?.mode === 'click';
  const editingId    = editLocation?.sensorId ?? null;
  const previewX     = editLocation ? Math.min(100, Math.max(0, parseFloat(editLocation.xStr) || 0)) : 0;
  const previewY     = editLocation ? Math.min(100, Math.max(0, parseFloat(editLocation.yStr) || 0)) : 0;

  const handlePlaneClick = (e) => {
    if (!isClickMode || !onFloorPlanPlace) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    onFloorPlanPlace(x, y);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #222' }}>
      {/* Header */}
      <div style={{ padding: '18px 20px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'baseline', gap: '10px', flexShrink: 0 }}>
        <span style={{ fontSize: '16px', fontWeight: 600, color: '#e5e5e5' }}>One Room Studio</span>
        <span style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Floor Plan</span>
        {isClickMode && (
          <span style={{
            fontSize: FS, color: '#4ade80',
            background: '#4ade8018', border: '1px solid #4ade8030',
            borderRadius: '999px', padding: '2px 10px', marginLeft: '6px',
          }}>
            Click to place
          </span>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#111', cursor: isClickMode ? 'crosshair' : 'default' }}
      >
        <div
          style={{ position: 'relative', width: rendered.width, height: rendered.height }}
          onClick={handlePlaneClick}
        >
          <img
            src="/floorplan.png"
            alt="Apartment floor plan"
            style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
            }}
          />

          {/* Crosshair guides while editing */}
          {editLocation && (
            <>
              <div style={{
                position: 'absolute', top: `${previewY}%`, left: 0, right: 0,
                height: '1px', background: 'rgba(74,222,128,0.3)', pointerEvents: 'none', zIndex: 3,
              }} />
              <div style={{
                position: 'absolute', left: `${previewX}%`, top: 0, bottom: 0,
                width: '1px', background: 'rgba(74,222,128,0.3)', pointerEvents: 'none', zIndex: 3,
              }} />
            </>
          )}

          {sensors.filter(s => !s.wearable && !s.noFloorPlan).map(s => {
            const isEditing = s.id === editingId;
            const dotX = isEditing ? previewX : s.position.x;
            const dotY = isEditing ? previewY : s.position.y;
            return (
              <SensorDot
                key={s.id}
                sensor={{ ...s, position: { x: dotX, y: dotY } }}
                onClick={onSensorClick}
                pulsing={isEditing}
                disableHover={isClickMode}
              />
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #222', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: '#1a1a1a', border: '1px solid #252525', borderRadius: '999px',
          padding: '5px 14px', fontSize: FS, color: TEXT_SOFT,
        }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
          Refreshing — Last updated {timeStr}
        </div>
      </div>
    </div>
  );
}
