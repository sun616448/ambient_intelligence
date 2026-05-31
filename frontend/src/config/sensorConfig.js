// Default floor-plan positions and display names for each sensor type.
// After the API loads, these are merged with live config data.
export const SENSOR_DEFAULTS = [
  // Time-series sensors with floor plan positions

  { id: 'light_temperature',   name: 'Light & Temp Sensor',      room: 'Various',        position: { x: 28, y: 36 } },
  { id: 'bed_sensor',          name: 'Bed Sensor',               room: 'Bedroom',        position: { x: 76, y: 56 } },
  { id: 'vibration',           name: 'Vibration Sensor',         room: 'Various',        position: { x: 38, y: 30 } },
  { id: 'pressure',            name: 'Pressure Sensor',          room: 'Bedroom',        position: { x: 80, y: 65 } },
  { id: 'motion',              name: 'Motion / Presence',        room: 'Living Room',    position: { x: 54, y: 44 } },
  { id: 'surface_temperature', name: 'Surface Temp Logger',      room: 'Various',        position: { x: 45, y: 25 } },
  { id: 'heartrate',           name: 'Wearable Sensor (Watch)',  room: 'Wearable',       position: { x: 70, y: 62 } },
  { id: 'smart_plug',          name: 'Smart Plug',               room: 'Various',        position: { x: 40, y: 60 } },

  // No floor plan dot — wearable or infrastructure
  { id: 'actigraph',           name: 'Actigraph LEAP',           room: 'Wearable',       position: { x: 65, y: 20 }, noFloorPlan: true },
  { id: 'wearable_light',      name: 'Wearable Light Sensor',    room: 'Wearable',       position: { x: 60, y: 20 }, noFloorPlan: true },
  { id: 'usb_power',           name: 'USB Power Cord',           room: 'Infrastructure', position: { x: 50, y: 50 }, noFloorPlan: true },
  { id: 'recording_signage',   name: 'Recording Signage',        room: 'Various',        position: { x: 50, y: 50 }, noFloorPlan: true },

  // Empatica wearable group
  { id: 'empatica_pulse_rate', name: 'Empatica (Wearable)',      room: 'Wearable',       position: { x: 55, y: 18 }, wearable: true },
];

export const STATUS_COLOR = {
  online:  '#4ade80',
  gap:     '#fb923c',
  offline: '#f87171',
  'consent-withdrawn': '#555555',
};

export const STATUS_LABEL = {
  online:  'Online',
  gap:     'Data Gap',
  offline: 'Offline',
  'consent-withdrawn': 'Consent Withdrawn',
};

export const CARD_BG = {
  online:  { background: '#0f1a0f', border: '#1e2e1e' },
  gap:     { background: '#1a1508', border: '#3a2a10' },
  offline: { background: '#1a0f0f', border: '#3a1a1a' },
  'consent-withdrawn': { background: '#161616', border: '#2a2a2a' },
};

// Empatica signal options shown in the upload panel
export const EMPATICA_SIGNALS = [
  { value: 'empatica_pulse_rate',         label: 'Pulse Rate' },
  { value: 'empatica_temperature',        label: 'Temperature' },
  { value: 'empatica_wearing_detection',  label: 'Wearing Detection' },
  { value: 'empatica_eda',               label: 'EDA (Electrodermal Activity)' },
  { value: 'empatica_prv',               label: 'PRV (Heart Rate Variability)' },
  { value: 'empatica_respiratory_rate',   label: 'Respiratory Rate' },
  { value: 'empatica_step_counts',        label: 'Step Counts' },
  { value: 'empatica_met',               label: 'MET (Energy Expenditure)' },
  { value: 'empatica_activity_counts',    label: 'Activity Counts' },
  { value: 'empatica_accelerometers_std', label: 'Accelerometer Std' },
  { value: 'empatica_sleep_detection',    label: 'Sleep Detection' },
  { value: 'empatica_actigraphy_counts',      label: 'Actigraphy Counts' },
  { value: 'empatica_acticounts',             label: 'Acticounts (Y-axis)' },
  { value: 'empatica_activity_classification', label: 'Activity Classification' },
  { value: 'empatica_activity_intensity',     label: 'Activity Intensity' },
  { value: 'empatica_body_position',          label: 'Body Position' },
];


// Sensors managed via their own apps — excluded from all researcher views.
export const CAMERA_IDS = new Set(['wyze_camera', 'depth_camera']);

export function deriveStatus(report) {
  if (!report) return 'offline';
  if (!report.live) return 'offline';
  if (report.data_completeness_pct >= 85 && report.gap_count <= 2) return 'online';
  return 'gap';
}
