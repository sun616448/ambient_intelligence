import { useState, useEffect, useMemo } from 'react';
import { getSensors, getResidentRequests, getConsentStatus, getGcsResults, getBumpsSummary } from '../api/client';
import { FloorPlan } from '../components/FloorPlan/FloorPlan';
import { AllSensorsView } from '../components/AllSensors/AllSensorsView';
import { SensorList } from '../components/Sidebar/SensorList';
import { SensorModal } from '../components/SensorModal/SensorModal';
import { ParticipantPanel } from '../components/Participants/ParticipantPanel';
import { ParticipantDetailsModal } from '../components/Participants/ParticipantDetailsModal';
import { EnrollmentFlow } from '../components/Participants/EnrollmentFlow';
import { SENSOR_DEFAULTS, deriveStatus } from '../config/sensorConfig';
import { A11Y_THEME } from '../styles/accessibilityTheme';

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";
const FS = A11Y_THEME.fontMin;
const TEXT_MUTED = A11Y_THEME.textMuted;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;

const DEFAULT_CONSENT_ITEMS = [
  { id: 'motion',   label: 'Motion sensing in all rooms',     checked: true  },
  { id: 'wearable', label: 'Wearable device during sleep',    checked: false },
  { id: 'video',    label: 'Video recording in common areas', checked: false },
  { id: 'env',      label: 'Environmental monitoring',        checked: true  },
  { id: 'sharing',  label: 'Data sharing with research team', checked: true  },
  { id: 'pub',      label: 'Anonymous data publication',      checked: true  },
];

