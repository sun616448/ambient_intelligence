import { useState, useRef } from 'react';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";
const FS = A11Y_THEME.fontMin;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;
const TEXT_MUTED = A11Y_THEME.textMuted;
const TEXT_SOFT = A11Y_THEME.textSoft;

const HOME_LABELS = { studio: 'One Room Studio', 'one-bed': 'One Bedroom', 'two-bed': 'Two Bedroom' };

const STEP_META = [
  { label: 'Participant Info',  desc: 'Identity and study details' },
  { label: 'Sensor Assignment', desc: 'Device deployment plan' },
  { label: 'Consent',           desc: 'Informed consent checklist' },
  { label: 'Review & Activate', desc: 'Final confirmation' },
];

const INIT_SENSORS = [
  { id: 'motion',   name: 'Motion Sensor',       dotColor: '#4ade80', included: true,  placementNote: '', position: { x: 54, y: 44 }, noFloorPlan: false },
  { id: 'door',     name: 'Door / Window Sensor', dotColor: '#4ade80', included: true,  placementNote: '', position: { x: 20, y: 30 }, noFloorPlan: false },
  { id: 'bed',      name: 'Bed Occupancy',         dotColor: '#4ade80', included: true,  placementNote: '', position: { x: 76, y: 56 }, noFloorPlan: false },
  { id: 'kitchen',  name: 'Kitchen Activity',      dotColor: '#4ade80', included: true,  placementNote: '', position: { x: 28, y: 25 }, noFloorPlan: false },
  { id: 'bathroom', name: 'Bathroom Usage',        dotColor: '#4ade80', included: true,  placementNote: '', position: { x: 82, y: 32 }, noFloorPlan: false },
  { id: 'wearable', name: 'Wearable Device',       dotColor: '#fb923c', included: false, placementNote: '', position: { x: 50, y: 50 }, noFloorPlan: true },
  { id: 'env',      name: 'Environmental',         dotColor: '#60a5fa', included: true,  placementNote: '', position: { x: 40, y: 62 }, noFloorPlan: false },
];

const INIT_CONSENT_ITEMS = [
  { id: 'motion',   label: 'Motion sensing in all rooms',      description: 'Passive infrared and radar sensors track movement throughout all rooms 24/7.',             checked: true  },
  { id: 'wearable', label: 'Wearable device during sleep',     description: 'A wrist-worn device collects heart rate and movement data during nighttime hours.',        checked: false },
  { id: 'video',    label: 'Video recording in common areas',  description: 'Low-resolution cameras capture activity in living areas only — no audio.',                 checked: false },
  { id: 'env',      label: 'Environmental monitoring',         description: 'Temperature, humidity and light sensors log ambient conditions continuously.',             checked: true  },
  { id: 'sharing',  label: 'Data sharing with research team',  description: 'Anonymised data may be reviewed by co-investigators named in the study protocol.',        checked: true  },
  { id: 'pub',      label: 'Anonymous data publication',       description: 'Aggregated findings may be published in academic journals or conference proceedings.',    checked: true  },
];

// ── Style helpers ─────────────────────────────────────────────────────────────

const inp = (extra = {}) => ({
  background: '#161616', border: '1px solid #272727', borderRadius: '6px',
  color: TEXT_PRIMARY, fontSize: FS, padding: '9px 12px', fontFamily: F,
  width: '100%', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark',
  ...extra,
});

