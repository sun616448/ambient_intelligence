
const STATUS_COLOR = {
  online:  '#4ade80',
  gap:     '#fb923c',
  offline: '#f87171',
}
const STATUS_LABEL = {
  online:  'Collecting data',
  gap:     'Collecting data',
  offline: 'Not collecting data',
}

export default function SensorModal({ sensor, onClose, onToggle }) {
  const toggled = sensor.consented

  function handleToggle() {
    onToggle(sensor.id, !toggled)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#161616',
          border: '1px solid #2a2a2a',
          borderRadius: 20,
          padding: '32px',
          width: '100%',
          maxWidth: 420,
          position: 'relative',
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            color: '#555',
            cursor: 'pointer',
            fontSize: 22,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>

        <h2 style={{ fontSize: 17, fontWeight: 600, color: '#f5f5f5', marginBottom: 24, paddingRight: 24 }}>
          {sensor.label}
        </h2>

        {sensor.consented ? (
          <>
            {/* Toggle row */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              background: '#1a1a1a',
              borderRadius: 12,
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#f5f5f5' }}>
                  {toggled ? 'Permission given' : 'Permission withdrawn'}
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.4 }}>
                  {toggled ? 'You have allowed this sensor to collect data.' : 'This sensor will not collect your data.'}
                </div>
              </div>
              <button
                onClick={handleToggle}
                aria-label={toggled ? 'Pause sensor' : 'Activate sensor'}
                style={{
                  width: 50,
                  height: 28,
                  borderRadius: 14,
                  background: toggled ? '#4ade80' : '#2a2a2a',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: 3,
                  left: toggled ? 25 : 3,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                  display: 'block',
                }} />
              </button>
            </div>

            <p style={{
              fontSize: 12,
              color: '#555',
              marginTop: 20,
              textAlign: 'center',
              lineHeight: 1.5,
            }}>
              Sensor preferences are recorded and shared with your research team.
            </p>
          </>
        ) : (
          /* No consent state */
          <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
            <div style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#1e1e1e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 18px',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"
                  stroke="#555" strokeWidth="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"
                  stroke="#555" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <p style={{ color: '#888', fontSize: 15, marginBottom: 10 }}>
              No permission given
            </p>
            <p style={{ color: '#555', fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>
              You have not given permission for this sensor.
            </p>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              background: '#1a1a1a',
              borderRadius: 12,
              textAlign: 'left',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#f5f5f5' }}>Allow sensor to collect</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Tap to give permission</div>
              </div>
              <button
                onClick={handleToggle}
                aria-label="Give permission"
                style={{
                  width: 50, height: 28, borderRadius: 14,
                  background: '#2a2a2a', border: 'none', cursor: 'pointer',
                  position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: 3,
                  width: 22, height: 22, borderRadius: '50%',
                  background: '#fff', display: 'block',
                }} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
