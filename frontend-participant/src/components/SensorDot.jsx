import { useState } from 'react'

const STATUS_COLOR = {
  online:  '#4ade80',
  gap:     '#fb923c',
  offline: '#f87171',
}

export default function SensorDot({ sensor, onClick }) {
  const [hovered, setHovered] = useState(false)

  const color = !sensor.consented ? '#444' : (STATUS_COLOR[sensor.status] || '#444')
  const { x, y } = sensor.position

  return (
    <div
      onClick={() => onClick(sensor)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        cursor: 'pointer',
        zIndex: 10,
      }}
    >
      <div style={{
        width: hovered ? 20 : 14,
        height: hovered ? 20 : 14,
        borderRadius: '50%',
        background: color,
        border: `2px solid rgba(255,255,255,0.2)`,
        transition: 'width 0.15s, height 0.15s',
        boxShadow: (sensor.consented && sensor.status === 'online')
          ? `0 0 10px ${color}88`
          : 'none',
      }} />

      {hovered && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1e1e1e',
          border: '1px solid #333',
          borderRadius: 8,
          padding: '5px 12px',
          fontSize: 12,
          color: '#f5f5f5',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 20,
        }}>
          {sensor.label}
        </div>
      )}
    </div>
  )
}