const lbl = { fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' };

// ── Mini icons ────────────────────────────────────────────────────────────────

function CheckIcon({ color = '#111' }) {
  return <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ChevronRight() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ChevronLeft() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ChevronDown() {
  return <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="#8e8e8e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PlusIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onToggle }) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onToggle(); }}
      style={{
        width: '34px', height: '20px', borderRadius: '10px',
        background: on ? '#4ade80' : '#252525',
        border: `1px solid ${on ? '#4ade80' : '#333'}`,
        position: 'relative', cursor: 'pointer', flexShrink: 0,
        transition: 'background 0.2s, border-color 0.2s',
      }}
    >
      <div style={{
        position: 'absolute', top: '3px', left: on ? '15px' : '3px',
        width: '12px', height: '12px', borderRadius: '50%',
        background: on ? '#111' : '#555', transition: 'left 0.2s',
      }} />
    </div>
  );
}

// ── Step indicator (left rail) ────────────────────────────────────────────────

function StepIndicator({ currentStep }) {
  return (
    <div style={{ paddingTop: '32px' }}>
      <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.14em', padding: '0 32px', marginBottom: '28px' }}>
        Enrollment Steps
      </div>
      {STEP_META.map(({ label, desc }, idx) => {
        const step = idx + 1;
        const isActive   = step === currentStep;
        const isComplete = step < currentStep;
        const isLast     = idx === STEP_META.length - 1;
        return (
          <div key={step}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '14px 32px', borderLeft: `3px solid ${isActive ? '#4ade80' : 'transparent'}` }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0, marginTop: '1px',
                background: isComplete ? '#4ade80' : 'transparent',
                border: `2px solid ${isActive ? '#4ade80' : isComplete ? '#4ade80' : '#252525'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isComplete ? <CheckIcon color="#111" /> : <span style={{ fontSize: FS, color: isActive ? '#4ade80' : TEXT_MUTED, fontWeight: 600 }}>{step}</span>}
              </div>
              <div>
                <div style={{ fontSize: FS, fontWeight: isActive ? 500 : 400, color: isActive ? TEXT_PRIMARY : TEXT_SOFT, marginBottom: '4px' }}>{label}</div>
                <div style={{ fontSize: FS, color: isActive ? '#7fd397' : TEXT_MUTED, lineHeight: 1.4 }}>
                  {isActive ? 'In progress' : isComplete ? 'Complete' : desc}
                </div>
              </div>
            </div>
            {!isLast && <div style={{ marginLeft: '47px', height: '12px', width: '1px', background: '#1e1e1e' }} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1 ────────────────────────────────────────────────────────────────────

function Step1Form({ data, onChange }) {
  const set = key => e => onChange({ ...data, [key]: e.target.value });
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <span style={lbl}>Participant ID</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', background: '#161616', border: '1px solid #272727', borderRadius: '20px', padding: '7px 20px', fontSize: '15px', fontWeight: 600, color: '#4ade80', letterSpacing: '0.06em', fontFamily: F }}>
            {data.participantId}
          </div>
          <span style={{ fontSize: FS, color: TEXT_MUTED }}>Auto-generated — read only</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        <div>
          <span style={lbl}>Age</span>
          <input type="number" min={0} max={120} value={data.age} onChange={set('age')} placeholder="e.g. 74" style={inp()} />
        </div>
        <div>
          <span style={lbl}>Home Type</span>
          <div style={{ position: 'relative' }}>
            <select value={data.homeType} onChange={set('homeType')} style={{ ...inp(), appearance: 'none', WebkitAppearance: 'none', paddingRight: '32px', cursor: 'pointer' }}>
              <option value="" disabled style={{ background: '#161616' }}>Select…</option>
              <option value="studio"   style={{ background: '#161616' }}>One Room Studio</option>
              <option value="one-bed"  style={{ background: '#161616' }}>One Bedroom</option>
              <option value="two-bed"  style={{ background: '#161616' }}>Two Bedroom</option>
            </select>
            <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><ChevronDown /></div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        <div>
          <span style={lbl}>Study Start Date</span>
          <input type="date" value={data.studyStartDate} onChange={set('studyStartDate')} style={inp()} />
        </div>
        <div>
          <span style={lbl}>Assigned Researcher</span>
          <input type="text" value={data.assignedResearcher} onChange={set('assignedResearcher')} placeholder="e.g. Dr. R. Chen" style={inp()} />
        </div>
      </div>

      <div>
        <span style={{ ...lbl, marginBottom: '12px' }}>Emergency Contact</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <span style={{ ...lbl, fontSize: FS, color: TEXT_MUTED }}>Full Name</span>
            <input type="text" value={data.emergencyName} onChange={set('emergencyName')} placeholder="e.g. Sarah Anderson" style={inp()} />
          </div>
          <div>
            <span style={{ ...lbl, fontSize: FS, color: TEXT_MUTED }}>Phone Number</span>
            <input type="tel" value={data.emergencyPhone} onChange={set('emergencyPhone')} placeholder="e.g. +1 555 000 1234" style={inp()} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 2 ────────────────────────────────────────────────────────────────────

function Step2Form({ sensors, onChange }) {
  const [selectedId, setSelectedId] = useState(null);
  const [dragging, setDragging]     = useState(null);
  const mapRef = useRef(null);

  const toggle  = id => onChange(sensors.map(s => s.id === id ? { ...s, included: !s.included } : s));
  const setNote = (id, v) => onChange(sensors.map(s => s.id === id ? { ...s, placementNote: v } : s));
  const setName = (id, v) => onChange(sensors.map(s => s.id === id ? { ...s, name: v } : s));
  const setPos  = (id, x, y) => onChange(sensors.map(s => s.id === id ? { ...s, position: { x, y } } : s));
  const addCustom = () => onChange([...sensors, {
    id: `custom-${Date.now()}`, name: 'Custom Sensor', dotColor: '#fb923c',
    included: true, placementNote: '', position: { x: 50, y: 50 }, noFloorPlan: false,
  }]);

  const getPct = (e) => {
    const rect = mapRef.current.getBoundingClientRect();
    return {
      x: parseFloat((Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100))).toFixed(1)),
      y: parseFloat((Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100))).toFixed(1)),
    };
  };

  const handleMapClick = (e) => {
    if (dragging || !selectedId || !mapRef.current) return;
    const s = sensors.find(s => s.id === selectedId);
    if (!s || s.noFloorPlan || !s.included) return;
    const { x, y } = getPct(e);
    setPos(selectedId, x, y);
  };

  const handleDotDown = (e, id) => {
    e.stopPropagation(); e.preventDefault();
    setDragging(id); setSelectedId(id);
  };

  const handleMouseMove = (e) => {
    if (!dragging || !mapRef.current) return;
    const { x, y } = getPct(e);
    setPos(dragging, x, y);
  };

  const stopDrag = () => setDragging(null);

  const floorPlanSensors = sensors.filter(s => s.included && !s.noFloorPlan);
  const selectedSensor   = sensors.find(s => s.id === selectedId);
  const canPlace = selectedSensor && selectedSensor.included && !selectedSensor.noFloorPlan;

  return (
    <div style={{ display: 'flex', gap: '24px' }}>

      {/* ── Left: sensor list ── */}
      <div style={{ width: '252px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sensors.map(sensor => {
          const isCustom   = sensor.id.startsWith('custom-');
          const isSelected = sensor.id === selectedId;
          const canSelect  = sensor.included && !sensor.noFloorPlan;
          return (
            <div key={sensor.id}
              onClick={() => canSelect && setSelectedId(isSelected ? null : sensor.id)}
              style={{
                background: '#161616',
                border: `1px solid ${isSelected ? '#4ade80' : sensor.included ? '#272727' : '#1c1c1c'}`,
                borderRadius: '8px', padding: '12px',
                opacity: sensor.included ? 1 : 0.4,
                transition: 'opacity 0.2s, border-color 0.2s',
                cursor: canSelect ? 'pointer' : 'default',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: sensor.included ? '8px' : '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: sensor.dotColor, flexShrink: 0 }} />
                  {isCustom
                    ? <input value={sensor.name} onChange={e => setName(sensor.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="Sensor name"
                        style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #333', color: TEXT_PRIMARY, fontSize: FS, fontFamily: F, outline: 'none', padding: '2px 0', flex: 1, minWidth: 0 }} />
                    : <span style={{ fontSize: FS, color: TEXT_PRIMARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sensor.name}</span>
                  }
                </div>
                <Toggle on={sensor.included} onToggle={() => toggle(sensor.id)} />
              </div>

              {sensor.included && (
                <div onClick={e => e.stopPropagation()}>
                  <input type="text" value={sensor.placementNote}
                    onChange={e => setNote(sensor.id, e.target.value)}
                    placeholder="Placement note…"
                    style={{ ...inp({ fontSize: FS, padding: '5px 8px' }), marginBottom: canSelect ? '6px' : '0' }}
                  />
                  {canSelect && (
                    <div style={{ fontSize: FS, color: isSelected ? '#4ade80' : TEXT_MUTED, letterSpacing: '0.04em' }}>
                      {isSelected
                        ? 'Click map or drag dot to reposition'
                        : `${sensor.position?.x ?? 50}% × ${sensor.position?.y ?? 50}%`}
                    </div>
                  )}
                  {sensor.noFloorPlan && (
                    <div style={{ fontSize: FS, color: TEXT_MUTED }}>Wearable — no floor plan dot</div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <button onClick={addCustom}
          style={{ marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'transparent', border: '1px dashed #252525', borderRadius: '8px', color: TEXT_MUTED, fontSize: FS, padding: '10px', cursor: 'pointer', fontFamily: F }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#4ade80'; e.currentTarget.style.color = '#4ade80'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = '#7d7d7d'; }}
        >
          <PlusIcon /> Add custom sensor
        </button>
      </div>

      {/* ── Right: floor plan editor ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
        <div style={{ fontSize: FS, textTransform: 'uppercase', letterSpacing: '0.1em', color: canPlace ? '#4ade80' : TEXT_MUTED }}>
          {canPlace
            ? `Placing: ${selectedSensor.name} — click map or drag dot`
            : 'Select a sensor from the list to position it'}
        </div>

        <div
          ref={mapRef}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
          onClick={handleMapClick}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '4 / 3',
            background: '#0a0a0a',
            border: `1px solid ${canPlace ? '#4ade8033' : '#1c1c1c'}`,
            borderRadius: '8px',
            overflow: 'hidden',
            cursor: canPlace ? 'crosshair' : 'default',
            userSelect: 'none',
            transition: 'border-color 0.2s',
          }}
        >
          <img
            src="/floorplan.png"
            alt="Floor plan"
            style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block', pointerEvents: 'none' }}
          />

          {floorPlanSensors.map(sensor => {
            const isSelected = sensor.id === selectedId;
            const isDragging = sensor.id === dragging;
            const size = isSelected || isDragging ? 16 : 12;
            return (
              <div
                key={sensor.id}
                onMouseDown={e => handleDotDown(e, sensor.id)}
                style={{
                  position: 'absolute',
                  left: `${sensor.position?.x ?? 50}%`,
                  top:  `${sensor.position?.y ?? 50}%`,
                  transform: 'translate(-50%, -50%)',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  zIndex: isSelected ? 10 : 5,
                }}
              >
                {isSelected && (
                  <div style={{
                    position: 'absolute', bottom: 'calc(100% + 7px)', left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#1e1e1e', border: '1px solid #333', borderRadius: '4px',
                    padding: '3px 8px', fontSize: FS, color: TEXT_PRIMARY,
                    whiteSpace: 'nowrap', pointerEvents: 'none',
                  }}>
                    {sensor.name}
                  </div>
                )}
                <div style={{
                  width: `${size}px`, height: `${size}px`, borderRadius: '50%',
                  background: sensor.dotColor,
                  boxShadow: isSelected
                    ? `0 0 0 5px ${sensor.dotColor}44, 0 0 0 1px ${sensor.dotColor}`
                    : `0 0 0 2px ${sensor.dotColor}33`,
                  transition: isDragging ? 'none' : 'width 0.1s, height 0.1s, box-shadow 0.1s',
                }} />
              </div>
            );
          })}

          {floorPlanSensors.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: FS, color: TEXT_MUTED }}>No sensors enabled for floor plan</span>
            </div>
          )}
        </div>

        <div style={{ fontSize: FS, color: TEXT_MUTED, textAlign: 'right' }}>
          {floorPlanSensors.length} sensor{floorPlanSensors.length !== 1 ? 's' : ''} placed
        </div>
      </div>
    </div>
  );
}

// ── Step 3 ────────────────────────────────────────────────────────────────────

function Step3Form({ data, onChange }) {
  const toggleItem = id => onChange({ ...data, items: data.items.map(i => i.id === id ? { ...i, checked: !i.checked } : i) });
  const someUnchecked = data.items.some(i => !i.checked);

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        {data.items.map((item, idx) => (
          <div key={item.id} style={{ display: 'flex', gap: '14px', padding: '14px 0', borderBottom: idx < data.items.length - 1 ? '1px solid #1a1a1a' : 'none' }}>
            <div onClick={() => toggleItem(item.id)} style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${item.checked ? '#4ade80' : '#2a2a2a'}`, background: item.checked ? '#4ade80' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, marginTop: '2px', transition: 'all 0.15s' }}>
              {item.checked && <CheckIcon color="#111" />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', color: item.checked ? '#e5e5e5' : '#8e8e8e', marginBottom: '4px' }}>{item.label}</div>
              <div style={{ fontSize: FS, color: TEXT_MUTED, lineHeight: 1.55 }}>{item.description}</div>
            </div>
          </div>
        ))}
      </div>

      {someUnchecked && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.22)', borderRadius: '8px', padding: '12px 14px', marginBottom: '20px' }}>
          <svg width="14" height="16" viewBox="0 0 14 16" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
            <rect x="1" y="7" width="12" height="9" rx="2" stroke="#fb923c" strokeWidth="1.5" />
            <path d="M4 7V5a3 3 0 016 0v2" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="7" cy="11.5" r="1.5" fill="#fb923c" />
          </svg>
          <div>
            <div style={{ fontSize: '14px', color: '#fb923c', fontWeight: 500, marginBottom: '4px' }}>Partial consent</div>
            <div style={{ fontSize: FS, color: '#d9b084', lineHeight: 1.55 }}>One or more consent items are unchecked. This participant will be enrolled with partial consent. Affected sensors will be restricted until full consent is obtained.</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div>
          <span style={lbl}>Consent Recorded By</span>
          <input type="text" value={data.recordedBy} onChange={e => onChange({ ...data, recordedBy: e.target.value })} placeholder="e.g. Dr. M. Torres" style={inp()} />
        </div>
        <div>
          <span style={lbl}>Date</span>
          <input type="date" value={data.recordedDate} onChange={e => onChange({ ...data, recordedDate: e.target.value })} style={inp()} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: '#161616', border: '1px solid #222', borderRadius: '8px' }}>
        <div>
          <div style={{ fontSize: '14px', color: '#e5e5e5', marginBottom: '3px' }}>Participant received copy of consent form</div>
          <div style={{ fontSize: FS, color: TEXT_MUTED }}>A physical or digital copy was provided to the participant</div>
        </div>
        <Toggle on={data.receivedCopy} onToggle={() => onChange({ ...data, receivedCopy: !data.receivedCopy })} />
      </div>
    </div>
  );
}

