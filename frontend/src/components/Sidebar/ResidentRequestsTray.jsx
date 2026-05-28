import { useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const FS = A11Y_THEME.fontMin;
const TEXT_MUTED = A11Y_THEME.textMuted;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;

function SpeechBubbleIcon() {
  return (
    <svg width="14" height="13" viewBox="0 0 14 13" fill="none">
      <rect x="0.75" y="0.75" width="12.5" height="8.5" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 9.25 L3.5 12 L6.5 9.25" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function RequestDetailModal({ req, onClose }) {
  const fmtDate = (val) => {
    if (!val) return '—';
    try { return format(new Date(val), 'MMM d, yyyy h:mm a'); } catch { return val; }
  };

  const fields = [
    { label: 'Submitted', value: fmtDate(req.dateSubmitted) },
    { label: 'Name', value: req.participantId },
    { label: 'Status', value: req.status || 'Pending' },
    { label: 'Request type', value: req.requestType },
    { label: 'Device', value: req.sensorName },
    { label: 'Description', value: req.description },
    { label: 'Contact method', value: req.contactMethod },
    { label: 'Best time to contact', value: req.contactTime },
  ].filter(f => f.value);

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '10px', width: '420px', maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #222' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: TEXT_PRIMARY }}>Request {req.id}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '2px 4px' }}
          >×</button>
        </div>

        {/* Fields */}
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {fields.map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '3px' }}>{label}</div>
              <div style={{ fontSize: FS, color: TEXT_PRIMARY, lineHeight: 1.5, wordBreak: 'break-word' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ResidentRequestsTray({ requests }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const pending = requests.filter(r => r.status !== 'Resolved');

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid #222' }}>
      {open && (
        <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
          {pending.length === 0 ? (
            <div style={{ padding: '16px', fontSize: FS, color: TEXT_MUTED, textAlign: 'center' }}>No pending requests</div>
          ) : (
            pending.map(req => (
              <div
                key={req.id}
                onClick={() => setSelected(req)}
                style={{ padding: '10px 14px', borderBottom: '1px solid #1e1e1e', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#181818'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ fontSize: FS, color: '#f87171', marginBottom: '3px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{[req.participantId, req.sensorName].filter(Boolean).join(' · ')}</span>
                  <span>{req.dateSubmitted ? format(new Date(req.dateSubmitted), 'MMM d') : '—'}</span>
                </div>
                <div style={{ fontSize: FS, color: TEXT_PRIMARY, lineHeight: 1.4, marginBottom: '4px' }}>{req.description}</div>
                <span style={{ fontSize: FS, color: '#fb923c', background: '#1a1508', border: '1px solid #3a2a10', borderRadius: '4px', padding: '1px 6px' }}>
                  {req.status}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', background: 'transparent', cursor: 'pointer', color: TEXT_PRIMARY }}
        onMouseEnter={e => e.currentTarget.style.background = '#181818'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <SpeechBubbleIcon />
        <span style={{ fontSize: FS, fontWeight: 500, flex: 1, textAlign: 'left' }}>Resident Requests</span>
        {pending.length > 0 && (
          <span style={{ background: '#ef4444', color: '#fff', fontSize: FS, fontWeight: 700, borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {pending.length}
          </span>
        )}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0 }}>
          <path d="M2 4 L6 8 L10 4" stroke={TEXT_MUTED} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {selected && <RequestDetailModal req={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
