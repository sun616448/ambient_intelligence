import SensorDot from './SensorDot.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function FloorPlan({ sensors, floorPlan, onSensorClick }) {
  const imgSrc = floorPlan ? `${API}/floorplans/${floorPlan}` : null

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      background: '#161616',
      border: '1px solid #2a2a2a',
      borderRadius: 16,
      overflow: 'hidden',
    }}>
      {imgSrc ? (
        /*
         * Inner div sizes to the image's rendered dimensions exactly.
         * display:inline-block + height:100% → width collapses to image's natural width
         * at the given height, keeping dots percentages aligned to the image.
         */
        <div style={{ position: 'relative', height: '100%', display: 'inline-block', lineHeight: 0 }}>
          <img
            src={imgSrc}
            alt="Your home floor plan"
            style={{ height: '100%', width: 'auto', display: 'block', opacity: 0.85 }}
          />
          {sensors.map(s => (
            <SensorDot key={s.id} sensor={s} onClick={onSensorClick} />
          ))}
        </div>
      ) : (
        /* Placeholder outline when no floor plan image has been uploaded yet */
        <div style={{ position: 'relative', height: '100%', display: 'inline-block', lineHeight: 0 }}>
          <svg
            viewBox="0 0 800 416"
            style={{ height: '100%', width: 'auto', display: 'block' }}
          >
            <rect x="40" y="40" width="720" height="336" rx="4"
              fill="none" stroke="#2a3a2a" strokeWidth="3"/>
            <line x1="280" y1="40" x2="280" y2="376" stroke="#2a3a2a" strokeWidth="2"/>
            <line x1="40" y1="220" x2="280" y2="220" stroke="#2a3a2a" strokeWidth="2"/>
            <text x="158" y="148" fill="#3a4a3a" fontSize="13" textAnchor="middle" fontFamily="system-ui">Bedroom</text>
            <text x="158" y="310" fill="#3a4a3a" fontSize="13" textAnchor="middle" fontFamily="system-ui">Bathroom</text>
            <text x="530" y="215" fill="#3a4a3a" fontSize="13" textAnchor="middle" fontFamily="system-ui">Living Room</text>
          </svg>
          {sensors.map(s => (
            <SensorDot key={s.id} sensor={s} onClick={onSensorClick} />
          ))}
        </div>
      )}
    </div>
  )
}
