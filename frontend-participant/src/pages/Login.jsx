import { useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function Login({ onLogin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/participant/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      if (!res.ok) {
        setError('Incorrect PIN. Please try again.')
        setPin('')
        return
      }
      const data = await res.json()
      onLogin(data.participant_id)
    } catch {
      setError('Could not connect to the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const ready = pin.length >= 4 && !loading

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: '#111',
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: 24,
        padding: '52px 40px',
        width: '100%',
        maxWidth: 400,
        textAlign: 'center',
      }}>
        <div style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: '#1a2a1a',
          border: '2px solid #4ade80',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 28px',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="9 22 9 12 15 12 15 22"
              stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#ffffff', marginBottom: 10 }}>
          My Home Sensors
        </h1>
        <p style={{ fontSize: 18, color: '#aaaaaa', marginBottom: 40, lineHeight: 1.5 }}>
          Enter your PIN to continue
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="• • • •"
            maxLength={8}
            autoFocus
            style={{
              display: 'block',
              width: '100%',
              padding: '20px',
              fontSize: 32,
              letterSpacing: 14,
              textAlign: 'center',
              background: '#222',
              border: `2px solid ${error ? '#f87171' : '#444'}`,
              borderRadius: 14,
              color: '#ffffff',
              outline: 'none',
              marginBottom: error ? 14 : 24,
              transition: 'border-color 0.2s',
              boxSizing: 'border-box',
            }}
          />

          {error && (
            <p style={{ color: '#ff6b6b', fontSize: 16, marginBottom: 20, fontWeight: 500 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={!ready}
            style={{
              display: 'block',
              width: '100%',
              padding: '18px',
              fontSize: 19,
              fontWeight: 700,
              background: ready ? '#4ade80' : '#2a2a2a',
              color: ready ? '#111111' : '#555',
              border: 'none',
              borderRadius: 14,
              cursor: ready ? 'pointer' : 'default',
              transition: 'background 0.2s, color 0.2s',
              fontFamily: 'inherit',
            }}
          >
            {loading ? 'Verifying…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
