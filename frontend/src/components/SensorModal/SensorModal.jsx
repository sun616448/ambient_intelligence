import { useState } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { format } from 'date-fns';
import { TimelineStrip } from './TimelineStrip';
import { KPIRow } from './KPIRow';
import { NotesSection } from './NotesSection';
import { STATUS_COLOR } from '../../config/sensorConfig';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";
const FS = A11Y_THEME.fontMin;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;
const TEXT_MUTED = A11Y_THEME.textMuted;

// ── Icons ──────────────────────────────────────────────────────────────────

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
function CursorIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M1 1l4 9 1.5-3.5L10 5 1 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
function KeyboardIcon() {
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
      <rect x="0.5" y="0.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2 3.5h1M4.5 3.5h1M7 3.5h1M9.5 3.5h1M2 6h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function badge(color, label) {
  return (
    <span style={{
      fontSize: FS, fontWeight: 500, color,
      background: `${color}18`, border: `1px solid ${color}44`,
      borderRadius: '999px', padding: '2px 9px',
      display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.[0]?.value == null) return null;
  const val = payload[0]?.value;
  if (val == null) return null;
  return (
    <div style={{ background: '#1e1e1e', border: '1px solid #333', borderRadius: '5px', padding: '5px 9px', fontSize: FS, color: TEXT_PRIMARY }}>
      {typeof val === 'number' ? val.toFixed(1) : val}
    </div>
  );
}

const inp = (extra = {}) => ({
  background: '#1e1e1e', border: '1px solid #333', borderRadius: '6px',
  color: TEXT_PRIMARY, fontSize: FS, padding: '6px 9px',
  outline: 'none', fontFamily: F, transition: 'border-color 0.15s',
  ...extra,
});

// ── Component ──────────────────────────────────────────────────────────────

export function SensorModal({
  sensor, sensorData, onClose,
  editLocation, onEditStart, onEditChange, onEditSave, onEditCancel,
}) {
  const [showRaw, setShowRaw] = useState(false);

  const report   = sensorData?.report;
  const readings = sensorData?.readings ?? [];
  const timeline = sensorData?.timeline ?? [];
  const rawRows  = sensorData?.rawRows ?? [];

  const statusColor = STATUS_COLOR[sensor.status] ?? '#888';
  const statusLabel = sensor.status === 'online' ? 'Collecting'
    : sensor.status === 'gap' ? 'Data Gap' : 'Offline';
  const liveColor = report?.live ? '#4ade80' : '#f87171';
  const liveLabel = report?.live ? 'Live' : 'Offline';
  const lastTs = report?.latest_timestamp
    ? format(new Date(report.latest_timestamp), 'MMM d, yyyy HH:mm') : null;
  const chartData = readings.map(r => ({ ts: r.timestamp, value: r.value }));
  const noData = !sensorData;

  const isEditing = !!editLocation;

  const handleToggleMode = () => {
    if (!editLocation) return;
    if (editLocation.mode === 'type') {
      onEditChange({ mode: 'click', minimized: true });
    } else {
      onEditChange({ mode: 'type', minimized: false });
    }
  };

  const handleClose = () => {
    if (isEditing) onEditCancel();
    onClose();
  };

  // ── Minimized bottom bar (click-to-place mode) ─────────────────────
  if (editLocation?.minimized) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 50, pointerEvents: 'none',
      }}>
        <div
          style={{
            width: '100%',
            background: '#161616', border: '1px solid #2a2a2a',
            borderTop: '2px solid #4ade80',
            display: 'flex', alignItems: 'center', padding: '0 40px', gap: '20px',
            pointerEvents: 'auto', fontFamily: F, minHeight: '88px',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%',
            background: '#4ade80', flexShrink: 0,
            animation: 'sensorPulse 1s ease-in-out infinite',
          }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#e5e5e5' }}>
              {sensor.name}
            </span>
            <span style={{ fontSize: FS, color: TEXT_MUTED }}>
              Click anywhere on the floor plan to place the sensor dot
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={onEditSave}
            style={{
              background: '#4ade80', border: 'none', borderRadius: '10px',
              color: '#000', fontSize: '15px', fontWeight: 700, padding: '13px 28px',
              cursor: 'pointer', fontFamily: F, flexShrink: 0, transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            Confirm Location
          </button>
          <button
            onClick={() => { onEditCancel(); onClose(); }}
            style={{
              background: 'none', border: '1px solid #333', borderRadius: '8px',
              color: TEXT_MUTED, fontSize: FS, padding: '12px 20px',
              cursor: 'pointer', fontFamily: F, transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = TEXT_PRIMARY; e.currentTarget.style.borderColor = '#555'; }}
            onMouseLeave={e => { e.currentTarget.style.color = TEXT_MUTED; e.currentTarget.style.borderColor = '#333'; }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Full modal ─────────────────────────────────────────────────────
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.76)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '24px' }}
      onClick={isEditing ? undefined : onClose}
    >
      <div
        style={{ width: '820px', maxHeight: '88vh', background: '#161616', border: '1px solid #2a2a2a', borderRadius: '14px', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: F }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', paddingBottom: isEditing ? '16px' : '18px', borderBottom: '1px solid #232323', flexShrink: 0 }}>
          {/* Row 1: name + badges + close */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#e5e5e5' }}>{sensor.name}</span>
              {report && badge(liveColor, liveLabel)}
              {badge(statusColor, statusLabel)}
            </div>
            <button onClick={handleClose} style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', padding: '4px', borderRadius: '4px', lineHeight: 1, transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = TEXT_PRIMARY}
              onMouseLeave={e => e.currentTarget.style.color = TEXT_MUTED}
            >
              <XIcon />
            </button>
          </div>

          {/* Row 2: room + edit UI */}
          {!isEditing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: FS, color: TEXT_MUTED }}>{sensor.room}</span>
              <button
                onClick={onEditStart}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: '#ffffff', border: 'none', borderRadius: '6px',
                  color: '#111', fontSize: FS, fontWeight: 600, padding: '4px 10px',
                  cursor: 'pointer', fontFamily: F, transition: 'opacity 0.15s', lineHeight: 1,
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <PencilIcon /> Edit Location
              </button>
              {lastTs && <>
                <span style={{ fontSize: FS, color: TEXT_MUTED }}>·</span>
                <span style={{ fontSize: FS, color: TEXT_MUTED }}>Last data {lastTs}</span>
              </>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Inputs row */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Room</span>
                  <input
                    value={editLocation.room}
                    onChange={e => onEditChange({ room: e.target.value })}
                    style={inp({ width: '160px' })}
                    onFocus={e  => e.currentTarget.style.borderColor = '#4ade80'}
                    onBlur={e   => e.currentTarget.style.borderColor = '#333'}
                    autoFocus
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Left %</span>
                  <input
                    type="number" min={0} max={100}
                    value={editLocation.xStr}
                    onChange={e => onEditChange({ xStr: e.target.value })}
                    style={inp({ width: '76px' })}
                    onFocus={e  => e.currentTarget.style.borderColor = '#4ade80'}
                    onBlur={e   => e.currentTarget.style.borderColor = '#333'}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Top %</span>
                  <input
                    type="number" min={0} max={100}
                    value={editLocation.yStr}
                    onChange={e => onEditChange({ yStr: e.target.value })}
                    style={inp({ width: '76px' })}
                    onFocus={e  => e.currentTarget.style.borderColor = '#4ade80'}
                    onBlur={e   => e.currentTarget.style.borderColor = '#333'}
                  />
                </div>
                <span style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '8px', whiteSpace: 'nowrap' }}>
                  0–100, from top-left
                </span>
                <button
                  onClick={handleToggleMode}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '1px',
                    background: editLocation.mode === 'click' ? '#0d2b0d' : '#1e1e1e',
                    border: `1px solid ${editLocation.mode === 'click' ? '#1e4d1e' : '#2e2e2e'}`,
                    borderRadius: '6px',
                    color: editLocation.mode === 'click' ? '#4ade80' : '#888',
                    fontSize: FS, padding: '6px 12px', cursor: 'pointer', fontFamily: F,
                    flexShrink: 0, transition: 'all 0.15s',
                  }}
                >
                  {editLocation.mode === 'type'
                    ? <><CursorIcon /> Click to place</>
                    : <><KeyboardIcon /> Type coordinates</>
                  }
                </button>
              </div>

              {/* Action row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <button
                  onClick={onEditSave}
                  style={{
                    background: '#14532d', border: '1px solid #166534', borderRadius: '8px',
                    color: '#4ade80', fontSize: FS, fontWeight: 500, padding: '7px 16px',
                    cursor: 'pointer', fontFamily: F, transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#166534'}
                  onMouseLeave={e => e.currentTarget.style.background = '#14532d'}
                >
                  Save location
                </button>
                <button
                  onClick={onEditCancel}
                  style={{ background: 'none', border: 'none', color: TEXT_MUTED, fontSize: FS, cursor: 'pointer', padding: 0, fontFamily: F, transition: 'color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.color = TEXT_PRIMARY}
                  onMouseLeave={e => e.currentTarget.style.color = TEXT_MUTED}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {noData ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '8px' }}>No data loaded for this sensor</div>
              <div style={{ fontSize: FS, color: TEXT_MUTED }}>Upload a CSV file from the sidebar to load readings.</div>
            </div>
          ) : (
            <>
              <div>
                <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Timeline</div>
                <TimelineStrip timeline={timeline} />
              </div>
              {chartData.length > 0 && (
                <div>
                  <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Readings</div>
                  <div style={{ height: '90px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id={`grad-${sensor.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="value" stroke="#4ade80" strokeWidth={1.5}
                          fill={`url(#grad-${sensor.id})`} connectNulls={false} dot={false}
                          activeDot={{ r: 3, fill: '#4ade80' }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Summary</div>
                <KPIRow report={report} />
              </div>
              {report?.not_wearing_pct != null && (
                <div style={{ background: '#1a1508', border: '1px solid #3a2a10', borderLeft: '3px solid #fb923c', borderRadius: '8px', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: FS, color: TEXT_MUTED }}>Not wearing ({report.not_wearing_pct.toFixed(1)}% of window)</span>
                  <span style={{ fontSize: FS, color: '#fb923c' }}>Device off-wrist</span>
                </div>
              )}
            </>
          )}

          {rawRows.length > 0 && (
            <div>
              <button
                onClick={() => setShowRaw(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: F }}
                onMouseEnter={e => e.currentTarget.style.color = TEXT_PRIMARY}
                onMouseLeave={e => e.currentTarget.style.color = TEXT_MUTED}
              >
                <span style={{ fontSize: '14px', lineHeight: 1 }}>{showRaw ? '▾' : '▸'}</span>
                Raw data ({rawRows.length.toLocaleString()} rows)
              </button>
              {showRaw && (
                <div style={{ marginTop: '8px', border: '1px solid #222', borderRadius: '8px', overflow: 'hidden' }}>
                  <div style={{ overflowY: 'auto', maxHeight: '240px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FS, fontFamily: F }}>
                      <thead>
                        <tr style={{ background: '#1a1a1a', position: 'sticky', top: 0, zIndex: 1 }}>
                          {['Timestamp', 'Sensor ID', 'Value'].map(col => (
                            <th key={col} style={{ padding: '7px 12px', textAlign: col === 'Value' ? 'right' : 'left', color: TEXT_MUTED, fontWeight: 500, borderBottom: '1px solid #222', whiteSpace: 'nowrap', fontSize: FS, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rawRows.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #1e1e1e' }}>
                            <td style={{ padding: '5px 12px', color: TEXT_MUTED, whiteSpace: 'nowrap' }}>{row.timestamp}</td>
                            <td style={{ padding: '5px 12px', color: TEXT_PRIMARY }}>{row.sensor_id}</td>
                            <td style={{ padding: '5px 12px', color: TEXT_PRIMARY, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {row.value == null ? <span style={{ color: TEXT_MUTED }}>—</span> : row.value}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <NotesSection sensorId={sensor.id} />
        </div>
      </div>
    </div>
  );
}