// ── Step 4 ────────────────────────────────────────────────────────────────────

function Step4Review({ s1, sensors, s3 }) {
  const included   = sensors.filter(s => s.included);
  const consented  = s3.items.filter(i => i.checked);
  const allConsent = consented.length === s3.items.length;

  function Row({ label, value, accent }) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid #161616' }}>
        <span style={{ fontSize: FS, color: TEXT_MUTED }}>{label}</span>
        <span style={{ fontSize: '14px', color: accent || '#e5e5e5' }}>{value || '—'}</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid #1a1a1a' }}>Participant Info</div>
        <Row label="Participant ID" value={s1.participantId} accent="#4ade80" />
        <Row label="Age" value={s1.age ? `${s1.age} years` : ''} />
        <Row label="Home Type" value={HOME_LABELS[s1.homeType] || ''} />
        <Row label="Study Start Date" value={s1.studyStartDate} />
        <Row label="Assigned Researcher" value={s1.assignedResearcher} />
        <Row label="Emergency Contact" value={s1.emergencyName ? `${s1.emergencyName} · ${s1.emergencyPhone}` : ''} />
      </div>

      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid #1a1a1a' }}>Sensor Assignment</div>
        <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '10px' }}>{included.length} of {sensors.length} sensors included</div>
        {included.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 0', borderBottom: '1px solid #161616' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.dotColor, marginTop: '5px', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '14px', color: '#e5e5e5' }}>{s.name}</div>
              {s.placementNote && <div style={{ fontSize: FS, color: TEXT_MUTED, marginTop: '2px' }}>{s.placementNote}</div>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid #1a1a1a' }}>Consent</div>
        <Row label="Status" value={allConsent ? 'Full consent' : `Partial — ${consented.length}/${s3.items.length} items`} accent={allConsent ? '#4ade80' : '#fb923c'} />
        <Row label="Recorded by" value={s3.recordedBy} />
        <Row label="Date recorded" value={s3.recordedDate} />
        <Row label="Copy provided" value={s3.receivedCopy ? 'Yes' : 'No'} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EnrollmentFlow({ nextId, onActivate, onCancel }) {
  const [step, setStep]     = useState(1);
  const [s1, setS1]         = useState({ participantId: nextId, age: '', homeType: '', studyStartDate: '', assignedResearcher: '', emergencyName: '', emergencyPhone: '' });
  const [sensors, setSensors] = useState(INIT_SENSORS);
  const [s3, setS3]         = useState({ items: INIT_CONSENT_ITEMS, recordedBy: '', recordedDate: '', receivedCopy: false });
  const [activating, setActivating] = useState(false);

  const goBack = () => step > 1 ? setStep(s => s - 1) : onCancel();
  const goNext = () => step < 4 && setStep(s => s + 1);

  const handleActivate = () => {
    setActivating(true);
    const allConsent = s3.items.every(i => i.checked);
    setTimeout(() => {
      onActivate({
        id: s1.participantId,
        age: parseInt(s1.age) || 0,
        fullName: `Participant ${s1.participantId}`,
        consentStatus: allConsent ? 'full' : 'partial',
        startDate: s1.studyStartDate,
        homeType: s1.homeType,
        assignedResearcher: s1.assignedResearcher,
        emergencyName: s1.emergencyName,
        emergencyPhone: s1.emergencyPhone,
        sensors: sensors.map(s => ({ id: s.id, name: s.name, included: s.included, placementNote: s.placementNote })),
        consent: { items: s3.items, recordedBy: s3.recordedBy, recordedDate: s3.recordedDate, receivedCopy: s3.receivedCopy },
        notes: '',
      });
    }, 800);
  };

  const btnGhost = { display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: '1px solid #252525', borderRadius: '6px', color: '#8e8e8e', fontSize: '14px', padding: '9px 18px', cursor: 'pointer', fontFamily: F };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', color: '#e5e5e5', fontFamily: F, display: 'flex', flexDirection: 'column', zIndex: 60 }}>
      {/* Top bar */}
      <div style={{ height: '56px', background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', padding: '0 24px', flexShrink: 0, gap: '0' }}>
        <button onClick={onCancel}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: '#8e8e8e', fontSize: '14px', cursor: 'pointer', padding: 0, fontFamily: F }}
          onMouseEnter={e => e.currentTarget.style.color = '#e5e5e5'}
          onMouseLeave={e => e.currentTarget.style.color = '#8e8e8e'}
        >
          <ChevronLeft /> Dashboard
        </button>
        <div style={{ width: '1px', height: '16px', background: '#222', margin: '0 16px' }} />
        <span style={{ fontSize: '14px', color: '#e5e5e5', fontWeight: 500 }}>Enroll New Participant</span>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: FS, color: TEXT_MUTED }}>Step {step} of 4</span>
          <div style={{ display: 'flex', gap: '5px' }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ width: i === step ? '18px' : '6px', height: '6px', borderRadius: '3px', background: i <= step ? '#4ade80' : '#252525', opacity: i < step ? 0.5 : 1, transition: 'width 0.3s, background 0.3s' }} />
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left rail */}
        <div style={{ width: '360px', flexShrink: 0, background: '#0d0d0d', borderRight: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <StepIndicator currentStep={step} />
          {step > 1 && (
            <div style={{ margin: '20px 28px 0', padding: '16px', background: '#141414', border: '1px solid #1e1e1e', borderRadius: '8px' }}>
              <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>Participant</div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: '#4ade80', marginBottom: '6px', letterSpacing: '0.04em' }}>{s1.participantId}</div>
              {s1.age && <div style={{ fontSize: FS, color: TEXT_MUTED, marginBottom: '3px' }}>Age {s1.age}</div>}
              {s1.homeType && <div style={{ fontSize: FS, color: TEXT_MUTED }}>{HOME_LABELS[s1.homeType] || s1.homeType}</div>}
              {s1.assignedResearcher && <div style={{ fontSize: FS, color: TEXT_MUTED, marginTop: '6px' }}>Researcher: {s1.assignedResearcher}</div>}
            </div>
          )}
        </div>

        {/* Form area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '24px 40px 18px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
            <div style={{ fontSize: FS, color: TEXT_MUTED, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '6px' }}>Step {step} of 4</div>
            <div style={{ fontSize: '20px', color: '#e5e5e5', fontWeight: 500 }}>{STEP_META[step - 1].label}</div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 40px' }}>
            {step === 1 && <Step1Form   data={s1}       onChange={setS1} />}
            {step === 2 && <Step2Form   sensors={sensors} onChange={setSensors} />}
            {step === 3 && <Step3Form   data={s3}       onChange={setS3} />}
            {step === 4 && <Step4Review s1={s1} sensors={sensors} s3={s3} />}
          </div>

          {/* Footer */}
          <div style={{ padding: '14px 40px', borderTop: '1px solid #1a1a1a', background: '#0d0d0d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <button onClick={goBack}
              style={btnGhost}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#e5e5e5'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = '#8e8e8e'; }}
            >
              <ChevronLeft /> {step === 1 ? 'Cancel' : 'Back'}
            </button>

            {step < 4 ? (
              <button onClick={goNext} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#4ade80', border: 'none', borderRadius: '6px', color: '#111', fontSize: '14px', fontWeight: 600, padding: '10px 22px', cursor: 'pointer', fontFamily: F }}>
                Next <ChevronRight />
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={onCancel}
                  style={btnGhost}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#e5e5e5'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = '#8e8e8e'; }}
                >
                  Save as Draft
                </button>
                <button onClick={handleActivate} disabled={activating}
                  style={{ background: activating ? '#1a3a1a' : '#4ade80', border: 'none', borderRadius: '6px', color: activating ? '#4ade80' : '#111', fontSize: '14px', fontWeight: 600, padding: '10px 28px', cursor: activating ? 'default' : 'pointer', fontFamily: F, transition: 'background 0.3s, color 0.3s' }}
                >
                  {activating ? 'Activating…' : 'Activate Participant'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
