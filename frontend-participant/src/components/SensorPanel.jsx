import { useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const CAMERA_IDS = new Set(['wyze_camera', 'depth_camera'])

const SENSOR_INFO = {
  wyze_camera: {
    description: "Records video and audio in living areas to help researchers track daily activities and movement patterns. You have full control through the Wyze app — you can turn it on or off, view the live feed, and manage recordings at any time. The research team has no access to the camera, the app, or any recordings until the observation period ends and you choose to share the data.",
    placement: "Mounted on ceilings in living areas. Not placed in bathrooms or bedrooms.",
  },
  depth_camera: {
    description: "Captures 3D depth maps and body silhouettes to track movement and posture without recording identifiable video. It operates in depth-only mode — faces and personal features are not visible in the data. Researchers use this to measure gait, balance, and activity patterns.",
    placement: "Mounted on ceilings or high on walls in living areas. Not placed in bathrooms or bedrooms.",
  },
  light_temperature: {
    description: "Measures room temperature (°C) and light levels (lux) throughout the day. This helps researchers understand how your indoor environment — lighting and warmth — relates to sleep quality, physical activity, and mood.",
    placement: "Placed on tabletops and windows in the bedroom, living room, and bathroom.",
  },
  wearable_light: {
    description: "Measures the light you are personally exposed to throughout the day — its intensity, timing, and spectrum. Researchers use this to study how light exposure influences sleep, alertness, and wellbeing.",
    placement: "Worn as a clip on clothing or as a necklace, ideally at chest or neck level for the most accurate readings.",
  },
  bed_sensor: {
    description: "Placed under the mattress, this sensor detects heart rate, breathing rate, and movement during sleep using ballistocardiography — it senses the tiny vibrations your body makes without any contact. It provides sleep stage estimates and overnight rest quality data.",
    placement: "Under your mattress at chest level, plugged into a wall outlet.",
  },
  vibration: {
    description: "Detects floor and surface vibrations — including footsteps — at 500 readings per second. Researchers use this data to track movement through the home, analyse gait patterns, and work toward fall detection and prevention.",
    placement: "Placed on the floor and on surfaces you commonly interact with, such as tables.",
  },
  pressure: {
    description: "Measures pressure distribution across a sensing pad to detect occupancy and usage patterns. Researchers use this to understand how often and how long key areas are used each day.",
    placement: "One sensor under the toilet seat; one under a commonly used chair or sofa.",
  },
  motion: {
    description: "Detects whether movement is present in a room and records when it starts and stops. Researchers use this to track room-by-room activity patterns, daily routines, and prolonged inactivity that may signal a safety concern.",
    placement: "Mounted at approximately 6–8 feet on walls or ceilings in every room.",
  },
  surface_temperature: {
    description: "Records the temperature of surfaces near bathroom fixtures like sinks and showers. Changes in surface temperature indicate when the bathroom is being used, helping researchers understand daily routines and identify potential safety hazards.",
    placement: "Installed in the bathroom, near sinks and shower surfaces.",
  },
  heartrate: {
    description: "A wristwatch worn continuously — including during sleep — that tracks heart rate, movement, posture, and sleep/wake cycles. Researchers use this data to build a picture of your physical activity, rest, and overall wellbeing over time.",
    placement: "Worn on your wrist. Provided by the research team.",
  },
  smart_plug: {
    description: "Plugs in between a sensor and the wall outlet, giving you a simple way to power devices on or off from a mobile app. The research team has no access to the smart plug or any data it may collect.",
    placement: "Plugged into wall outlets alongside connected sensors.",
  },
}

export default function SensorPanel({ sensors, floorPlan, onToggle }) {
  const [infoSensor, setInfoSensor] = useState(null)

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      display: 'flex',
      justifyContent: 'center',
      padding: '24px 24px 48px',
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gridAutoRows: '230px',
        gap: 20,
        width: '100%',
      }}>
        {sensors.map(sensor => (
          <SensorCard
            key={sensor.id}
            sensor={sensor}
            onToggle={onToggle}
            onInfo={setInfoSensor}
          />
        ))}
      </div>

      {infoSensor && (
        <SensorInfoModal
          sensor={infoSensor}
          floorPlan={floorPlan}
          onClose={() => setInfoSensor(null)}
        />
      )}
    </div>
  )
}

function SensorCard({ sensor, onToggle, onInfo }) {
  if (CAMERA_IDS.has(sensor.id)) {
    return <CameraCard sensor={sensor} onInfo={onInfo} />
  }

  const isOn = sensor.consented

  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      borderRadius: 18,
      padding: '24px 20px 20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      height: '100%',
      boxSizing: 'border-box',
    }}>
      {/* Sensor name */}
      <div style={{
        fontSize: 17,
        fontWeight: 600,
        color: '#ffffff',
        textAlign: 'center',
        lineHeight: 1.4,
      }}>
        {sensor.label}
      </div>

      {/* ON/OFF label */}
      <span style={{
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: isOn ? '#4ade80' : '#888888',
      }}>
        {isOn ? 'ON' : 'OFF'}
      </span>

      {/* Toggle */}
      <button
        onClick={() => onToggle(sensor.id, !isOn)}
        aria-label={isOn ? 'Turn off' : 'Turn on'}
        style={{
          width: 68,
          height: 36,
          borderRadius: 18,
          background: isOn ? '#4ade80' : '#333333',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.2s',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute',
          top: 4,
          left: isOn ? 36 : 4,
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: '#ffffff',
          transition: 'left 0.18s',
          display: 'block',
        }} />
      </button>

      {/* ? button */}
      <button
        onClick={() => onInfo(sensor)}
        aria-label={`About ${sensor.label}`}
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'none',
          border: '2px solid #444',
          color: '#aaaaaa',
          fontSize: 18,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'inherit',
          lineHeight: 1,
          flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#4ade80'; e.currentTarget.style.color = '#4ade80' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.color = '#aaaaaa' }}
      >
        ?
      </button>
    </div>
  )
}

