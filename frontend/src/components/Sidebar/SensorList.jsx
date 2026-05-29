import { useState } from 'react';
import { format } from 'date-fns';
import { SensorCard } from './SensorCard';
import { ResidentRequestsTray } from './ResidentRequestsTray';
import { UploadPanel } from './UploadPanel';
import { EMPATICA_SIGNALS, STATUS_COLOR, STATUS_LABEL, CARD_BG } from '../../config/sensorConfig';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";
const FS = A11Y_THEME.fontMin;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;
const TEXT_MUTED = A11Y_THEME.textMuted;

function ChevronIcon({ open }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}>
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmpaticaGroup({ sensors, onSensorClick }) {
  const [expanded, setExpanded] = useState(false);

  const sensorMap = Object.fromEntries(sensors.filter(s => s.wearable).map(s => [s.id, s]));
  const loadedSensors = EMPATICA_SIGNALS.map(sig => sensorMap[sig.value]).filter(Boolean);
  const loadedCount = loadedSensors.length;

  const groupStatus = loadedCount === 0 ? 'offline'
    : loadedSensors.some(s => s.status === 'gap') ? 'gap'
    : loadedSensors.every(s => s.status === 'online') ? 'online'
    : 'offline';

  const color = STATUS_COLOR[groupStatus] ?? '#888';
  const cardStyle = CARD_BG[groupStatus] ?? CARD_BG.offline;

  return (
    <div style={{ marginBottom: '6px' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          background: cardStyle.background, border: `1px solid ${cardStyle.border}`,
          borderRadius: expanded ? '8px 8px 0 0' : '8px',
          padding: '10px 12px', cursor: 'pointer', fontFamily: F,
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: FS, fontWeight: 500, color: TEXT_PRIMARY }}>Empatica</span>
          <ChevronIcon open={expanded} />
        </div>
        <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '6px' }}>
          Wearable · {loadedCount > 0 ? `${loadedCount} / ${EMPATICA_SIGNALS.length} signals loaded` : 'No data'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ fontSize: FS, color, fontWeight: 500 }}>{STATUS_LABEL[groupStatus]}</span>
        </div>
      </button>

      {expanded && (
        <div style={{ border: `1px solid ${cardStyle.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
          {EMPATICA_SIGNALS.map((sig, i) => {
            const sensor = sensorMap[sig.value];
            const sigColor = sensor ? (STATUS_COLOR[sensor.status] ?? '#888') : '#333';
            const completeness = sensor?.report?.data_completeness_pct;
            const isLast = i === EMPATICA_SIGNALS.length - 1;
            return (
              <button
                key={sig.value}
                onClick={() => sensor && onSensorClick(sensor)}
                disabled={!sensor}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', textAlign: 'left', padding: '7px 12px 7px 16px',
                  background: sensor ? 'transparent' : 'transparent',
                  border: 'none', borderBottom: isLast ? 'none' : '1px solid #1e1e1e',
                  cursor: sensor ? 'pointer' : 'default', fontFamily: F,
                }}
                onMouseEnter={e => { if (sensor) e.currentTarget.style.background = '#1a1a1a'; }}
                onMouseLeave={e => { if (sensor) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                  <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: sigColor, flexShrink: 0 }} />
                  <span style={{ fontSize: FS, color: sensor ? TEXT_PRIMARY : TEXT_MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sig.label}
                  </span>
                </div>
                <span style={{ fontSize: FS, color: sensor ? TEXT_MUTED : TEXT_MUTED, flexShrink: 0, marginLeft: '8px' }}>
                  {completeness != null ? `${completeness.toFixed(0)}%` : sensor ? '—' : 'No data'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 8V2M3 5l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function SensorList({ sensors, requests, onSensorClick, onUploadResult }) {
  const [showUpload, setShowUpload] = useState(false);
  const now = new Date();

  return (
    <div style={{ width: '280px', flexShrink: 0, background: '#111', borderLeft: '1px solid #222', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: F }}>
      {/* Header */}
      <div style={{ padding: '18px 16px 14px', borderBottom: showUpload ? 'none' : '1px solid #222', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: TEXT_PRIMARY }}>Sensors</span>
          <span style={{ fontSize: FS, color: TEXT_MUTED }}>{format(now, 'MMM d, HH:mm')}</span>
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
            padding: '7px 10px', borderRadius: '6px', cursor: 'pointer',
            background: showUpload ? '#0d2b0d' : '#1a1a1a',
            border: `1px solid ${showUpload ? '#1e4d1e' : '#252525'}`,
            color: showUpload ? '#4ade80' : TEXT_MUTED, fontSize: FS, fontWeight: 500, fontFamily: F,
          }}
          onMouseEnter={e => { if (!showUpload) { e.currentTarget.style.borderColor = '#3a3a3a'; e.currentTarget.style.color = TEXT_PRIMARY; } }}
          onMouseLeave={e => { if (!showUpload) { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = TEXT_MUTED; } }}
        >
          <UploadIcon />
          Upload sensor data
        </button>
      </div>

      {showUpload && (
        <UploadPanel
          onResult={(sensorId, data) => { onUploadResult(sensorId, data); setShowUpload(false); }}
          onClose={() => setShowUpload(false)}
        />
      )}

      {/* Sensor cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {(() => {
          const nonWearable = sensors.filter(s => !s.wearable);
          const withData = nonWearable.filter(s => s.report);
          const withoutData = nonWearable.filter(s => !s.report);
          const empaticaHasData = sensors.some(s => s.wearable && s.report);
          return (
            <>
              {withData.map(s => <SensorCard key={s.id} sensor={s} onClick={onSensorClick} />)}
              {empaticaHasData && <EmpaticaGroup sensors={sensors} onSensorClick={onSensorClick} />}
              {withoutData.map(s => <SensorCard key={s.id} sensor={s} onClick={onSensorClick} />)}
              {!empaticaHasData && <EmpaticaGroup sensors={sensors} onSensorClick={onSensorClick} />}
            </>
          );
        })()}
      </div>

      <ResidentRequestsTray requests={requests} />
    </div>
  );
}
