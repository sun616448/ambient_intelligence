import { useState } from 'react';
import { STATUS_COLOR, STATUS_LABEL } from '../../config/sensorConfig';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const FS = A11Y_THEME.fontMin;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;

export function SensorDot({ sensor, onClick, pulsing = false, disableHover = false }) {
  const [hovered, setHovered] = useState(false);
  const noConsent = sensor.consented === false;
  const color = noConsent ? '#333' : (STATUS_COLOR[sensor.status] ?? '#888');
  const showTooltip = hovered && !pulsing && !disableHover;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${sensor.position.x}%`,
        top: `${sensor.position.y}%`,
        // pulsing keyframe owns the transform; otherwise set it inline
        transform: pulsing ? undefined : 'translate(-50%, -50%)',
        animation: pulsing ? 'sensorPulse 1s ease-in-out infinite' : 'none',
        cursor: disableHover ? 'crosshair' : 'pointer',
        zIndex: pulsing ? 60 : hovered ? 10 : 5,
      }}
      onMouseEnter={() => { if (!disableHover) setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        if (disableHover) return;
        e.stopPropagation();
        onClick(sensor);
      }}
    >
      {showTooltip && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 10px)', left: '50%',
          transform: 'translateX(-50%)',
          background: '#1e1e1e', border: '1px solid #333', borderRadius: '6px',
          padding: '6px 10px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 20,
        }}>
          <div style={{ fontSize: FS, color: TEXT_PRIMARY, marginBottom: '2px' }}>{sensor.name}</div>
          <div style={{ fontSize: FS, color }}>{noConsent ? 'No permission' : STATUS_LABEL[sensor.status]}</div>
        </div>
      )}
      <div style={{
        width: pulsing ? '16px' : hovered ? '18px' : '14px',
        height: pulsing ? '16px' : hovered ? '18px' : '14px',
        borderRadius: '50%',
        background: color,
        boxShadow: pulsing
          ? `0 0 0 4px ${color}55, 0 0 12px ${color}66`
          : hovered ? `0 0 0 5px ${color}33` : `0 0 0 2px ${color}44`,
        transition: pulsing ? 'none' : 'width 0.15s, height 0.15s, box-shadow 0.15s',
      }} />
    </div>
  );
}
