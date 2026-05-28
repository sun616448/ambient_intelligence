import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { EMPATICA_SIGNALS } from '../../config/sensorConfig';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";

// ─── Sensor type mapping ────────────────────────────────────────────────────

const SENSOR_TYPE_MAP = {
  motion:              'Motion',
  heartrate:           'Heartrate',
  vibration:           'Vibration',
  bed_sensor:          'Bed',
  light_temperature:   'Environmental',
  wearable_light:      'Wearable',
  pressure:            'Pressure',
  surface_temperature: 'Environmental',
  smart_plug:          'Infrastructure',
  depth_camera:        'Camera',
  wyze_camera:         'Camera',
  usb_power:           'Infrastructure',
  recording_signage:   'Infrastructure',
};

const TYPE_DOT = {
  Motion:         '#60a5fa',
  Heartrate:      '#f87171',
  Vibration:      '#a78bfa',
  Bed:            '#fb923c',
  Environmental:  '#34d399',
  Wearable:       '#e879f9',
  Pressure:       '#38bdf8',
  Camera:         '#fbbf24',
  Infrastructure: '#94a3b8',
};

function sensorType(sensor) {
  if (sensor.id.startsWith('empatica_')) return 'Wearable';
  return SENSOR_TYPE_MAP[sensor.id] ?? 'Other';
}

// ─── Network / hw status ────────────────────────────────────────────────────

function networkOf(sensor) {
  return sensor.status === 'offline' && !sensor.report ? 'unreachable' : 'reachable';
}

function hwOf(sensor) {
  if (sensor.status === 'online') return 'collecting';
  if (sensor.status === 'gap')    return 'gap';
  return networkOf(sensor) === 'reachable' ? 'fault' : 'no_signal';
}

const NET_COLOR = { reachable: '#4ade80', unreachable: '#f87171' };
const NET_LABEL = { reachable: 'Reachable', unreachable: 'Unreachable' };
const HW_COLOR  = { collecting: '#4ade80', gap: '#fb923c', fault: '#f87171', no_signal: '#6b7280' };
const HW_LABEL  = { collecting: 'Collecting', gap: 'Gap', fault: 'Fault', no_signal: 'No Signal' };

// ─── Shared chrome color ────────────────────────────────────────────────────
// Matches the floor plan view's #111 background family
const BG_CHROME = A11Y_THEME.bgPanel;
const BG_MAIN   = A11Y_THEME.bgMain;
const BORDER    = A11Y_THEME.border;
const TEXT_MUTED = A11Y_THEME.textMuted;
const TEXT_SOFT  = A11Y_THEME.textSoft;
const FS = A11Y_THEME.fontMin;

// ─── Patterns (derived from real sensor data) ────────────────────────────────

function derivePatterns(sensors) {
  const patterns = [];
  const byType = {};

  for (const s of sensors) {
    const type = s.id.startsWith('empatica_') ? 'Wearable' : (SENSOR_TYPE_MAP[s.id] ?? 'Other');
    const r = s.report;

    if (s.status === 'offline' && !r) {
      // No data ever received
      const key = `no-data-${type}`;
      if (!byType[key]) {
        byType[key] = true;
        patterns.push({
          id: key, severity: 'alert', filterType: type,
          label: `${type} sensor offline — no data received`,
          detail: `${s.name} has no data on record. Check power and connectivity.`,
        });
      }
    } else if (r) {
      const pct = r.data_completeness_pct ?? 100;
      const gaps = r.gap_count ?? 0;

      if (pct < 70) {
        patterns.push({
          id: `low-completeness-${s.id}`, severity: 'alert', filterType: type,
          label: `${s.name} — completeness ${pct.toFixed(0)}%`,
          detail: `Data completeness is critically low. ${gaps} gap${gaps !== 1 ? 's' : ''} detected. Check power and connectivity.`,
        });
      } else if (pct < 90) {
        patterns.push({
          id: `mid-completeness-${s.id}`, severity: 'warning', filterType: type,
          label: `${s.name} — completeness ${pct.toFixed(0)}%`,
          detail: `${gaps} gap${gaps !== 1 ? 's' : ''} detected. May indicate intermittent connectivity.`,
        });
      }

      if (s.status === 'gap') {
        patterns.push({
          id: `gap-${s.id}`, severity: 'warning', filterType: type,
          label: `${s.name} — active data gap`,
          detail: `Sensor is currently in a gap state. Last data received: ${s.lastActive ? new Date(s.lastActive).toLocaleString() : 'unknown'}.`,
        });
      }
    }
  }

  // Deduplicate by id, sort alerts first
  const seen = new Set();
  return patterns
    .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a, b) => (a.severity === 'alert' ? -1 : 1) - (b.severity === 'alert' ? -1 : 1));
}

