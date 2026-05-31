import base64
import csv
import io
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from typing import List, Optional

from dotenv import load_dotenv
load_dotenv()

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import SENSOR_CONFIG
from daily_check import run_daily_check
from gap_detector import check_sensor_live, detect_gaps
from loader import parse_apple_watch_csv, parse_empatica_biomarker_csv, parse_geoscope_csv

from contextlib import asynccontextmanager

@asynccontextmanager
async def _lifespan(app):
    # On startup: re-populate _gcs_results from the bucket so the dashboard
    # doesn't start blank after a server restart. Runs in a daemon thread so
    # the server accepts requests immediately while the scan runs in the background.
    # The frontend's 2-min poll will pick up results as they land.
    if GCS_BUCKET := os.environ.get("GCS_BUCKET_NAME", "").strip():
        import threading
        def _sync():
            try:
                from google.cloud import storage as _gcs
                client = _gcs.Client(project=os.environ.get("GCS_PROJECT_ID", "").strip() or None)
                blobs = [b for b in client.list_blobs(GCS_BUCKET) if b.name.lower().endswith(".csv")]
                for blob in blobs:
                    tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
                    try:
                        blob.download_to_filename(tmp.name)
                        tmp.close()
                        result = _analyze_file(tmp.name)
                        _gcs_results[result["sensor_id"]] = result
                    except Exception:
                        pass
                    finally:
                        try: os.unlink(tmp.name)
                        except Exception: pass
            except Exception:
                pass  # GCS unavailable at startup — dashboard will show empty until Pub/Sub fires
        threading.Thread(target=_sync, daemon=True).start()
    yield

app = FastAPI(title="Ambient Intelligence Sensor API", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_FLOORPLANS_DIR = os.path.join(os.path.dirname(__file__), "floorplans")
os.makedirs(_FLOORPLANS_DIR, exist_ok=True)
app.mount("/floorplans", StaticFiles(directory=_FLOORPLANS_DIR), name="floorplans")

_PARTICIPANT_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "participant_config.json")
with open(_PARTICIPANT_CONFIG_PATH) as _f:
    _PARTICIPANT_CONFIG = json.load(_f)

# In-memory sensor status store — updated whenever a file is analyzed.
# Keys are sensor_id strings (e.g. "heartrate", "vibration").
# Defaults to "offline" for any sensor not yet uploaded.
_sensor_status: dict = {}

# In-memory consent overrides — updated when participant toggles permission.
# Shape: { participant_id: { sensor_id: bool } }
# Seeded from participant_config.json on startup.
_consent_overrides: dict = {
    pid: {s["id"]: s.get("consented", True) for s in pdata.get("sensors", [])}
    for pid, pdata in _PARTICIPANT_CONFIG["participants"].items()
}

# Tracks when a participant actively turned a sensor off via the toggle.
# Shape: { participant_id: { sensor_id: ISO-8601 UTC string } }
# Only set on an explicit toggle-off; cleared on toggle-on; absent for never-consented sensors.
_turned_off_timestamps: dict = {}

# Bump (reminder) log — persisted to bumps.json so history survives server restarts.
# Shape: { participant_id: [ { id, timestamp, reason, note, read } ] }
_BUMPS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bumps.json")