function CameraCard({ sensor, onInfo }) {
  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      borderRadius: 18,
      padding: '24px 20px 20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      height: '100%',
      boxSizing: 'border-box',
    }}>
      {/* Sensor name */}
      <div style={{
        fontSize: 17,
        fontWeight: 600,
        color: '#ffffff',
        textAlign: 'center',
        lineHeight: 1.4,
      }}>
        {sensor.label}
      </div>

      {/* Camera icon */}
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path d="M23 7l-7 5 7 5V7z" stroke="#888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" stroke="#888" strokeWidth="1.5"/>
      </svg>

      {/* Open app placeholder */}
      <button
        disabled
        style={{
          width: '100%',
          padding: '12px 10px',
          borderRadius: 10,
          background: '#242424',
          border: '1px solid #333',
          color: '#888888',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'not-allowed',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        {sensor.id === 'wyze_camera' ? 'Open Wyze App' : 'Open Camera App'}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="15 3 21 3 21 9" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="10" y1="14" x2="21" y2="3" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      <span style={{ fontSize: 13, color: '#666666', textAlign: 'center', lineHeight: 1.5 }}>
        Managed via the camera app
      </span>

      {/* ? button */}
      <button
        onClick={() => onInfo(sensor)}
        aria-label={`About ${sensor.label}`}
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'none',
          border: '2px solid #444',
          color: '#aaaaaa',
          fontSize: 18,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'inherit',
          lineHeight: 1,
          flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#4ade80'; e.currentTarget.style.color = '#4ade80' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.color = '#aaaaaa' }}
      >
        ?
      </button>
    </div>
  )
}

function SensorInfoModal({ sensor, floorPlan, onClose }) {
  const info = SENSOR_INFO[sensor.id] || {}
  const imgSrc = floorPlan ? `${API}/floorplans/${floorPlan}` : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: 22,
          padding: '32px 28px 28px',
          width: '100%',
          maxWidth: 720,
          maxHeight: '85vh',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* Close button — large touch target */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: '#2a2a2a',
            border: 'none',
            color: '#aaaaaa',
            cursor: 'pointer',
            fontSize: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#ffffff', marginBottom: 24, paddingRight: 44 }}>
          {sensor.label}
        </h2>

        {/* What it does */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            What it does
          </div>
          <p style={{ fontSize: 17, color: '#dddddd', lineHeight: 1.7, margin: 0 }}>
            {info.description || 'This sensor collects data to support the research study.'}
          </p>
        </div>

        {/* Where it is */}
        {info.placement && (
          <div style={{ marginBottom: 26 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Where it is
            </div>
            <p style={{ fontSize: 17, color: '#dddddd', lineHeight: 1.7, margin: 0 }}>
              {info.placement}
            </p>
          </div>
        )}

        {/* Floor plan */}
        {sensor.position && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Location in your home
            </div>
            <div style={{
              position: 'relative',
              background: '#0e0e0e',
              borderRadius: 14,
              overflow: 'hidden',
              border: '1px solid #333',
            }}>
              {imgSrc ? (
                <img src={imgSrc} alt="Floor plan" style={{ width: '100%', display: 'block', opacity: 0.75 }} />
              ) : (
                <svg viewBox="0 0 800 416" style={{ width: '100%', display: 'block' }}>
                  <rect x="40" y="40" width="720" height="336" rx="4" fill="none" stroke="#2a3a2a" strokeWidth="3"/>
                  <line x1="280" y1="40" x2="280" y2="376" stroke="#2a3a2a" strokeWidth="2"/>
                  <line x1="40" y1="220" x2="280" y2="220" stroke="#2a3a2a" strokeWidth="2"/>
                  <text x="158" y="148" fill="#3a5a3a" fontSize="16" textAnchor="middle" fontFamily="system-ui">Bedroom</text>
                  <text x="158" y="310" fill="#3a5a3a" fontSize="16" textAnchor="middle" fontFamily="system-ui">Bathroom</text>
                  <text x="530" y="215" fill="#3a5a3a" fontSize="16" textAnchor="middle" fontFamily="system-ui">Living Room</text>
                </svg>
              )}
              <div style={{
                position: 'absolute',
                left: `${sensor.position.x}%`,
                top: `${sensor.position.y}%`,
                transform: 'translate(-50%, -50%)',
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: '#4ade80',
                boxShadow: '0 0 0 6px rgba(74,222,128,0.3), 0 0 16px rgba(74,222,128,0.5)',
              }} />
            </div>
          </div>
        )}

        {/* Wearable note */}
        {!sensor.position && (
          <div style={{
            background: '#222',
            borderRadius: 12,
            padding: '16px 18px',
          }}>
            <p style={{ fontSize: 16, color: '#aaaaaa', margin: 0, lineHeight: 1.6 }}>
              This is a wearable sensor — it travels with you rather than being fixed in one location.
            </p>
          </div>
        )}

        {/* Close button at bottom for easy reach */}
        <button
          onClick={onClose}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 28,
            padding: '16px',
            fontSize: 17,
            fontWeight: 700,
            background: '#2a2a2a',
            color: '#ffffff',
            border: 'none',
            borderRadius: 14,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Close
        </button>
      </div>
    </div>
  )
}