// ─── Column layout ───────────────────────────────────────────────────────────

// Wide enough for 14px uppercase headers + letter-spacing; horizontal scroll if viewport is narrower
const TABLE_MIN_WIDTH = '1340px';
const COL_GRID =
  '110px minmax(200px, 1fr) 96px 102px 124px 152px 146px 182px 70px 146px';
const COL_HEADERS = ['Participant', 'Sensor Name', 'Room', 'Type', 'Network', 'Sensor Status', 'Completeness', 'Last Data', 'Gaps', 'Longest Gap'];

// ─── Icons ───────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 13 13" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke={TEXT_MUTED} strokeWidth="1.4" />
      <path d="M8.5 8.5L11.5 11.5" stroke={TEXT_MUTED} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="9" height="6" viewBox="0 0 9 6" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1 1L4.5 5L8 1" stroke={TEXT_MUTED} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon({ color }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 1L12 11.5H1L6.5 1Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6.5 5v3" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6.5" cy="9.5" r="0.6" fill={color} />
    </svg>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SelectFilter({ value, onChange, children }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: '#1a1a1a', border: `1px solid #2a2a2a`, borderRadius: '6px',
          color: value === 'all' ? TEXT_MUTED : '#e5e5e5',
          fontSize: FS, padding: '6px 28px 6px 10px',
          cursor: 'pointer', fontFamily: F, outline: 'none',
          appearance: 'none', WebkitAppearance: 'none',
          colorScheme: 'dark', minWidth: '158px',
        }}
      >
        {children}
      </select>
      <div style={{ position: 'absolute', right: '8px', pointerEvents: 'none' }}>
        <ChevronDown />
      </div>
    </div>
  );
}