def _load_bumps() -> dict:
    try:
        with open(_BUMPS_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _save_bumps(data: dict):
    with open(_BUMPS_PATH, "w") as f:
        json.dump(data, f, indent=2)

_bumps: dict = _load_bumps()


def _derive_status(report: dict) -> str:
    """Mirror frontend deriveStatus() in sensorConfig.js."""
    if not report or not report.get("live"):
        return "offline"
    if report.get("data_completeness_pct", 0) >= 85 and report.get("gap_count", 0) <= 2:
        return "online"
    return "gap"


class _PinBody(BaseModel):
    pin: str

class _ConsentBody(BaseModel):
    consented: bool

class _BumpBody(BaseModel):
    reason: str   # "survey_incomplete" | "sensor_off" | "custom"
    note: str = ""


# Mirrors SENSOR_DEFAULTS positions in frontend/src/config/sensorConfig.js.
# Both the researcher view and participant view read positions from here (via the API),
# so a change in one place propagates to both.
_SENSOR_POSITIONS = {

    "light_temperature":   {"x": 28, "y": 36},
    "bed_sensor":          {"x": 76, "y": 56},
    "vibration":           {"x": 38, "y": 30},
    "pressure":            {"x": 80, "y": 65},
    "motion":              {"x": 54, "y": 44},
    "surface_temperature": {"x": 45, "y": 25},
    "smart_plug":          {"x": 40, "y": 60},
    # Wearables have no floor-plan position
    "heartrate":           None,
    "wearable_light":      None,
    "empatica_pulse_rate": None,
}


def _iso(ts):
    return ts.isoformat() if ts is not None else None


def serialize_report(report):
    """Convert datetime objects in gap report to ISO strings for JSON serialization."""
    if report is None:
        return None
    r = dict(report)
    for key in ["window_start", "window_end", "latest_timestamp"]:
        if r.get(key) is not None:
            r[key] = _iso(r[key])
    r["gaps"] = [
        {**g, "start": _iso(g["start"]), "end": _iso(g["end"])}
        for g in r.get("gaps", [])
    ]
    if "not_wearing_periods" in r:
        r["not_wearing_periods"] = [
            {**p, "start": _iso(p["start"]), "end": _iso(p["end"])}
            for p in r["not_wearing_periods"]
        ]
    return r


def _rms_agg(s):
    vals = s.dropna()
    return float(np.sqrt((vals ** 2).mean())) if len(vals) > 0 else float("nan")


def build_raw_rows(df, max_rows=5000):
    """Return parsed rows as [{timestamp, sensor_id, value}], sampled if over max_rows."""
    if df.empty:
        return []
    df_sorted = df.sort_values("timestamp")
    if len(df_sorted) > max_rows:
        step = len(df_sorted) // max_rows + 1
        df_sorted = df_sorted.iloc[::step]
    return [
        {"timestamp": ts.isoformat(), "sensor_id": str(sid), "value": None if pd.isna(val) else float(val)}
        for ts, sid, val in zip(df_sorted["timestamp"], df_sorted["sensor_id"], df_sorted["value"])
    ]


def build_readings(df, cfg, max_points=200):
    """Resample df to at most max_points and return [{timestamp, value}] list."""
    if df.empty:
        return []

    df = df.sort_values("timestamp").set_index("timestamp")
    bin_sec = cfg.get("display_bin_sec", 60)
    agg = cfg.get("aggregation", "mean")

    if agg == "rms":
        binned = df["value"].resample(f"{bin_sec}s").apply(_rms_agg)
    elif agg == "binary":
        binned = df["value"].resample(f"{bin_sec}s").max()
    else:
        pandas_agg = agg if agg in ("mean", "max", "min", "sum") else "mean"
        binned = df["value"].resample(f"{bin_sec}s").agg(pandas_agg)

    if len(binned) > max_points:
        step = len(binned) // max_points + 1
        binned = binned.iloc[::step]

    return [
        {"timestamp": ts.isoformat(), "value": (None if pd.isna(v) else float(v))}
        for ts, v in binned.items()
    ]


def build_timeline(report):
    """
    Walk window_start→window_end, inserting labeled segments for gaps and
    not_wearing periods, with collecting filling everything in between.
    Called before serialize_report so datetime objects are still present.
    """
    win_start = report.get("window_start")
    win_end = report.get("window_end")
    if win_start is None or win_end is None:
        return []

    labeled = []
    for g in report.get("gaps", []):
        labeled.append((g["start"], g["end"], "gap"))

    for p in report.get("not_wearing_periods", []):
        labeled.append((p["start"], p["end"], "not_wearing"))

    labeled.sort(key=lambda x: x[0])

    segments = []
    cursor = win_start

    for seg_start, seg_end, state in labeled:
        seg_start = max(seg_start, win_start)
        seg_end = min(seg_end, win_end)
        if seg_start >= seg_end:
            continue
        if cursor < seg_start:
            segments.append({
                "start": _iso(cursor),
                "end": _iso(seg_start),
                "state": "collecting",
            })
        segments.append({
            "start": _iso(seg_start),
            "end": _iso(seg_end),
            "state": state,
        })
        cursor = seg_end

    if cursor < win_end:
        segments.append({
            "start": _iso(cursor),
            "end": _iso(win_end),
            "state": "collecting",
        })

    return segments


def _analyze(df, cfg, gap_kwargs=None):
    """Run gap detection + live check and return a combined report dict."""
    gap_kwargs = gap_kwargs or {}
    report = detect_gaps(df, cfg, **gap_kwargs)
    live = check_sensor_live(df, cfg)
    report["live"] = live["live"]
    report["lag_sec"] = live["lag_sec"]
    report["latest_timestamp"] = live["latest_timestamp"]
    return report


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def get_health():
    return {"status": "ok"}


@app.get("/api/sensors")
def get_sensors():
    result = []
    for k, v in SENSOR_CONFIG.items():
        entry = {"sensor_type": k}
        for field, val in v.items():
            entry[field] = list(val) if isinstance(val, tuple) else val
        result.append(entry)
    return result


@app.post("/api/analyze/apple-watch")
async def analyze_apple_watch(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        df = parse_apple_watch_csv(tmp_path)
        cfg = SENSOR_CONFIG["heartrate"]
        report = _analyze(df, cfg)
        _sensor_status[report["sensor_id"]] = _derive_status(report)
        timeline = build_timeline(report)
        readings = build_readings(df, cfg)
        raw_rows = build_raw_rows(df)
        return {**serialize_report(report), "readings": readings, "timeline": timeline, "raw_rows": raw_rows}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        os.unlink(tmp_path)


@app.post("/api/analyze/geoscope")
async def analyze_geoscope(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        df = parse_geoscope_csv(tmp_path)
        cfg = SENSOR_CONFIG["vibration"]
        # parse_geoscope_csv already bins to 1-second RMS; pass that as the effective interval
        report = _analyze(df, cfg, gap_kwargs={"aggregated_interval_sec": 1})
        _sensor_status[report["sensor_id"]] = _derive_status(report)
        timeline = build_timeline(report)
        readings = build_readings(df, cfg)
        raw_rows = build_raw_rows(df)
        return {**serialize_report(report), "readings": readings, "timeline": timeline, "raw_rows": raw_rows}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        os.unlink(tmp_path)


@app.post("/api/analyze/empatica")
async def analyze_empatica(
    file: UploadFile = File(...),
    signal_type: str = Query(..., description="SENSOR_CONFIG key, e.g. empatica_pulse_rate"),
):
    if signal_type not in SENSOR_CONFIG:
        raise HTTPException(status_code=400, detail=f"Unknown signal_type: {signal_type}")
    cfg = SENSOR_CONFIG[signal_type]
    if "signal_col" not in cfg:
        raise HTTPException(status_code=400, detail=f"{signal_type} is not an Empatica signal type")

    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        df = parse_empatica_biomarker_csv(tmp_path, signal_col=cfg["signal_col"], sensor_id=signal_type)

        # Anchor the window to the calendar day of the data, not just the data span.
        # Empatica pre-fills all 1440 minute slots, so without a fixed window the
        # completeness calculation would always read ~100% even on a partial day.
        win_start = win_end = None
        if not df.empty:
            day_str = df["timestamp"].min().strftime("%Y-%m-%d")
            win_start = pd.Timestamp(f"{day_str}T00:00:00Z")
            win_end = win_start + pd.Timedelta(hours=24)

        report = _analyze(df, cfg, gap_kwargs={"window_start": win_start, "window_end": win_end})
        _sensor_status[report["sensor_id"]] = _derive_status(report)
        timeline = build_timeline(report)
        readings = build_readings(df, cfg)
        raw_rows = build_raw_rows(df)
        return {**serialize_report(report), "readings": readings, "timeline": timeline, "raw_rows": raw_rows}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        os.unlink(tmp_path)


@app.post("/api/analyze/empatica-folder")
async def analyze_empatica_folder(files: List[UploadFile] = File(...)):
    """
    Accept all CSV files from an Empatica aggregated_per_minute folder and
    auto-detect which signal each file contains by matching the source_file
    suffix in SENSOR_CONFIG (e.g. '_pulse-rate.csv' → empatica_pulse_rate).
    Returns a dict of signal_type → gap report + readings + timeline.
    """
    # Build a lookup from filename suffix → (sensor_type, config) so each uploaded
    # file self-identifies by its name (e.g. "_pulse-rate.csv" → empatica_pulse_rate)
    # without the caller having to specify the type for every file in the folder.
    source_map = {
        cfg["source_file"]: (stype, cfg)
        for stype, cfg in SENSOR_CONFIG.items()
        if "signal_col" in cfg
    }

    signals = {}
    unmatched = []

    for upload in files:
        fname = upload.filename or ""
        matched_key = next(
            (src for src in source_map if fname.endswith(f"_{src}.csv") or fname == f"{src}.csv"),
            None,
        )
        if matched_key is None:
            unmatched.append(fname)
            continue

        stype, cfg = source_map[matched_key]

        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
            tmp.write(await upload.read())
            tmp_path = tmp.name

        try:
            df = parse_empatica_biomarker_csv(tmp_path, signal_col=cfg["signal_col"], sensor_id=stype)

            win_start = win_end = None
            if not df.empty:
                day_str = df["timestamp"].min().strftime("%Y-%m-%d")
                win_start = pd.Timestamp(f"{day_str}T00:00:00Z")
                win_end = win_start + pd.Timedelta(hours=24)

            report = _analyze(df, cfg, gap_kwargs={"window_start": win_start, "window_end": win_end})
            _sensor_status[report["sensor_id"]] = _derive_status(report)
            timeline = build_timeline(report)
            readings = build_readings(df, cfg)
            raw_rows = build_raw_rows(df)
            signals[stype] = {**serialize_report(report), "readings": readings, "timeline": timeline, "raw_rows": raw_rows}
        except Exception as e:
            signals[stype] = {"error": str(e)}
        finally:
            os.unlink(tmp_path)

    return {"signals": signals, "unmatched": unmatched}


_SHEET_URL = os.environ.get("RESIDENT_REQUESTS_SHEET_URL", "").strip()

GCS_BUCKET = os.environ.get("GCS_BUCKET_NAME", "").strip()
GCS_PROJECT = os.environ.get("GCS_PROJECT_ID", "").strip() or None

# In-memory store for GCS-processed results. Keyed by sensor_id.
# Polled by the dashboard every 2 min via GET /api/gcs/results.
_gcs_results: dict = {}


# ---------------------------------------------------------------------------
# GCS helpers
# ---------------------------------------------------------------------------

def _gcs_download(bucket_name: str, blob_path: str) -> str:
    """Download a GCS blob to a temp file and return the temp path."""
    from google.cloud import storage as _gcs
    client = _gcs.Client(project=GCS_PROJECT)
    blob = client.bucket(bucket_name).blob(blob_path)
    suffix = os.path.splitext(blob_path)[1] or ".csv"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    blob.download_to_filename(tmp.name)
    tmp.close()
    return tmp.name


def _analyze_file(tmp_path: str, sensor_type: str | None = None) -> dict:
    """
    Auto-detect sensor type (or use the provided one), run the full pipeline,
    and return the same response envelope as the /api/analyze/* endpoints.
    """
    from run import detect_sensor_type, _SENSOR_ROUTES

    if sensor_type is None:
        sensor_type = detect_sensor_type(tmp_path)
        if sensor_type is None:
            raise ValueError(
                "Could not auto-detect sensor type from file headers. "
                "Pass ?sensor_type=heartrate (or other type) to override."
            )

    if sensor_type not in SENSOR_CONFIG:
        raise ValueError(f"Unknown sensor_type: {sensor_type}")

    cfg = SENSOR_CONFIG[sensor_type]
    route = _SENSOR_ROUTES[sensor_type]
    df = route["parser"](tmp_path)

    gap_kwargs = dict(route.get("gap_kwargs", {}))
    if sensor_type.startswith("empatica_") and not df.empty:
        day_str = df["timestamp"].min().strftime("%Y-%m-%d")
        win_start = pd.Timestamp(f"{day_str}T00:00:00Z")
        gap_kwargs.update(window_start=win_start, window_end=win_start + pd.Timedelta(hours=24))

    report = _analyze(df, cfg, gap_kwargs=gap_kwargs)
    _sensor_status[report["sensor_id"]] = _derive_status(report)
    return {
        **serialize_report(report),
        "readings": build_readings(df, cfg),
        "timeline": build_timeline(report),
        "raw_rows": build_raw_rows(df),
        "detected_sensor_type": sensor_type,
    }


# ---------------------------------------------------------------------------
# GCS endpoints
# ---------------------------------------------------------------------------

@app.post("/api/gcs/analyze")
def gcs_analyze(
    bucket: str = Query(default=None, description="GCS bucket name (overrides GCS_BUCKET_NAME env var)"),
    file: str = Query(..., description="Path to the file inside the bucket, e.g. P001/2026-05-22/heartrate.csv"),
    sensor_type: str = Query(default=None, description="Force sensor type; auto-detected from headers if omitted"),
):
    """
    Download a file from GCS and run the gap analysis pipeline on it.
    Use this to test GCS integration: upload a file to your bucket, then call this endpoint.
    """
    bucket_name = bucket or GCS_BUCKET
    if not bucket_name:
        raise HTTPException(status_code=400, detail="Provide ?bucket=... or set GCS_BUCKET_NAME in .env")
    tmp_path = _gcs_download(bucket_name, file)
    try:
        result = _analyze_file(tmp_path, sensor_type=sensor_type)
        _gcs_results[result["sensor_id"]] = result
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


@app.post("/api/gcs/pubsub")
async def gcs_pubsub(request: Request):
    """
    Webhook for GCS Pub/Sub push notifications.
    Wire this up in Google Cloud Console:
      GCS bucket → Pub/Sub topic → push subscription → POST /api/gcs/pubsub
    The endpoint auto-processes any .csv file that lands in the bucket.
    """
    body = await request.json()
    message = body.get("message", {})
    data_b64 = message.get("data", "")
    if not data_b64:
        return {"status": "ignored", "reason": "empty message data"}

    try:
        data = json.loads(base64.b64decode(data_b64).decode("utf-8"))
    except Exception:
        return {"status": "ignored", "reason": "could not decode message"}

    bucket_name = data.get("bucket")
    blob_path = data.get("name", "")

    if not bucket_name or not blob_path:
        return {"status": "ignored", "reason": "missing bucket or name in message"}

    if not blob_path.lower().endswith(".csv"):
        return {"status": "ignored", "reason": f"not a CSV: {blob_path}"}

    tmp_path = _gcs_download(bucket_name, blob_path)
    try:
        result = _analyze_file(tmp_path)
        _gcs_results[result["sensor_id"]] = result
        return {"status": "processed", "bucket": bucket_name, "file": blob_path, "sensor_type": result.get("detected_sensor_type")}
    except ValueError as e:
        return {"status": "skipped", "reason": str(e), "file": blob_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


@app.get("/api/gcs/results")
def get_gcs_results():
    """Return all GCS-processed sensor results. Polled by the dashboard every 2 min."""
    return _gcs_results


@app.post("/api/gcs/sync")
def gcs_sync(
    bucket: str = Query(default=None, description="GCS bucket (overrides GCS_BUCKET_NAME)"),
    prefix: str = Query(default="", description="Only process files under this prefix"),
):
    """
    Scan the bucket for all CSV files and process any that can be auto-detected.
    Call this after uploading a batch of files to sync everything at once.
    """
    bucket_name = bucket or GCS_BUCKET
    if not bucket_name:
        raise HTTPException(status_code=400, detail="Provide ?bucket=... or set GCS_BUCKET_NAME in .env")

    from google.cloud import storage as _gcs
    client = _gcs.Client(project=GCS_PROJECT)
    blobs = [b for b in client.list_blobs(bucket_name, prefix=prefix) if b.name.lower().endswith(".csv")]

    processed, skipped, errors = [], [], []

    for blob in blobs:
        tmp_path = None
        try:
            suffix = os.path.splitext(blob.name)[1] or ".csv"
            tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            blob.download_to_filename(tmp.name)
            tmp.close()
            tmp_path = tmp.name

            result = _analyze_file(tmp_path)
            _gcs_results[result["sensor_id"]] = result
            processed.append({"file": blob.name, "sensor_type": result["detected_sensor_type"]})
        except ValueError as e:
            skipped.append({"file": blob.name, "reason": str(e)})
        except Exception as e:
            errors.append({"file": blob.name, "error": str(e)})
        finally:
            if tmp_path:
                os.unlink(tmp_path)

    return {"processed": processed, "skipped": skipped, "errors": errors}


@app.get("/api/resident-requests")
def get_resident_requests():
    if not _SHEET_URL:
        return []
    try:
        req = urllib.request.Request(_SHEET_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))
        results = []
        for i, row in enumerate(reader):
            # Normalize all keys to lowercase and deduplicate repeated headers.
            # The Google Form has several question variants depending on request type,
            # so the same column header can appear multiple times. We keep the first
            # non-empty value for each key.
            norm = {}
            for k, v in row.items():
                if not k:
                    continue
                key = k.strip().lower()
                val = v.strip()
                if key not in norm or (val and not norm[key]):
                    norm[key] = val
            # The form shows a different free-text question depending on the request type
            # (issue, scheduling, etc). Walk through all possibilities and use the first
            # one that has a value.

            description = next(
                (norm.get(col, "") for col in [
                    "what issue are you experiencing?",
                    "please describe your request and a member of the team will contact you shortly",
                    "what information are you looking for?",
                    "what scheduling change do you need?",
                    "what type of concern are you reporting?",
                    "what information would you like to update?",
                    'please provide the date and/or time you will be away. if you would prefer to speak with a member of the research team, please type "call" below.',
                ] if norm.get(col, "")),
                "",
            )
            results.append({
                "id": f"R{i + 1:03d}",
                "participantId": norm.get("full name", norm.get("participant id", "")),
                "sensorName": norm.get("what device are you having trouble with?", norm.get("sensor name", "")),
                "description": description,
                "dateSubmitted": norm.get("timestamp", norm.get("date", "")),
                "status": norm.get("status", "Pending"),
                "requestType": norm.get("what can we help you with today?", ""),
                "contactMethod": norm.get("preferred method of contact", ""),
                "contactTime": norm.get("best time to contact you", ""),
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch sheet: {e}")


@app.post("/api/participant/login")
def participant_login(body: _PinBody):
    for pid, pdata in _PARTICIPANT_CONFIG["participants"].items():
        if pdata["pin"] == body.pin.strip():
            return {"participant_id": pid, "floor_plan": pdata.get("floor_plan")}
    raise HTTPException(status_code=401, detail="Invalid PIN")


@app.get("/api/participant/{participant_id}/sensors")
def get_participant_sensors(participant_id: str):
    pdata = _PARTICIPANT_CONFIG["participants"].get(participant_id)
    if not pdata:
        raise HTTPException(status_code=404, detail="Participant not found")
    p_consent = _consent_overrides.get(participant_id, {})
    sensors = [
        {
            **s,
            "position": _SENSOR_POSITIONS.get(s["id"]),
            "consented": p_consent.get(s["id"], s.get("consented", True)),
            # status is None (not "offline") when consent is withdrawn — the participant
            # app uses None to render a lock icon rather than a red offline dot.
            "status": _sensor_status.get(s["id"], "offline") if p_consent.get(s["id"], s.get("consented", True)) else None,
        }
        for s in pdata.get("sensors", [])
    ]
    return {
        "participant_id": participant_id,
        "floor_plan": pdata.get("floor_plan"),
        "sensors": sensors,
    }


@app.patch("/api/participant/{participant_id}/sensors/{sensor_id}/consent")
def update_consent(participant_id: str, sensor_id: str, body: _ConsentBody):
    if participant_id not in _PARTICIPANT_CONFIG["participants"]:
        raise HTTPException(status_code=404, detail="Participant not found")
    _consent_overrides.setdefault(participant_id, {})[sensor_id] = body.consented
    pid_ts = _turned_off_timestamps.setdefault(participant_id, {})
    if body.consented:
        # Clear the timestamp so the researcher view stops showing "turned off by participant".
        pid_ts.pop(sensor_id, None)
    else:
        # Record when the participant toggled off — surfaced in the researcher view as
        # "Turned off by participant at [time]" on the sensor card.
        pid_ts[sensor_id] = datetime.now(timezone.utc).isoformat()
    return {"participant_id": participant_id, "sensor_id": sensor_id, "consented": body.consented}


@app.get("/api/consent-status")
def get_consent_status():
    result = {}
    for pid, sensors in _consent_overrides.items():
        ts_map = _turned_off_timestamps.get(pid, {})
        result[pid] = {
            sid: {"consented": consented, "turned_off_at": ts_map.get(sid) if not consented else None}
            for sid, consented in sensors.items()
        }
    return result


@app.get("/api/turned-off-timestamps")
def get_turned_off_timestamps():
    return _turned_off_timestamps


@app.post("/api/participant/{participant_id}/bump")
def send_bump(participant_id: str, body: _BumpBody):
    bumps_for_p = _bumps.setdefault(participant_id, [])
    bump = {
        "id": f"B{len(bumps_for_p) + 1:04d}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "reason": body.reason,
        "note": body.note,
        "read": False,
    }
    bumps_for_p.append(bump)
    _save_bumps(_bumps)
    return bump


@app.get("/api/participant/{participant_id}/bumps")
def get_bumps(participant_id: str):
    if participant_id not in _PARTICIPANT_CONFIG["participants"]:
        raise HTTPException(status_code=404, detail="Participant not found")
    return list(reversed(_bumps.get(participant_id, [])))


@app.patch("/api/participant/{participant_id}/bumps/{bump_id}/read")
def mark_bump_read(participant_id: str, bump_id: str):
    for b in _bumps.get(participant_id, []):
        if b["id"] == bump_id:
            b["read"] = True
            _save_bumps(_bumps)
            return b
    raise HTTPException(status_code=404, detail="Bump not found")


@app.get("/api/bumps/summary")
def get_bumps_summary():
    result = {}
    for pid, lst in _bumps.items():
        result[pid] = {
            "total": len(lst),
            "unread": sum(1 for b in lst if not b["read"]),
            "latest": lst[-1] if lst else None,
        }
    return result


@app.get("/api/daily-check")
def get_daily_check(
    date: str = Query(..., description="Date to analyse (YYYY-MM-DD)"),
    base_path: str = Query(..., description="Path to participant_data directory"),
    window_hours: float = Query(24.0, description="Analysis window in hours from midnight"),
):
    try:
        reports = run_daily_check(date, base_path, window_hours=window_hours)
        return reports
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
