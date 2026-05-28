const STATUS_COLOR = {
  online:  '#4ade80',
  gap:     '#fb923c',
  offline: '#f87171',
}

function simpleLabel(sensor) {
  if (!sensor.consented) return 'No permission'
  return 'Permission given'
}

function dotColor(sensor) {
  if (!sensor.consented) return '#444'
  return STATUS_COLOR[sensor.status] || '#444'
}

export default function SensorSidebar({ sensors, onSensorClick }) {
  return (
    <div style={{
      width: 280,
      flexShrink: 0,
      background: '#111',
      borderLeft: '1px solid #222',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: '18px 16px 14px',
        borderBottom: '1px solid #222',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#f5f5f5' }}>Sensors</span>
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {sensors.map(s => (
          <SensorCard key={s.id} sensor={s} onClick={onSensorClick} />
        ))}
      </div>
    </div>
  )
}

function SensorCard({ sensor, onClick }) {
  const color = dotColor(sensor)
  const label = simpleLabel(sensor)

  const bg = !sensor.consented
    ? { background: '#161616', border: '#2a2a2a' }
    : sensor.status === 'online'
      ? { background: '#0f1a0f', border: '#1e2e1e' }
      : sensor.status === 'gap'
        ? { background: '#1a1508', border: '#3a2a10' }
        : { background: '#1a0f0f', border: '#3a1a1a' }

  return (
    <button
      onClick={() => onClick(sensor)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: bg.background,
        border: `1px solid ${bg.border}`,
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 6,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#f5f5f5', lineHeight: 1.3 }}>
          {sensor.label}
        </span>
        {sensor.wearable && (
          <span style={{ fontSize: 11, color: '#555', marginLeft: 6, flexShrink: 0 }}>Wearable</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          boxShadow: sensor.consented && sensor.status === 'online' ? `0 0 5px ${color}88` : 'none',
        }} />
        <span style={{ fontSize: 13, color, fontWeight: 500 }}>{label}</span>
      </div>
    </button>
  )
}
