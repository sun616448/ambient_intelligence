# Ambient Intelligence — Sensor Health Dashboard

Ambient Intelligence Researcher Dashboard is a monitoring tool designed to support ongoing research of sensor deployment in the homes of older adult participants. This dashboard focuses on the health of the data collection infrastructure itself, helping research staff determine whether sensors are online, whether data is arriving at the expected rate, and where gaps or failures have occurred. Sensor data is pulled from cloud storage every two minutes and displayed through a floor-plan interface, sensor summary views, and detailed per-sensor dashboards, allowing researchers to quickly identify devices that require attention, document field observations, and review issues reported directly by participants. The system supports a myriad of sensors, including wearables, motion detectors, vibration sensors, bed occupancy sensors, and environmental monitors. 

---

## Architecture overview

```
Sensors → GCS bucket (raw CSVs)
              ↓
          FastAPI backend (api.py)
          ├── On startup: scans GCS bucket, re-analyzes all CSVs → in-memory _gcs_results
          ├── GCS Pub/Sub webhook: re-analyzes new files as they arrive
          └── Manual upload: researchers can also upload CSVs directly from the dashboard
              ↓
          React researcher dashboard (frontend/, port 5173)
          React participant dashboard (frontend-participant/, port 5174)
```

The backend is shared. Both frontends call the same FastAPI server on port 8000.

---

## How to run

**Prerequisites:** Python 3.12+, Node 18+

```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env   # then fill in values (see Environment variables below)

# 3. Start the backend
python3 -m uvicorn api:app --port 8000

# 4. Researcher dashboard (new terminal)
cd frontend && npm install && npm run dev     # → http://localhost:5173

# 5. Participant dashboard (new terminal)
cd frontend-participant && npm install && npm run dev  # → http://localhost:5174
```

### Environment variables (`.env`)

| Variable | Required | Purpose |
|---|---|---|
| `RESIDENT_REQUESTS_SHEET_URL` | Yes | Google Sheets "Publish to web" CSV URL for the resident requests tray |
| `GCS_BUCKET_NAME` | For GCS | Google Cloud Storage bucket where sensor CSVs are uploaded |
| `GCS_PROJECT_ID` | For GCS | GCP project ID (find in Google Cloud Console) |

Changing `.env` requires a server restart — variables are read at module load time.

---

## Running gap analysis from the command line

For one-off checks without the dashboard:

```bash
# Analyze one or more sensor CSVs
python3 run.py --file heartrate.csv --file vibration.csv

# Measure against a 24-hour reference window
python3 run.py --file heartrate.csv --window-hours 24 --out-dir results/

# Run the Empatica daily check for a specific date
python3 daily_check.py --date 2026-04-17 --base-path data/1/Empatica_raw_data/participant_data
```

Output is written to `plots/` (default) or `--out-dir`: a JSON gap report + sparkline PNGs.

---

## Key files — where to start

| File | What it does |
|---|---|
| `config.py` | **Start here.** `SENSOR_CONFIG` defines every sensor type: sampling interval, gap threshold, units, aggregation strategy. All pipeline behavior flows from here. |
| `loader.py` | Parses raw sensor files into a standard 3-column DataFrame (`timestamp`, `sensor_id`, `value`). One function per *input format*, not per sensor type. |
| `gap_detector.py` | `detect_gaps()` — the core analysis function. Takes a DataFrame + sensor config, returns completeness %, gap count, gap list. |
| `visualizer.py` | NOT CALLED in FE, used during dev: Can still call runs python3 run.py for one-off analysis or batch PDF/PNG reports outside the dashboard.
Takes gap detector output, returns timeline strip and sparkline chart data for display. |
| `run.py` | CLI entry point for CSV files. Auto-detects sensor type from file headers. |
| `daily_check.py` | Batch runner for Empatica wearable data across all 16 signals and all participants for a given date. |
| `api.py` | FastAPI backend. Handles file upload, GCS integration, resident requests, consent state, and all API endpoints. |
| `avro_to_csv.py` | Converts Empatica `.avro` raw data files to CSV. Run once before using Empatica data in the pipeline. |
| `participant_config.json` | Add participants, change PINs, set initial consent. No code change needed. |
| `frontend/src/config/sensorConfig.js` | Frontend-side sensor config: display names, floor plan positions (x/y as % of image), status colors. **Also update `_SENSOR_POSITIONS` in `api.py` if you move a sensor.** |

