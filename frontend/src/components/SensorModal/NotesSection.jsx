import { useState } from 'react';
import { format } from 'date-fns';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const CATEGORY_COLOR = {
  Placement:                '#60a5fa',
  Hardware:                 '#fb923c',
  'Participant Interaction': '#a78bfa',
  Resolved:                 '#4ade80',
};

const CATEGORIES = ['Placement', 'Hardware', 'Participant Interaction', 'Resolved'];

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";
const FS = A11Y_THEME.fontMin;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;
const TEXT_MUTED = A11Y_THEME.textMuted;

export function NotesSection({ sensorId }) {
  const [notes, setNotes] = useState([]);
  const [category, setCategory] = useState('Placement');
  const [text, setText] = useState('');

  const addNote = () => {
    if (!text.trim()) return;
    setNotes(prev => [...prev, {
      id: `N${Date.now()}`,
      timestamp: new Date().toISOString(),
      researcher: 'Current Researcher',
      category,
      text: text.trim(),
    }]);
    setText('');
  };

  return (
    <div>
      <div style={{ fontSize: FS, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: '12px' }}>Researcher Notes</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
        {notes.length === 0 && (
          <div style={{ fontSize: FS, color: TEXT_MUTED, padding: '8px 0' }}>No notes recorded for this sensor.</div>
        )}
        {notes.map(note => {
          const catColor = CATEGORY_COLOR[note.category] ?? '#888';
          return (
            <div key={note.id} style={{ background: '#1a1a1a', border: '1px solid #252525', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: catColor, background: `${catColor}18`, border: `1px solid ${catColor}40`, borderRadius: '4px', padding: '2px 7px' }}>
                  {note.category}
                </span>
                <span style={{ fontSize: FS, color: TEXT_MUTED }}>
                  {format(new Date(note.timestamp), 'MMM d, yyyy HH:mm')}
                </span>
              </div>
              <div style={{ fontSize: FS, color: TEXT_PRIMARY, lineHeight: 1.5, marginBottom: '6px' }}>{note.text}</div>
              <div style={{ fontSize: FS, color: TEXT_MUTED }}>{note.researcher}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#1a1a1a', border: '1px solid #252525', borderRadius: '8px', padding: '8px 10px' }}>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '5px', color: TEXT_MUTED, fontSize: FS, padding: '4px 6px', cursor: 'pointer', flexShrink: 0, fontFamily: F }}
        >
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addNote()}
          placeholder="Add a note…"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: TEXT_PRIMARY, fontSize: FS, minWidth: 0, fontFamily: F }}
        />
        <button
          onClick={addNote}
          style={{ background: '#1e2e1e', border: '1px solid #2a3e2a', borderRadius: '5px', color: '#4ade80', fontSize: FS, fontWeight: 500, padding: '4px 12px', cursor: 'pointer', flexShrink: 0, fontFamily: F }}
          onMouseEnter={e => e.currentTarget.style.background = '#253525'}
          onMouseLeave={e => e.currentTarget.style.background = '#1e2e1e'}
        >
          Add
        </button>
      </div>
    </div>
  );
}