const INITIAL_PARTICIPANTS = [
  {
    id: 'P001', age: 72, fullName: 'Margaret Anderson', consentStatus: 'full',
    startDate: '2025-09-01', homeType: 'one-bed', assignedResearcher: 'Dr. R. Chen',
    emergencyName: 'Susan Anderson', emergencyPhone: '+1 555 012 3456',
    sensors: [
      { id: 'motion',   name: 'Motion Sensor',       included: true,  placementNote: 'Living room, NE corner' },
      { id: 'door',     name: 'Door / Window Sensor', included: true,  placementNote: 'Front door' },
      { id: 'bed',      name: 'Bed Occupancy',        included: true,  placementNote: 'Under mattress, left side' },
      { id: 'kitchen',  name: 'Kitchen Activity',     included: true,  placementNote: 'Cabinet above stove' },
      { id: 'bathroom', name: 'Bathroom Usage',       included: true,  placementNote: 'Vanity cabinet' },
      { id: 'wearable', name: 'Wearable Device',      included: false, placementNote: '' },
      { id: 'env',      name: 'Environmental',        included: true,  placementNote: 'Bedroom nightstand' },
    ],
    consent: { items: DEFAULT_CONSENT_ITEMS.map(i => ({ ...i, checked: true })), recordedBy: 'Dr. R. Chen', recordedDate: '2025-08-28', receivedCopy: true },
    notes: '',
  },
  {
    id: 'P002', age: 68, fullName: 'Robert Chen', consentStatus: 'partial',
    startDate: '2025-09-15', homeType: 'studio', assignedResearcher: 'Dr. M. Torres',
    emergencyName: 'Linda Chen', emergencyPhone: '+1 555 098 7654',
    sensors: [
      { id: 'motion',   name: 'Motion Sensor',       included: true,  placementNote: 'Main room, ceiling mount' },
      { id: 'door',     name: 'Door / Window Sensor', included: true,  placementNote: 'Entry door' },
      { id: 'bed',      name: 'Bed Occupancy',        included: true,  placementNote: 'Under mattress' },
      { id: 'kitchen',  name: 'Kitchen Activity',     included: false, placementNote: '' },
      { id: 'bathroom', name: 'Bathroom Usage',       included: true,  placementNote: 'Mirror cabinet' },
      { id: 'wearable', name: 'Wearable Device',      included: false, placementNote: '' },
      { id: 'env',      name: 'Environmental',        included: true,  placementNote: 'Near window' },
    ],
    consent: { items: DEFAULT_CONSENT_ITEMS, recordedBy: 'Dr. M. Torres', recordedDate: '2025-09-10', receivedCopy: true },
    notes: '',
  },
  {
    id: 'P003', age: 75, fullName: 'Dorothy Williams', consentStatus: 'full',
    startDate: '2025-10-01', homeType: 'two-bed', assignedResearcher: 'Dr. R. Chen',
    emergencyName: 'James Williams', emergencyPhone: '+1 555 234 5678',
    sensors: [
      { id: 'motion',   name: 'Motion Sensor',       included: true,  placementNote: 'Hallway, central' },
      { id: 'door',     name: 'Door / Window Sensor', included: true,  placementNote: 'Front door + patio' },
      { id: 'bed',      name: 'Bed Occupancy',        included: true,  placementNote: 'Primary bedroom' },
      { id: 'kitchen',  name: 'Kitchen Activity',     included: true,  placementNote: 'Pantry shelf' },
      { id: 'bathroom', name: 'Bathroom Usage',       included: true,  placementNote: 'Under sink' },
      { id: 'wearable', name: 'Wearable Device',      included: true,  placementNote: '' },
      { id: 'env',      name: 'Environmental',        included: true,  placementNote: 'Living room' },
    ],
    consent: { items: DEFAULT_CONSENT_ITEMS.map(i => ({ ...i, checked: true })), recordedBy: 'Dr. R. Chen', recordedDate: '2025-09-25', receivedCopy: true },
    notes: '',
  },
  {
    id: 'P004', age: 81, fullName: 'James Thompson', consentStatus: 'withdrawn',
    startDate: '2025-10-10', homeType: 'one-bed', assignedResearcher: 'Dr. M. Torres',
    emergencyName: 'Carol Thompson', emergencyPhone: '+1 555 876 5432',
    sensors: [
      { id: 'motion',   name: 'Motion Sensor',       included: true,  placementNote: '' },
      { id: 'door',     name: 'Door / Window Sensor', included: true,  placementNote: '' },
      { id: 'bed',      name: 'Bed Occupancy',        included: false, placementNote: '' },
      { id: 'kitchen',  name: 'Kitchen Activity',     included: true,  placementNote: '' },
      { id: 'bathroom', name: 'Bathroom Usage',       included: false, placementNote: '' },
      { id: 'wearable', name: 'Wearable Device',      included: false, placementNote: '' },
      { id: 'env',      name: 'Environmental',        included: true,  placementNote: '' },
    ],
    consent: { items: DEFAULT_CONSENT_ITEMS.map(i => ({ ...i, checked: false })), recordedBy: 'Dr. M. Torres', recordedDate: '2025-10-08', receivedCopy: true },
    notes: 'Withdrew consent 2025-11-20. All sensors deactivated.',
  },
  {
    id: 'P005', age: 69, fullName: 'Helen Martinez', consentStatus: 'full',
    startDate: '2025-11-01', homeType: 'one-bed', assignedResearcher: 'Dr. R. Chen',
    emergencyName: 'Marco Martinez', emergencyPhone: '+1 555 345 6789',
    sensors: [
      { id: 'motion',   name: 'Motion Sensor',       included: true,  placementNote: 'Living room corner' },
      { id: 'door',     name: 'Door / Window Sensor', included: true,  placementNote: 'Front door' },
      { id: 'bed',      name: 'Bed Occupancy',        included: true,  placementNote: 'Under mattress' },
      { id: 'kitchen',  name: 'Kitchen Activity',     included: true,  placementNote: 'Above microwave' },
      { id: 'bathroom', name: 'Bathroom Usage',       included: true,  placementNote: 'Cabinet top' },
      { id: 'wearable', name: 'Wearable Device',      included: false, placementNote: '' },
      { id: 'env',      name: 'Environmental',        included: true,  placementNote: 'Bedroom' },
    ],
    consent: { items: DEFAULT_CONSENT_ITEMS.map(i => ({ ...i, checked: true })), recordedBy: 'Dr. R. Chen', recordedDate: '2025-10-28', receivedCopy: true },
    notes: '',
  },
];

function buildInitialSensors() {
  return SENSOR_DEFAULTS.map(def => ({
    ...def,
    status: 'offline',
    lastActive: null,
    report: null,
    readings: [],
    timeline: [],
    rawRows: [],
  }));
}

function nextParticipantId(participants) {
  const nums = participants.map(p => parseInt(p.id.replace(/\D/g, ''), 10)).filter(Boolean);
  const max  = nums.length ? Math.max(...nums) : 0;
  return `P${String(max + 1).padStart(3, '0')}`;
}

