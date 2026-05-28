import { useState } from 'react'

const REASON_LABEL = {
  survey_incomplete: 'Survey Reminder',
  sensor_off: 'Sensor Reminder',
  custom: 'Message',
};

const REASON_DEFAULTS = {
  survey_incomplete: 'Your research team would like you to complete the daily survey.',
  sensor_off: 'Your research team would like you to re-enable one or more sensors.',
  custom: '',
};

const FONT = 'system-ui, -apple-system, sans-serif';

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

function DismissBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: '2px solid #4a3010', borderRadius: '8px',
        color: '#b07840', cursor: 'pointer', fontSize: '15px', fontWeight: 600,
        padding: '6px 14px', whiteSpace: 'nowrap', flexShrink: 0,
        fontFamily: FONT,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#7a5020'; e.currentTarget.style.color = '#fb923c'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#4a3010'; e.currentTarget.style.color = '#b07840'; }}
    >
      Dismiss
    </button>
  );
}

const BellIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" style={{ flexShrink: 0 }}>
    <path d="M11 2a8 8 0 00-8 8c0 3.5-1.5 5-1.5 5h19S19 13.5 19 10a8 8 0 00-8-8zm0 18a2 2 0 002-2H9a2 2 0 002 2z"
      stroke="#fb923c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

export default function BumpNotification({ bumps, onDismiss }) {
  const [expanded, setExpanded] = useState(false);

  if (!bumps || bumps.length === 0) return null;

  const latest = bumps[0];
  const extra = bumps.length - 1;
  const latestMsg = latest.note || REASON_DEFAULTS[latest.reason] || 'You have a message from your research team.';

  // ── Expanded: all messages ───────────────────────────────────────────────
  if (expanded) {
    return (
      <div style={{
        margin: '12px 28px 0',
        background: '#1a1200', border: '2px solid #3a2800', borderRadius: '12px',
        overflow: 'hidden', fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid #2a1800' }}>
          <BellIcon />
          <span style={{ flex: 1, fontSize: '18px', fontWeight: 700, color: '#fb923c' }}>
            Messages from your research team ({bumps.length})
          </span>
          <button
            onClick={() => setExpanded(false)}
            style={{ background: 'none', border: 'none', color: '#9a6030', cursor: 'pointer', fontSize: '15px', fontFamily: FONT, padding: '0 4px', fontWeight: 500 }}
            onMouseEnter={e => e.currentTarget.style.color = '#fb923c'}
            onMouseLeave={e => e.currentTarget.style.color = '#9a6030'}
          >
            Show less ▲
          </button>
        </div>

        {bumps.map((b, i) => {
          const msg = b.note || REASON_DEFAULTS[b.reason] || 'Message from your research team.';
          return (
            <div
              key={b.id}
              style={{
                display: 'flex', gap: '14px', alignItems: 'flex-start',
                padding: '14px 18px',
                borderBottom: i < bumps.length - 1 ? '1px solid #2a1800' : 'none',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', color: '#9a7040', marginBottom: '6px' }}>
                  {REASON_LABEL[b.reason] ?? 'Message'} · {fmtDate(b.timestamp)}
                </div>
                <div style={{ fontSize: '16px', color: '#e8c080', lineHeight: 1.6 }}>{msg}</div>
              </div>
              <DismissBtn onClick={() => onDismiss(b.id)} />
            </div>
          );
        })}
      </div>
    );
  }

  // ── Collapsed: latest + "see all" link ───────────────────────────────────
  return (
    <div style={{
      margin: '12px 28px 0', padding: '14px 18px',
      background: '#1a1200', border: '2px solid #3a2800', borderRadius: '12px',
      display: 'flex', alignItems: 'flex-start', gap: '14px',
      fontFamily: FONT,
    }}>
      <BellIcon />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#fb923c', marginBottom: '6px' }}>
          Message from your research team
        </div>
        <div style={{ fontSize: '16px', color: '#e8c080', lineHeight: 1.6 }}>{latestMsg}</div>
        {extra > 0 && (
          <button
            onClick={() => setExpanded(true)}
            style={{
              marginTop: '8px', background: 'none', border: 'none', padding: 0,
              color: '#9a7040', cursor: 'pointer', fontSize: '15px',
              fontFamily: FONT, textDecoration: 'underline', fontWeight: 500,
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fb923c'}
            onMouseLeave={e => e.currentTarget.style.color = '#9a7040'}
          >
            +{extra} more message{extra !== 1 ? 's' : ''} — see all
          </button>
        )}
      </div>
      <DismissBtn onClick={() => onDismiss(latest.id)} />
    </div>
  );
}
