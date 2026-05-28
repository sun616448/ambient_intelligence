const BASE = import.meta.env.VITE_API_URL;

export const getSensors = () =>
  fetch(`${BASE}/api/sensors`).then(r => r.json());

export const analyzeAppleWatch = (file) => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`${BASE}/api/analyze/apple-watch`, { method: "POST", body: form })
    .then(r => r.json());
};

export const analyzeGeoscope = (file) => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`${BASE}/api/analyze/geoscope`, { method: "POST", body: form })
    .then(r => r.json());
};

export const analyzeEmpatica = (file, signalType) => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`${BASE}/api/analyze/empatica?signal_type=${signalType}`, { method: "POST", body: form })
    .then(r => r.json());
};

export const analyzeEmpaticaFolder = (files) => {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  return fetch(`${BASE}/api/analyze/empatica-folder`, { method: "POST", body: form })
    .then(r => r.json());
};

export const getDailyCheck = (date, basePath) =>
  fetch(`${BASE}/api/daily-check?date=${date}&base_path=${encodeURIComponent(basePath)}`)
    .then(r => r.json());

export const getResidentRequests = () =>
  fetch(`${BASE}/api/resident-requests`).then(r => r.json());

export const getConsentStatus = () =>
  fetch(`${BASE}/api/consent-status`).then(r => r.json());

export const getTurnedOffTimestamps = () =>
  fetch(`${BASE}/api/turned-off-timestamps`).then(r => r.json());

export const getGcsResults = () =>
  fetch(`${BASE}/api/gcs/results`).then(r => r.json());

export const getBumpsSummary = () =>
  fetch(`${BASE}/api/bumps/summary`).then(r => r.ok ? r.json() : {});

export const getParticipantBumps = (pid) =>
  fetch(`${BASE}/api/participant/${pid}/bumps`).then(r => r.ok ? r.json() : []);

export const sendBump = (pid, reason, note) =>
  fetch(`${BASE}/api/participant/${pid}/bump`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, note }),
  }).then(r => { if (!r.ok) throw new Error('send failed'); return r.json(); });

export const markBumpRead = (pid, bumpId) =>
  fetch(`${BASE}/api/participant/${pid}/bumps/${bumpId}/read`, {
    method: 'PATCH',
  }).then(r => r.json());