export default function Dashboard() {
  const [participants, setParticipants]   = useState(INITIAL_PARTICIPANTS);
  const [selectedPId, setSelectedPId]     = useState(null);
  const [showEnroll, setShowEnroll]       = useState(false);
  const [detailParticipant, setDetailParticipant] = useState(null);

  const [sensors, setSensors]             = useState(buildInitialSensors);
  const [selectedSensor, setSelected]     = useState(null);
  const [requests, setRequests]           = useState([]);
  const [consentStatus, setConsentStatus] = useState({});
  const [viewMode, setViewMode]           = useState('floorplan'); // 'floorplan' | 'all-sensors'
  const [bumpSummary, setBumpSummary]     = useState({});

  const [editLocation, setEditLocation]   = useState(null);

  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);

  useEffect(() => {
    getSensors()
      .then(() => setLoading(false))
      .catch(() => {
        setError('Cannot reach API — is the FastAPI server running on port 8000?');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const fetchRequests = () => getResidentRequests().then(setRequests).catch(() => {});
    fetchRequests();
    const interval = setInterval(fetchRequests, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchConsent = () => getConsentStatus().then(setConsentStatus).catch(() => {});
    fetchConsent();
    const interval = setInterval(fetchConsent, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchBumps = () => getBumpsSummary().then(setBumpSummary).catch(() => {});
    fetchBumps();
    const interval = setInterval(fetchBumps, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchGcsResults = () =>
      getGcsResults()
        .then(results => {
          Object.entries(results).forEach(([sensorId, data]) => {
            handleUploadResult(sensorId, data);
          });
        })
        .catch(() => {});
    fetchGcsResults();
    const interval = setInterval(fetchGcsResults, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleUploadResult = (sensorId, data) => {
    setSensors(prev => {
      const exists = prev.find(s => s.id === sensorId);
      const updated = {
        status: deriveStatus(data),
        lastActive: data.latest_timestamp ?? null,
        report: data,
        readings: data.readings ?? [],
        timeline: data.timeline ?? [],
        rawRows: data.raw_rows ?? [],
      };
      if (exists) return prev.map(s => s.id === sensorId ? { ...s, ...updated } : s);
      const isWearable = sensorId.startsWith('empatica_');
      return [...prev, { id: sensorId, name: sensorId.replace(/_/g, ' '), room: 'Wearable', position: { x: Math.random() * 60 + 20, y: Math.random() * 60 + 20 }, wearable: isWearable, ...updated }];
    });
  };

  // Merge consent + turned-off timestamps into sensor objects.
  // consentStatus shape: { pid: { sid: { consented: bool, turned_off_at: str | null } } }
  // turnedOffAt aggregated across ALL participants so it shows without requiring participant selection.
  const displaySensors = useMemo(() => {
    const turnedOffBySensor = {};
    for (const ptData of Object.values(consentStatus)) {
      for (const [sid, info] of Object.entries(ptData)) {
        if (info.turned_off_at && (!turnedOffBySensor[sid] || info.turned_off_at > turnedOffBySensor[sid])) {
          turnedOffBySensor[sid] = info.turned_off_at;
        }
      }
    }

    const pc = selectedPId ? (consentStatus[selectedPId] ?? {}) : {};
    return sensors.map(s => {
      const info = pc[s.id];
      const consented = info ? info.consented : (s.consented ?? true);
      return { ...s, consented, turnedOffAt: turnedOffBySensor[s.id] ?? null };
    });
  }, [sensors, selectedPId, consentStatus]);

  const selectedData = selectedSensor ? displaySensors.find(s => s.id === selectedSensor.id) : null;

  const handleEditStart = () => {
    if (!selectedData) return;
    setEditLocation({
      sensorId:  selectedData.id,
      room:      selectedData.room,
      xStr:      String(selectedData.position.x),
      yStr:      String(selectedData.position.y),
      mode:      'click',
      minimized: true,
    });
  };

  const handleEditChange = (updates) =>
    setEditLocation(prev => prev ? { ...prev, ...updates } : null);

  const handleEditSave = () => {
    if (!editLocation) return;
    const x = Math.min(100, Math.max(0, parseFloat(editLocation.xStr)));
    const y = Math.min(100, Math.max(0, parseFloat(editLocation.yStr)));
    setSensors(prev => prev.map(s => s.id === editLocation.sensorId ? {
      ...s,
      room:     editLocation.room.trim() || s.room,
      position: { x: isNaN(x) ? s.position.x : x, y: isNaN(y) ? s.position.y : y },
    } : s));
    setEditLocation(null);
    setSelected(null);
  };

  const handleEditCancel = () => setEditLocation(null);

  const handleFloorPlanPlace = (x, y) => {
    setEditLocation(prev => {
      if (!prev || prev.mode !== 'click') return prev;
      return { ...prev, xStr: String(x), yStr: String(y), minimized: true };
    });
  };

  const handleNotesUpdate = (participantId, notes) => {
    setParticipants(prev => prev.map(p => p.id === participantId ? { ...p, notes } : p));
    setDetailParticipant(prev => prev?.id === participantId ? { ...prev, notes } : prev);
  };

  const handleActivate = (newParticipant) => {
    setParticipants(prev => [...prev, newParticipant]);
    setShowEnroll(false);
  };

  if (loading) return (
    <div style={{ width: '100vw', height: '100vh', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F }}>
      <div style={{ color: TEXT_MUTED, fontSize: FS }}>Connecting to API…</div>
    </div>
  );

  if (error) return (
    <div style={{ width: '100vw', height: '100vh', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F }}>
      <div style={{ color: '#f87171', fontSize: '14px', maxWidth: '400px', textAlign: 'center', lineHeight: 1.6 }}>{error}</div>
    </div>
  );

  return (
    <>
      <div style={{ width: '100vw', height: '100vh', background: '#111', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: F }}>

        {/* ── Top nav ───────────────────────────────────────────────────── */}
        <div style={{
          height: '44px', flexShrink: 0,
          background: '#0d0d0d', borderBottom: '1px solid #1e1e1e',
          display: 'flex', alignItems: 'center', padding: '0 16px',
          gap: '2px',
        }}>
          {[
            { id: 'floorplan',   label: 'Floor Plan' },
            { id: 'all-sensors', label: 'All Sensors' },
          ].map(tab => {
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id)}
                style={{
                  padding: '5px 13px', borderRadius: '6px', cursor: 'pointer',
                  fontFamily: F, fontSize: FS, fontWeight: active ? 600 : 400,
                  background: active ? '#1e1e1e' : 'transparent',
                  border: active ? '1px solid #2e2e2e' : '1px solid transparent',
                  color: active ? TEXT_PRIMARY : TEXT_MUTED,
                  transition: 'color 0.12s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = TEXT_PRIMARY; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = TEXT_MUTED; }}
              >
                {tab.label}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: FS, color: TEXT_MUTED, letterSpacing: '0.04em' }}>
            Ambient Intelligence Study
          </span>
        </div>

        {/* ── Content area ──────────────────────────────────────────────── */}
        {viewMode === 'floorplan' ? (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <ParticipantPanel
              participants={participants}
              selectedId={selectedPId}
              onSelect={setSelectedPId}
              onEnroll={() => setShowEnroll(true)}
              onViewDetails={p => setDetailParticipant(p)}
              bumpSummary={bumpSummary}
            />
            <FloorPlan
              sensors={displaySensors}
              onSensorClick={s => setSelected(s)}
              editLocation={editLocation}
              onFloorPlanPlace={handleFloorPlanPlace}
            />
            <SensorList
              sensors={displaySensors}
              requests={requests}
              onSensorClick={s => setSelected(s)}
              onUploadResult={handleUploadResult}
            />
          </div>
        ) : (
          <AllSensorsView
            sensors={displaySensors}
            onSensorClick={s => setSelected(s)}
            participants={participants}
            selectedPId={selectedPId}
          />
        )}
      </div>

      {selectedData && (
        <SensorModal
          sensor={selectedData}
          sensorData={selectedData.report ? { report: selectedData.report, readings: selectedData.readings, timeline: selectedData.timeline, rawRows: selectedData.rawRows } : null}
          onClose={() => { setSelected(null); setEditLocation(null); }}
          editLocation={editLocation?.sensorId === selectedData.id ? editLocation : null}
          onEditStart={handleEditStart}
          onEditChange={handleEditChange}
          onEditSave={handleEditSave}
          onEditCancel={handleEditCancel}
        />
      )}

      {showEnroll && (
        <EnrollmentFlow
          nextId={nextParticipantId(participants)}
          onActivate={handleActivate}
          onCancel={() => setShowEnroll(false)}
        />
      )}

      {detailParticipant && (
        <ParticipantDetailsModal
          participant={detailParticipant}
          onClose={() => setDetailParticipant(null)}
          onNotesUpdate={handleNotesUpdate}
          onBumpSent={() => getBumpsSummary().then(setBumpSummary).catch(() => {})}
        />
      )}
    </>
  );
}
