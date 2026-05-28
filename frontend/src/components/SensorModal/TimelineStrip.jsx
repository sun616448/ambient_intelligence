import { A11Y_THEME } from '../../styles/accessibilityTheme';

const FS = A11Y_THEME.fontMin;
const TEXT_MUTED = A11Y_THEME.textMuted;

const STATE_COLOR = {
  collecting:  '#4ade80',
  gap:         '#fb923c',
  not_wearing: '#fb923c',
  offline:     '#f87171',
};

const LEGEND = [
  { label: 'Collecting',   color: '#4ade80' },
  { label: 'Gap',          color: '#fb923c' },
  { label: 'Offline',      color: '#f87171' },
];

export function TimelineStrip({ timeline }) {
  if (!timeline || timeline.length === 0) {
    return (
      <div style={{ height: '28px', background: '#1a1a1a', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: FS, color: TEXT_MUTED }}>No timeline data</span>
      </div>
    );
  }

  const winStart = new Date(timeline[0].start).getTime();
  const winEnd   = new Date(timeline[timeline.length - 1].end).getTime();
  const total    = winEnd - winStart || 1;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginBottom: '8px' }}>
        {LEGEND.map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '8px', height: '8px', background: color, borderRadius: '2px', flexShrink: 0 }} />
            <span style={{ fontSize: FS, color: TEXT_MUTED }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', height: '28px', borderRadius: '6px', overflow: 'hidden', gap: '1px' }}>
        {timeline.map((seg, i) => {
          const segStart = new Date(seg.start).getTime();
          const segEnd   = new Date(seg.end).getTime();
          const width    = ((segEnd - segStart) / total) * 100;
          const color    = STATE_COLOR[seg.state] ?? '#333';
          return (
            <div
              key={i}
              title={`${seg.state} · ${seg.start} → ${seg.end}`}
              style={{ flex: `0 0 ${width}%`, background: color, opacity: seg.state === 'collecting' ? 0.85 : 1 }}
            />
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
        <span style={{ fontSize: FS, color: TEXT_MUTED }}>
          {new Date(timeline[0].start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span style={{ fontSize: FS, color: TEXT_MUTED }}>
          {new Date(timeline[timeline.length - 1].end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
