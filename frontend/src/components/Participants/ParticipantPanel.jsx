import { useState } from 'react';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";
const FS = A11Y_THEME.fontMin;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;
const TEXT_MUTED = A11Y_THEME.textMuted;
const TEXT_SOFT = A11Y_THEME.textSoft;

const CONSENT_COLOR = { full: '#4ade80', partial: '#facc15', withdrawn: '#f87171' };
const CONSENT_LABEL = { full: 'Full Consent', partial: 'Partial', withdrawn: 'Withdrawn' };


function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M5.5 1v9M1 5.5h9" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ParticipantPanel({ participants, selectedId, onSelect, onEnroll, onViewDetails, bumpSummary = {} }) {
  const [hoveredId, setHoveredId] = useState(null);

  return (
    <div style={{
      width: '200px', flexShrink: 0,
      background: '#111', borderRight: '1px solid #222',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: F,
    }}>
      {/* Header */}
      <div style={{ padding: '18px 14px', borderBottom: '1px solid #222', flexShrink: 0 }}>
        <span style={{ fontSize: '15px', fontWeight: 600, color: TEXT_PRIMARY }}>Participants</span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {/* All Participants row */}
        <button
          onClick={() => onSelect(null)}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '9px 10px', borderRadius: '7px', marginBottom: '4px',
            border: selectedId === null ? '1px solid #333' : '1px solid transparent',
            background: selectedId === null ? '#1e1e1e' : 'transparent',
            cursor: 'pointer', color: selectedId === null ? TEXT_PRIMARY : TEXT_MUTED,
            fontSize: FS, fontWeight: 500, fontFamily: F,
          }}
          onMouseEnter={e => { if (selectedId !== null) e.currentTarget.style.background = '#181818'; }}
          onMouseLeave={e => { if (selectedId !== null) e.currentTarget.style.background = 'transparent'; }}
        >
          All Participants
        </button>

        {participants.map(p => {
          const isSelected  = selectedId === p.id;
          const isHovered   = hoveredId  === p.id;
          const statusColor = CONSENT_COLOR[p.consentStatus] ?? '#888';
          const bumpTotal   = bumpSummary[p.id]?.total ?? 0;

          return (
            <div
              key={p.id}
              style={{ position: 'relative', marginBottom: '4px' }}
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div
                style={{
                  borderRadius: '7px',
                  border: isSelected ? '1px solid #2a2a2a' : '1px solid transparent',
                  background: isHovered && !isSelected ? '#181818' : isSelected ? '#1a1a1a' : 'transparent',
                  overflow: 'hidden',
                }}
              >
                {/* Clickable top section */}
                <div
                  onClick={() => onSelect(p.id)}
                  title={p.fullName}
                  style={{
                    display: 'flex', width: '100%', textAlign: 'left',
                    padding: '10px 10px 8px 12px',
                    cursor: 'pointer', alignItems: 'flex-start', gap: '8px',
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Avatar */}
                  <div style={{
                    width: '30px', height: '30px', borderRadius: '50%',
                    background: isSelected ? '#2a2a2a' : '#1e1e1e',
                    border: '1px solid #2a2a2a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: FS, fontWeight: 600, color: TEXT_SOFT, flexShrink: 0,
                  }}>
                    {p.id.slice(-2)}
                  </div>

                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: FS, fontWeight: 500, color: TEXT_PRIMARY, marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isHovered ? p.fullName : p.id}
                    </div>
                    <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '5px' }}>Age {p.age}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: bumpTotal > 0 ? '4px' : 0 }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                      <span style={{ fontSize: FS, color: statusColor }}>{CONSENT_LABEL[p.consentStatus]}</span>
                    </div>
                    {bumpTotal > 0 && (
                      <button
                        onClick={e => { e.stopPropagation(); onViewDetails(p); }}
                        style={{
                          marginTop: '6px', width: '100%', textAlign: 'left',
                          padding: '6px 10px', background: '#160e00',
                          border: '1px solid #2a1800', borderRadius: '6px',
                          cursor: 'pointer', fontFamily: F,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#4a3000'; e.currentTarget.style.background = '#1e1400'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a1800'; e.currentTarget.style.background = '#160e00'; }}
                      >
                        <span style={{ fontSize: '14px', color: '#fb923c', fontWeight: 600 }}>
                          {bumpTotal} reminder{bumpTotal !== 1 ? 's' : ''}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* More Details button — always visible */}
                <div style={{ padding: '0 10px 9px 10px' }}>
                  <button
                    onClick={e => { e.stopPropagation(); onViewDetails(p); }}
                    style={{
                      width: '100%', padding: '4px 0',
                      background: 'transparent', border: '1px solid #2a2a2a',
                      borderRadius: '5px', cursor: 'pointer',
                      fontSize: FS, color: TEXT_MUTED, fontFamily: F,
                      transition: 'color 0.12s, border-color 0.12s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = TEXT_PRIMARY; e.currentTarget.style.borderColor = '#3a3a3a'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = TEXT_MUTED; e.currentTarget.style.borderColor = '#2a2a2a'; }}
                  >
                    More Details
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Enroll New button */}
      <div style={{ padding: '10px 8px', borderTop: '1px solid #1a1a1a', flexShrink: 0 }}>
        <button
          onClick={onEnroll}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            width: '100%', background: 'transparent', border: '1px solid #1e3a1e',
            borderRadius: '7px', color: '#4ade80', fontSize: '14px', fontWeight: 500,
            padding: '9px 0', cursor: 'pointer', fontFamily: F,
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#1a3a1a'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <PlusIcon />
          Enroll New
        </button>
      </div>
    </div>
  );
}
