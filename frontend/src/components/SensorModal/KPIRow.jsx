import React from 'react';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const FS = A11Y_THEME.fontMin;
const TEXT_MUTED = A11Y_THEME.textMuted;

function pctColor(value) {
  const n = parseFloat(value);
  return n >= 90 ? '#4ade80' : n >= 70 ? '#fb923c' : '#f87171';
}

function InfoTooltip({ text }) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <svg width="13" height="13" viewBox="0 0 11 11" fill="none" style={{ cursor: 'default', flexShrink: 0 }}>
        <circle cx="5.5" cy="5.5" r="4.5" stroke="#666" strokeWidth="1" />
        <path d="M5.5 5v3" stroke="#666" strokeWidth="1.1" strokeLinecap="round" />
        <circle cx="5.5" cy="3.5" r="0.6" fill="#666" />
      </svg>
      {visible && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
          background: '#1e1e1e', border: '1px solid #444', borderRadius: '6px',
          padding: '8px 12px', fontSize: '14px', color: '#c0c0c0', lineHeight: 1.5,
          width: '220px', pointerEvents: 'none', zIndex: 9999,
          whiteSpace: 'normal',
        }}>
          {text}
        </div>
      )}
    </div>
  );
}

function WifiIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 11" fill="none">
      <path d="M1 4C2.5 2.5 4.6 1.5 7 1.5S11.5 2.5 13 4" stroke="#555" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3 6.5C4 5.5 5.4 5 7 5s3 .5 4 1.5" stroke="#555" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5 9C5.5 8.5 6.2 8.2 7 8.2s1.5.3 2 .8" stroke="#555" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="7" cy="10.5" r="0.9" fill="#555" />
    </svg>
  );
}

function DataIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="8" width="3" height="5" rx="1" fill="#888" />
      <rect x="5.5" y="5" width="3" height="8" rx="1" fill="#888" />
      <rect x="10" y="2" width="3" height="11" rx="1" fill="#888" />
    </svg>
  );
}

export function KPIRow({ report }) {
  if (!report) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        {[
          { label: 'Connection Uptime',  icon: <WifiIcon />, tooltip: 'Was the sensor reachable over the network? Measures whether the device was online, regardless of whether data actually arrived.' },
          { label: 'Data Completeness',  icon: <DataIcon />, tooltip: 'Did expected readings actually arrive? A sensor can be fully online yet still miss data — this is the primary failure mode to watch.' },
          { label: 'Gap Count' },
          { label: 'Longest Gap' },
        ].map(({ label, icon, tooltip }) => (
          <div key={label} style={{ background: '#1e1e1e', border: '1px solid #252525', borderRadius: '8px', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
              {icon}
              <span style={{ fontSize: FS, color: TEXT_MUTED }}>{label}</span>
              {tooltip && <InfoTooltip text={tooltip} />}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: TEXT_MUTED }}>—</div>
          </div>
        ))}
      </div>
    );
  }

  const longestMin = report.longest_gap_sec > 0
    ? report.longest_gap_sec >= 3600
      ? `${(report.longest_gap_sec / 3600).toFixed(1)} hr`
      : report.longest_gap_sec >= 60
      ? `${Math.round(report.longest_gap_sec / 60)} min`
      : `${Math.round(report.longest_gap_sec)} s`
    : '0 s';

  const uptimeVal      = report.connection_uptime_pct?.toFixed(1) ?? null;
  const completenessVal = report.data_completeness_pct?.toFixed(1) ?? null;
  const uptimeColor     = uptimeVal      ? pctColor(uptimeVal)      : TEXT_MUTED;
  const completenessColor = completenessVal ? pctColor(completenessVal) : TEXT_MUTED;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>

      {/* Connection Uptime */}
      <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '8px', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
          <WifiIcon />
          <span style={{ fontSize: FS, color: TEXT_MUTED }}>Connection Uptime</span>
          <InfoTooltip text="Was the sensor reachable over the network? Measures whether the device was online, regardless of whether data actually arrived." />
        </div>
        <div style={{ fontSize: '20px', fontWeight: 600, color: uptimeColor, marginBottom: '3px' }}>
          {uptimeVal != null ? `${uptimeVal}%` : '—'}
        </div>
        <div style={{ fontSize: FS, color: '#3e3e3e' }}>network reachability</div>
      </div>

      {/* Data Completeness */}
      <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '8px', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
          <DataIcon />
          <span style={{ fontSize: FS, color: TEXT_MUTED }}>Data Completeness</span>
          <InfoTooltip text="Did expected readings actually arrive? A sensor can be fully online yet still miss data — this is the primary failure mode to watch." />
        </div>
        <div style={{ fontSize: '20px', fontWeight: 600, color: completenessColor, marginBottom: '3px' }}>
          {completenessVal != null ? `${completenessVal}%` : '—'}
        </div>
        <div style={{ fontSize: FS, color: '#3e3e3e' }}>readings received</div>
      </div>

      {/* Gap Count */}
      <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '8px', padding: '12px 14px' }}>
        <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '6px' }}>Gap Count</div>
        <div style={{ fontSize: '20px', fontWeight: 600, color: '#e5e5e5', marginBottom: '3px' }}>{report.gap_count ?? '—'}</div>
        <div style={{ fontSize: FS, color: '#3e3e3e' }}>distinct interruptions</div>
      </div>

      {/* Longest Gap */}
      <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '8px', padding: '12px 14px' }}>
        <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '6px' }}>Longest Gap</div>
        <div style={{ fontSize: '20px', fontWeight: 600, color: '#e5e5e5', marginBottom: '3px' }}>{longestMin}</div>
        <div style={{ fontSize: FS, color: '#3e3e3e' }}>continuous absence</div>
      </div>

    </div>
  );
}
