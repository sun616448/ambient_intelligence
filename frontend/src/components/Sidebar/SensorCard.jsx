import { format } from 'date-fns';
import { STATUS_COLOR, STATUS_LABEL, CARD_BG } from '../../config/sensorConfig';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";
const FS = A11Y_THEME.fontMin;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;
const TEXT_MUTED = A11Y_THEME.textMuted;

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="3" y="11" width="18" height="11" rx="2" stroke="#555" strokeWidth="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4" stroke="#555" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

export function SensorCard({ sensor, onClick }) {
  const noConsent    = sensor.consented === false;
  const turnedOffAt  = sensor.turnedOffAt ?? null;
  // participantOff: participant actively toggled this sensor off → red offline card + sub-line
  // noConsent only (no turnedOffAt): never consented from enrollment → grey/locked card
  const participantOff = turnedOffAt !== null;
  const dimmed = noConsent && !participantOff;

  const color     = dimmed ? '#555' : (STATUS_COLOR[sensor.status ?? 'offline'] ?? '#888');
  const cardStyle = dimmed ? { background: '#151515', border: '#222' } : (CARD_BG[sensor.status ?? 'offline'] ?? CARD_BG.offline);
  const lastTs    = sensor.lastActive ? format(new Date(sensor.lastActive), 'MMM d HH:mm') : '—';

  return (
    <button
      onClick={() => onClick(sensor)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: cardStyle.background, border: `1px solid ${cardStyle.border}`,
        borderRadius: '8px', padding: '10px 12px', marginBottom: '6px',
        cursor: 'pointer', fontFamily: F, opacity: dimmed ? 0.6 : 1,
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = dimmed ? '0.5' : '0.85'}
      onMouseLeave={e => e.currentTarget.style.opacity = dimmed ? '0.6' : '1'}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: FS, fontWeight: 500, color: dimmed ? TEXT_MUTED : TEXT_PRIMARY, lineHeight: 1.3 }}>{sensor.name}</span>
        {dimmed && <LockIcon />}
      </div>
      <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '6px' }}>{sensor.room}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ fontSize: FS, color, fontWeight: 500 }}>
            {dimmed ? 'No permission' : STATUS_LABEL[sensor.status ?? 'offline']}
          </span>
        </div>
        {!dimmed && !participantOff && <span style={{ fontSize: FS, color: TEXT_MUTED }}>{lastTs}</span>}
      </div>
      {participantOff && (
        <div style={{ fontSize: FS, color: TEXT_MUTED, marginTop: '4px' }}>
          Turned off by participant on {format(new Date(turnedOffAt), 'MMM d, HH:mm')}
        </div>
      )}
      {dimmed && (
        <div style={{ fontSize: FS, color: '#555', marginTop: '4px' }}>No permission</div>
      )}
    </button>
  );
}
