import { useState, useEffect } from 'react'
import SensorPanel from '../components/SensorPanel.jsx'
import BumpNotification from '../components/BumpNotification.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function Dashboard({ participantId, onLogout }) {
  const [sensors, setSensors] = useState([])
  const [floorPlan, setFloorPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [unreadBumps, setUnreadBumps] = useState([])

  // All bumps seen this session — survives individual dismissals
  const [sessionBumps, setSessionBumps] = useState([])
  // IDs the participant has dismissed (locally hidden, already read on server)
  const [localDismissedIds, setLocalDismissedIds] = useState(new Set())
  // True once any reminder has ever arrived this session
  const [hasHadBumps, setHasHadBumps] = useState(false)

  useEffect(() => {
    fetch(`${API}/api/participant/${participantId}/sensors`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => {
        setSensors(data.sensors || [])
        setFloorPlan(data.floor_plan || null)
        setLoading(false)
      })
      .catch(() => {
        setError('Could not load sensor data. Please refresh.')
        setLoading(false)
      })
  }, [participantId])

  useEffect(() => {
    const fetchBumps = () =>
      fetch(`${API}/api/participant/${participantId}/bumps`)
        .then(r => r.ok ? r.json() : [])
        .then(all => setUnreadBumps(all.filter(b => !b.read)))
        .catch(() => {})
    fetchBumps()
    const interval = setInterval(fetchBumps, 30 * 1000)
    return () => clearInterval(interval)
  }, [participantId])

  // Accumulate new bumps into sessionBumps so they persist after dismiss
  useEffect(() => {
    if (unreadBumps.length === 0) return
    setHasHadBumps(true)
    setSessionBumps(prev => {
      const existingIds = new Set(prev.map(b => b.id))
      const added = unreadBumps.filter(b => !existingIds.has(b.id))
      return added.length > 0 ? [...prev, ...added] : prev
    })
  }, [unreadBumps])

  function handleDismissBump(bumpId) {
    fetch(`${API}/api/participant/${participantId}/bumps/${bumpId}/read`, { method: 'PATCH' })
      .catch(() => {})
    setUnreadBumps(prev => prev.filter(b => b.id !== bumpId))
    setLocalDismissedIds(prev => new Set([...prev, bumpId]))
  }

  // "See reminders" button: clear local dismissals so all session bumps reappear
  function handleSeeReminders() {
    setLocalDismissedIds(new Set())
  }

  const visibleBumps = sessionBumps.filter(b => !localDismissedIds.has(b.id))

  function handleToggle(sensorId, newConsented) {
    setSensors(prev => prev.map(s => s.id === sensorId ? { ...s, consented: newConsented } : s))
    fetch(`${API}/api/participant/${participantId}/sensors/${sensorId}/consent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consented: newConsented }),
    }).catch(() => {})
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: '#111',
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Header */}
      <header style={{
        background: '#1a1a1a',
        borderBottom: '1px solid #2a2a2a',
        padding: '0 28px',
        height: 68,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#ffffff' }}>My Home Sensors</span>

          {/* Persistent reminder button — always visible once any reminder has arrived */}
          {hasHadBumps && (
            <button
              onClick={handleSeeReminders}
              style={{
                background: '#ea6c00',
                border: 'none',
                borderRadius: 8,
                color: '#ffffff',
                padding: '8px 18px',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: '0.01em',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#fb923c'}
              onMouseLeave={e => e.currentTarget.style.background = '#ea6c00'}
            >
              See reminders
            </button>
          )}
        </div>

        <button
          onClick={onLogout}
          style={{
            background: 'none',
            border: '2px solid #444',
            color: '#cccccc',
            padding: '10px 20px',
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 16,
            fontWeight: 600,
            fontFamily: 'inherit',
          }}
        >
          Sign out
        </button>
      </header>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <p style={{ color: '#aaaaaa', textAlign: 'center', marginTop: 80, fontSize: 18 }}>
            Loading your sensors…
          </p>
        )}
        {error && (
          <p style={{ color: '#ff6b6b', textAlign: 'center', marginTop: 80, fontSize: 18 }}>{error}</p>
        )}

        {!loading && !error && (
          <>
            <BumpNotification bumps={visibleBumps} onDismiss={handleDismissBump} />

            <div style={{ padding: '24px 28px 8px', flexShrink: 0 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#ffffff', marginBottom: 6 }}>
                Your Sensors
              </h2>
              <p style={{ color: '#aaaaaa', fontSize: 16, lineHeight: 1.5 }}>
                Use the toggles to turn sensors on or off. Tap <strong style={{ color: '#ffffff' }}>?</strong> to learn more about any sensor.
              </p>
            </div>

            <SensorPanel
              sensors={sensors}
              floorPlan={floorPlan}
              onToggle={handleToggle}
            />
          </>
        )}
      </div>
    </div>
  )
}
