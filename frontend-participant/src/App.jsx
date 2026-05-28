import { useState } from 'react'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'

export default function App() {
  const [participantId, setParticipantId] = useState(
    () => localStorage.getItem('participantId') || null
  )

  function handleLogin(id) {
    localStorage.setItem('participantId', id)
    setParticipantId(id)
  }

  function handleLogout() {
    localStorage.removeItem('participantId')
    setParticipantId(null)
  }

  if (!participantId) return <Login onLogin={handleLogin} />
  return <Dashboard participantId={participantId} onLogout={handleLogout} />
}
