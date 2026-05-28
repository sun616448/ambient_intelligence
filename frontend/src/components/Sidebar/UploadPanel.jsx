import { useState, useRef } from 'react';
import { analyzeAppleWatch, analyzeGeoscope, analyzeEmpatica, analyzeEmpaticaFolder } from '../../api/client';
import { EMPATICA_SIGNALS } from '../../config/sensorConfig';
import { A11Y_THEME } from '../../styles/accessibilityTheme';

const F = "'SF Pro Display', 'Helvetica Neue', sans-serif";
const FS = A11Y_THEME.fontMin;
const TEXT_PRIMARY = A11Y_THEME.textPrimary;
const TEXT_MUTED = A11Y_THEME.textMuted;

const SENSOR_TYPES = [
  { value: 'apple-watch',   label: 'Apple Watch HR' },
  { value: 'geoscope',      label: 'Geoscope Vibration' },
  { value: 'empatica',      label: 'Empatica (Wearable)' },
];

// Maps upload type → the sensor id that gets updated in app state
const UPLOAD_TO_SENSOR_ID = {
  'apple-watch': 'heartrate',
  'geoscope':    'vibration',
};

export function UploadPanel({ onResult, onClose }) {
  const [sensorType, setSensorType] = useState('apple-watch');
  const [signalType, setSignalType] = useState(EMPATICA_SIGNALS[0].value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      if (sensorType === 'apple-watch') {
        const result = await analyzeAppleWatch(files[0]);
        if (result.detail) throw new Error(result.detail);
        onResult('heartrate', result);
      } else if (sensorType === 'geoscope') {
        const result = await analyzeGeoscope(files[0]);
        if (result.detail) throw new Error(result.detail);
        onResult('vibration', result);
      } else {
        // Folder upload — send all CSV files to the batch endpoint
        const csvFiles = Array.from(files).filter(f => f.name.endsWith('.csv'));
        if (csvFiles.length === 0) throw new Error('No CSV files found in the selected folder');
        const result = await analyzeEmpaticaFolder(csvFiles);
        if (result.detail) throw new Error(result.detail);
        const matched = Object.entries(result.signals || {});
        if (matched.length === 0) throw new Error('No Empatica signals matched in the selected folder');
        for (const [sensorId, data] of matched) {
          if (!data.error) onResult(sensorId, data);
        }
        const errors = matched.filter(([, d]) => d.error).map(([s, d]) => `${s}: ${d.error}`);
        if (errors.length) setError(`Some signals failed: ${errors.join('; ')}`);
      }
    } catch (err) {
      setError(err.message ?? 'Upload failed');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ background: '#161616', borderBottom: '1px solid #222', padding: '12px 14px', fontFamily: F }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontSize: FS, fontWeight: 600, color: TEXT_PRIMARY }}>Upload Sensor Data</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = TEXT_PRIMARY}
          onMouseLeave={e => e.currentTarget.style.color = TEXT_MUTED}
        >×</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <select
          value={sensorType}
          onChange={e => setSensorType(e.target.value)}
          style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: '6px', color: TEXT_PRIMARY, fontSize: FS, padding: '6px 8px', fontFamily: F, width: '100%' }}
        >
          {SENSOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {sensorType === 'empatica' && (
          <div style={{ fontSize: FS, color: TEXT_MUTED, background: '#1a1a1a', border: '1px solid #252525', borderRadius: '6px', padding: '6px 8px' }}>
            All 16 signals detected automatically from folder
          </div>
        )}

        <label style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '6px', padding: '8px', borderRadius: '6px', cursor: loading ? 'not-allowed' : 'pointer',
          background: '#1e2e1e', border: '1px solid #2a3e2a', color: loading ? TEXT_MUTED : '#4ade80',
          fontSize: FS, fontWeight: 500, fontFamily: F,
        }}>
          {loading ? 'Analyzing…' : sensorType === 'empatica' ? 'Choose aggregated_per_minute folder' : 'Choose CSV file'}
          {sensorType === 'empatica' ? (
            <input
              key="folder"
              ref={fileRef}
              type="file"
              webkitdirectory=""
              multiple
              disabled={loading}
              onChange={handleFile}
              style={{ display: 'none' }}
            />
          ) : (
            <input
              key="file"
              ref={fileRef}
              type="file"
              accept=".csv"
              disabled={loading}
              onChange={handleFile}
              style={{ display: 'none' }}
            />
          )}
        </label>

        {error && <div style={{ fontSize: FS, color: '#f87171', background: '#1e0e0e', border: '1px solid #3a1a1a', borderRadius: '5px', padding: '6px 8px' }}>{error}</div>}
      </div>
    </div>
  );
}