function BadgePill({ color, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontSize: FS, fontWeight: 500, color,
      background: `${color}18`, border: `1px solid ${color}38`,
      borderRadius: '999px', padding: '2px 8px', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function ParticipantTag({ pid }) {
  if (!pid) return <span style={{ fontSize: FS, color: TEXT_MUTED }}>—</span>;
  return (
    <span style={{
      display: 'inline-block',
      fontSize: FS, fontWeight: 600, color: '#4ade80',
      background: '#4ade8015', border: '1px solid #4ade8030',
      borderRadius: '4px', padding: '2px 6px',
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>
      {pid}
    </span>
  );
}

function CompletenessBar({ value }) {
  const hasValue = value != null;
  const pct   = hasValue ? Math.max(0, Math.min(100, value)) : 0;
  const color  = !hasValue ? '#2a2a2a' : pct >= 90 ? '#4ade80' : pct >= 70 ? '#fb923c' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      <div style={{ width: '52px', height: '4px', background: '#222', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px' }} />
      </div>
      <span style={{ fontSize: FS, color: hasValue ? color : TEXT_MUTED, fontVariantNumeric: 'tabular-nums', minWidth: '34px' }}>
        {hasValue ? `${pct.toFixed(0)}%` : '—'}
      </span>
    </div>
  );
}

function formatLongestGap(sec) {
  if (!sec || sec === 0) return '—';
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)} hr`;
  if (sec >= 60)   return `${Math.round(sec / 60)} min`;
  return `${Math.round(sec)} s`;
}

// ─── Patterns sidebar ────────────────────────────────────────────────────────

function PatternsSidebar({ sensors, onFilter }) {
  const [dismissed, setDismissed] = useState(new Set());
  const patterns = useMemo(() => derivePatterns(sensors), [sensors]);
  const visible = patterns.filter(p => !dismissed.has(p.id));
  const alertCount = visible.filter(p => p.severity === 'alert').length;

  return (
    <div style={{
      width: '264px', flexShrink: 0,
      borderLeft: `1px solid ${BORDER}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: BG_CHROME,
    }}>
      <div style={{
        padding: '14px 16px 12px', borderBottom: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: FS, fontWeight: 600, color: '#e5e5e5' }}>Patterns detected</span>
          {alertCount > 0 && (
            <span style={{
              fontSize: FS, fontWeight: 600, color: '#f87171',
              background: '#f8717118', border: '1px solid #f8717130',
              borderRadius: '999px', padding: '1px 7px',
            }}>
              {alertCount} alert
            </span>
          )}
        </div>
        <span style={{ fontSize: FS, color: TEXT_MUTED }}>Auto-detected</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {visible.length === 0 && (
          <div style={{ fontSize: FS, color: TEXT_MUTED, textAlign: 'center', marginTop: '24px' }}>
            No active patterns
          </div>
        )}
        {visible.map(p => {
          const borderColor = p.severity === 'alert' ? '#f87171' : '#fb923c';
          const bgColor     = p.severity === 'alert' ? 'rgba(248,113,113,0.05)' : 'rgba(251,146,60,0.05)';
          const edgeColor   = p.severity === 'alert' ? '#3a1a1a' : '#2a1e0e';
          return (
            <div key={p.id} style={{
              background: bgColor, border: `1px solid ${edgeColor}`,
              borderLeft: `3px solid ${borderColor}`, borderRadius: '6px',
              padding: '11px 12px', marginBottom: '8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', marginBottom: '6px' }}>
                <div style={{ flexShrink: 0, marginTop: '1px' }}><AlertIcon color={borderColor} /></div>
                <span style={{ fontSize: FS, fontWeight: 500, color: borderColor, lineHeight: 1.4 }}>{p.label}</span>
              </div>
              <p style={{ fontSize: FS, color: TEXT_SOFT, lineHeight: 1.55, margin: '0 0 8px 20px' }}>{p.detail}</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', paddingLeft: '20px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    onClick={() => onFilter(p.filterType)}
                    style={{ background: 'none', border: 'none', color: TEXT_MUTED, fontSize: FS, cursor: 'pointer', padding: 0, fontFamily: F, textDecoration: 'underline', textDecorationColor: TEXT_MUTED }}
                    onMouseEnter={e => e.currentTarget.style.color = '#e5e5e5'}
                    onMouseLeave={e => e.currentTarget.style.color = TEXT_MUTED}
                  >
                    View sensors
                  </button>
                  <button
                    onClick={() => setDismissed(s => new Set([...s, p.id]))}
                    style={{ background: 'none', border: 'none', color: TEXT_MUTED, fontSize: FS, cursor: 'pointer', padding: 0, lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = TEXT_SOFT}
                    onMouseLeave={e => e.currentTarget.style.color = TEXT_MUTED}
                    title="Dismiss"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function AllSensorsView({ sensors, onSensorClick, participants = [], selectedPId = null }) {
  const [hoveredId,    setHoveredId]    = useState(null);
  const [filterType,   setFilterType]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPId,    setFilterPId]    = useState('all');
  const [searchQuery,  setSearchQuery]  = useState('');

  const allRows = useMemo(() => {
    const base = sensors.filter(s => !s.wearable);
    const empaticaMap = Object.fromEntries(sensors.filter(s => s.wearable).map(s => [s.id, s]));
    const empaticaRows = EMPATICA_SIGNALS.map(sig => {
      const s = empaticaMap[sig.value];
      if (s) return s;
      return {
        id: sig.value, name: sig.label, room: 'Wearable',
        status: 'offline', lastActive: null, report: null,
        readings: [], timeline: [], rawRows: [], wearable: true,
        _placeholder: true,
      };
    });
    return [...base, ...empaticaRows];
  }, [sensors]);

  const SENSOR_TYPES = [...new Set(allRows.map(s => sensorType(s)).filter(Boolean))].sort();

  const handlePatternFilter = (type) => {
    setFilterType(type);
    setFilterStatus('all');
    setFilterPId('all');
    setSearchQuery('');
  };

  const rows = useMemo(() => {
    let result = [...allRows];
    if (filterType !== 'all')   result = result.filter(s => sensorType(s) === filterType);
    if (filterStatus === 'network') result = result.filter(s => networkOf(s) === 'unreachable');
    else if (filterStatus !== 'all') result = result.filter(s => s.status === filterStatus);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s => s.name.toLowerCase().includes(q) || s.room.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      // Sensors with data float to top; within that group sort by worst completeness first
      const aHasData = a.report != null ? 1 : 0;
      const bHasData = b.report != null ? 1 : 0;
      if (aHasData !== bHasData) return bHasData - aHasData;
      const ca = a.report?.data_completeness_pct ?? 101;
      const cb = b.report?.data_completeness_pct ?? 101;
      return ca - cb;
    });
    return result;
  }, [allRows, filterType, filterStatus, searchQuery]);

  const hasFilters = filterType !== 'all' || filterStatus !== 'all' || searchQuery;

  function rowBg(sensor, isHov) {
    if (sensor.status === 'offline') return isHov ? '#241414' : '#1a0f0f';
    if (sensor.status === 'gap')     return isHov ? '#241c0e' : '#1a1508';
    return isHov ? '#1c1c1c' : 'transparent';
  }

  const statusCounts = {
    online:  rows.filter(s => s.status === 'online').length,
    gap:     rows.filter(s => s.status === 'gap').length,
    offline: rows.filter(s => s.status === 'offline').length,
    network: rows.filter(s => networkOf(s) === 'unreachable').length,
  };

  // The participant tag shown per row: use selectedPId if set, otherwise "—"
  const rowPId = selectedPId ?? null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: BG_MAIN, color: '#e5e5e5', fontFamily: F, fontSize: FS }}>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div style={{
        height: '52px', flexShrink: 0, background: BG_CHROME,
        borderBottom: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', padding: '0 18px', gap: '10px',
      }}>
        <SelectFilter value={filterType} onChange={setFilterType}>
          <option value="all">All Types</option>
          {SENSOR_TYPES.map(t => <option key={t} value={t} style={{ background: '#1a1a1a' }}>{t}</option>)}
        </SelectFilter>

        <SelectFilter value={filterStatus} onChange={setFilterStatus}>
          <option value="all">All Statuses</option>
          <option value="online"  style={{ background: '#1a1a1a' }}>Online</option>
          <option value="gap"     style={{ background: '#1a1a1a' }}>Data Gap</option>
          <option value="offline" style={{ background: '#1a1a1a' }}>Offline</option>
          <option value="network" style={{ background: '#1a1a1a' }}>Network Issue</option>
        </SelectFilter>

        {participants.length > 0 && (
          <SelectFilter value={filterPId} onChange={setFilterPId}>
            <option value="all">All Participants</option>
            {participants.map(p => (
              <option key={p.id} value={p.id} style={{ background: '#1a1a1a' }}>{p.id}</option>
            ))}
          </SelectFilter>
        )}

        <div style={{ width: '1px', height: '18px', background: '#222', flexShrink: 0 }} />

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <div style={{ position: 'absolute', left: '10px', pointerEvents: 'none' }}><SearchIcon /></div>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search sensor or room..."
            style={{
              background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px',
              color: '#e5e5e5', fontSize: FS, padding: '6px 10px 6px 30px',
              width: '220px', outline: 'none', fontFamily: F,
            }}
          />
        </div>

        {hasFilters && (
          <button
            onClick={() => { setFilterType('all'); setFilterStatus('all'); setFilterPId('all'); setSearchQuery(''); }}
            style={{
              background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px',
              color: TEXT_MUTED, fontSize: FS, padding: '5px 10px',
              cursor: 'pointer', fontFamily: F, whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#e5e5e5'; e.currentTarget.style.borderColor = '#444'; }}
            onMouseLeave={e => { e.currentTarget.style.color = TEXT_MUTED; e.currentTarget.style.borderColor = '#2a2a2a'; }}
          >
            Clear filters
          </button>
        )}

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: FS, color: TEXT_MUTED, whiteSpace: 'nowrap' }}>
          {rows.length} sensor{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* Table area */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>

          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <div style={{ minWidth: TABLE_MIN_WIDTH }}>
              {/* Column headers — sticky so vertical scroll keeps context; minWidth shows full labels */}
              <div style={{
                display: 'grid', gridTemplateColumns: COL_GRID,
                padding: '0 16px', background: BG_CHROME,
                borderBottom: `1px solid ${BORDER}`,
                position: 'sticky', top: 0, zIndex: 2,
              }}>
                {COL_HEADERS.map(h => (
                  <div key={h} style={{
                    fontSize: FS, color: '#e5e5e5', textTransform: 'uppercase',
                    letterSpacing: '0.08em', padding: '10px 6px',
                    whiteSpace: 'nowrap', overflow: 'visible',
                  }}>
                    {h}
                  </div>
                ))}
              </div>

              {/* Rows */}
              <div>
            {rows.length === 0 && (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: TEXT_MUTED, fontSize: FS }}>
                No sensors match the current filters.
              </div>
            )}
            {rows.map(sensor => {
              const net        = networkOf(sensor);
              const hw         = hwOf(sensor);
              const isHov      = hoveredId === sensor.id;
              const type       = sensorType(sensor);
              const pct        = sensor.report?.data_completeness_pct ?? null;
              const gapCount   = sensor.report?.gap_count ?? null;
              const longestGap = sensor.report?.longest_gap_sec ?? null;
              const lastTs     = sensor.lastActive
                ? format(new Date(sensor.lastActive), 'MMM d, yyyy HH:mm')
                : '—';
              const isPlaceholder = sensor._placeholder;

              return (
                <div
                  key={sensor.id}
                  onClick={() => !isPlaceholder && onSensorClick(sensor)}
                  onMouseEnter={() => setHoveredId(sensor.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    display: 'grid', gridTemplateColumns: COL_GRID,
                    padding: '0 16px',
                    background: rowBg(sensor, isHov),
                    borderBottom: '1px solid #181818',
                    cursor: isPlaceholder ? 'default' : 'pointer',
                    transition: 'background 0.1s',
                    minWidth: TABLE_MIN_WIDTH, alignItems: 'center',
                    opacity: isPlaceholder ? 0.4 : 1,
                  }}
                >
                  {/* Participant tag */}
                  <div style={{ padding: '10px 6px' }}>
                    <ParticipantTag pid={rowPId} />
                  </div>

                  {/* Sensor name + id */}
                  <div style={{ padding: '10px 6px', overflow: 'hidden' }}>
                    <div style={{ fontSize: FS, color: '#e5e5e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sensor.name}
                    </div>
                    <div style={{ fontSize: FS, color: TEXT_MUTED, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sensor.id}
                    </div>
                  </div>

                  {/* Room */}
                  <div style={{ padding: '10px 6px', fontSize: FS, color: TEXT_SOFT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sensor.room}
                  </div>

                  {/* Type */}
                  <div style={{ padding: '10px 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: TYPE_DOT[type] ?? '#888', flexShrink: 0 }} />
                    <span style={{ fontSize: FS, color: TEXT_SOFT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {type}
                    </span>
                  </div>

                  {/* Network */}
                  <div style={{ padding: '10px 6px' }}>
                    <BadgePill color={NET_COLOR[net]} label={NET_LABEL[net]} />
                  </div>

                  {/* Sensor status */}
                  <div style={{ padding: '10px 6px' }}>
                    <BadgePill color={HW_COLOR[hw]} label={HW_LABEL[hw]} />
                  </div>

                  {/* Completeness */}
                  <div style={{ padding: '10px 6px' }}>
                    <CompletenessBar value={pct} />
                  </div>

                  {/* Last data */}
                  <div style={{ padding: '10px 6px', fontSize: FS, color: TEXT_SOFT, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {lastTs}
                  </div>

                  {/* Gap count */}
                  <div style={{
                    padding: '10px 6px', fontSize: FS, fontVariantNumeric: 'tabular-nums', fontWeight: 500,
                    color: gapCount == null ? '#2a2a2a' : gapCount === 0 ? TEXT_MUTED : gapCount > 10 ? '#f87171' : '#fb923c',
                  }}>
                    {gapCount == null ? '—' : gapCount === 0 ? '—' : gapCount}
                  </div>

                  {/* Longest gap */}
                  <div style={{ padding: '10px 6px', fontSize: FS, color: longestGap ? TEXT_SOFT : TEXT_MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatLongestGap(longestGap)}
                  </div>
                </div>
              );
            })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            height: '36px', flexShrink: 0, background: BG_CHROME,
            borderTop: `1px solid ${BORDER}`,
            display: 'flex', alignItems: 'center', padding: '0 18px', gap: '20px',
          }}>
            {[
              { label: 'Online',    color: '#4ade80', count: statusCounts.online },
              { label: 'Gap',       color: '#fb923c', count: statusCounts.gap },
              { label: 'Offline',   color: '#f87171', count: statusCounts.offline },
              { label: 'Net Issue', color: '#94a3b8', count: statusCounts.network },
            ].map(({ label, color, count }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }} />
                <span style={{ fontSize: FS, color: TEXT_MUTED }}>{count} {label}</span>
              </div>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: FS, color: TEXT_MUTED }}>Sensors with data first · worst completeness at top</span>
          </div>
        </div>

        {/* Patterns sidebar */}
        <PatternsSidebar sensors={allRows} onFilter={handlePatternFilter} />
      </div>
    </div>
  );
}