---

## The sensor pipeline 
**Sensor type is config, not code.** Do not write a new script for a new sensor. Instead:

1. Add an entry to `SENSOR_CONFIG` in `config.py`.
2. If the file format is new, add one parser function to `loader.py`.
3. Everything else (gap detection, visualization, API response) routes automatically.

The four pipeline modules (`config → loader → gap_detector → visualizer`) are shared by all sensor types. Only the config values change.

---

## Sensor types

| Sensor | Notes |
|---|---|
| Apple Watch (heart rate) | CSV; timestamp is the DataFrame index — must use `index_col=0` |
| Geoscope (vibration) | CSV; 500 Hz — always aggregate to 1-second RMS bins before display. Never pass raw data to the frontend. |
| Empatica Embrace Plus | 16 biomarker CSVs per participant per day; manually downloaded from Empatica Care portal |
| SmartThings (motion/occupancy) | JSON event log; parser is a placeholder — structure TBD |
| All others | Light/temp, bed sensor, pressure, smart plug — standard CSV via `parse_generic_csv()` |

---

## Adding a new participant

Edit `participant_config.json`:

```json
"P003": {
  "pin": "9012",
  "floor_plan": "P003_floorplan.png",
  "sensors": [
    { "id": "motion", "label": "Motion Sensor", "consented": true }
  ]
}
```

Drop the floor plan image in `floorplans/`. No code change needed.

To update sensor floor plan positions (shared by both dashboards), edit `_SENSOR_POSITIONS` in `api.py` — it is the single source of truth for dot placement.

---

## Participant consent

- Participants toggle consent per-sensor in their dashboard (`frontend-participant/`).
- Toggles take effect immediately via `PATCH /api/participant/{id}/sensors/{sensor_id}/consent`.
- The researcher dashboard reflects consent changes within 5 seconds (polls `GET /api/consent-status`).
- Sensors with withdrawn consent appear **greyed out with a lock icon** — never hidden. Researchers must be able to see that a sensor exists but is inaccessible.
- Consent state is **in-memory only** and resets on server restart. The seed values in `participant_config.json` are re-applied each time the server starts.

---

## Resident requests tray

Participants submit issues via a Google Form. The form publishes to a Google Sheet. The backend fetches the sheet CSV and returns it via `GET /api/resident-requests`. The researcher dashboard polls this every 2 minutes.

If the form changes (new questions, renamed columns), update the column mapping in the `/api/resident-requests` route in `api.py` and update `RESIDENT_REQUESTS_SHEET_URL` in `.env`.

---

## Privacy rules

- Participant IDs (`P001`, `P002`, …) are used in all default views — never full names.
- Full name may appear only on explicit researcher drill-down behind a deliberate interaction.
- Never hide a sensor because of withdrawn consent — always show it as greyed/locked.


## Known data quirks

**Apple Watch CSV:** `pd.read_csv()` without `index_col=0` shifts all columns and parses timestamps as garbage nanoseconds. The timestamp is the DataFrame index, not a named column. Always pass `index_col=0`.

**Geoscope vibration:** 500 Hz produces ~414K rows per 14-minute window. Aggregate to 1-second RMS bins immediately after parsing. Never pass raw Geoscope data to the frontend or write it to DynamoDB.

**Empatica biomarkers:** Empatica pre-fills all 1440 minute slots for the day. Absent data appears as NaN rows, not missing rows — so `gap_count` is typically 0. Use `data_completeness_pct` as the primary signal.

**Vibration gap threshold:** Millisecond-level timing jitter at 500 Hz is normal and must not be flagged as a gap. Only interruptions > 5 seconds qualify (set in `SENSOR_CONFIG`).

**GCS results persistence:** `_gcs_results` is in-memory and resets on server restart. The lifespan handler re-scans the bucket on startup, but results will be empty until the scan completes (which may take a few minutes for large buckets).

---

## What is not yet implemented

- SmartThings JSON parser (`parse_smartthings_json` is a placeholder).
- `GET /api/daily-check` is available in the backend but not yet wired to a UI element.
- Sensor positions in the frontend are hardcoded — they are not yet pulled from per-participant configuration.
- Consent state does not persist across server restarts (in-memory only).
