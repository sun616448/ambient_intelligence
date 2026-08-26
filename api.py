import base64
import binascii
import csv
import io
import json
import logging
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

import gcs_store
import redis_store
import state
from config import SENSOR_CONFIG
from daily_check import run_daily_check
from gap_detector import check_sensor_live, detect_gaps
from loader import parse_apple_watch_csv, parse_empatica_biomarker_csv, parse_geoscope_csv

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("api")

from contextlib import asynccontextmanager

@asynccontextmanager
async def _lifespan(app):
    # There is deliberately no startup bucket scan any more.
    #
    # The old version spawned a thread that re-downloaded and re-analysed every
    # CSV in the bucket, purely to refill an in-memory dict that a restart had
    # emptied. That cannot work on a serverless host — there is no long-lived
    # process for it to run in, and a cold start per request would re-scan the
    # bucket every time.
    #
    # Analysis results now live in the bucket (see gcs_store.write_summary), so
    # a fresh instance is already current the moment it boots. Re-analysis is
    # driven by new files arriving, not by the server starting.
    log.info(
        "starting: state backend=%s bucket=%s",
        state.backend_name(),
        gcs_store.bucket_name() or "<unset>",
    )
    if not gcs_store.is_configured():
        log.warning(
            "GCS_BUCKET_NAME is not set — running with in-memory state. "
            "Results and consent toggles will be lost on restart."
        )
    yield

app = FastAPI(title="Ambient Intelligence Sensor API", lifespan=_lifespan)

# Once the API is reachable on the public internet, "*" means any page on any
# site can call it from a visitor's browser. Set ALLOWED_ORIGINS to the two
# frontend URLs in production; the wildcard default keeps local development and
# the current deployments working unchanged.
_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Floor plan images ship inside the deployment bundle, so this only ever needs
# to read. exist_ok is not enough on a read-only filesystem — makedirs still
# raises if the directory is genuinely absent — so the mount is conditional.
_FLOORPLANS_DIR = os.path.join(os.path.dirname(__file__), "floorplans")
try:
    os.makedirs(_FLOORPLANS_DIR, exist_ok=True)
except OSError as _e:
    log.warning("floorplans directory is not writable: %s", _e)

if os.path.isdir(_FLOORPLANS_DIR):
    app.mount("/floorplans", StaticFiles(directory=_FLOORPLANS_DIR), name="floorplans")
else:
    log.warning("no floorplans directory at %s — /floorplans not mounted", _FLOORPLANS_DIR)

# Loaded via state.load_participant_config so there is one reader: it prefers
# the PARTICIPANT_CONFIG_JSON environment variable and falls back to the local
# file. The roster holds participant login PINs and is therefore not committed.
_PARTICIPANT_CONFIG = state.load_participant_config()

# Sensor status, consent, turned-off timestamps, bumps and analysis results all
# used to be module-level dicts here. They now live in state.py, which keeps
# them in the bucket when one is configured and in memory when one is not.
# See the module docstring there for why: a serverless instance starts empty,
# so anything held at module scope is invisible to the next request.


def _sensor_status_map() -> dict:
    """Latest status per sensor_id, derived from the stored summaries."""
    return {
        sensor_id: _derive_status(envelope)
        for sensor_id, envelope in state.read_summary_index().items()
    }


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


def _persist_envelope(report: dict, df, cfg: dict, extra: dict | None = None) -> dict:
    """
    Assemble the standard response envelope and store it.

    Every path that analyses a file ends here — a researcher upload, a Pub/Sub
    notification, a bucket sync — so all three behave the same way: the result
    reaches the dashboard and survives a restart, rather than only existing in
    the response to whoever triggered it.
    """
    envelope = {
        **serialize_report(report),
        "readings": build_readings(df, cfg),
        "timeline": build_timeline(report),
        "raw_rows": build_raw_rows(df),
        **(extra or {}),
    }

    try:
        state.put_summary(report["sensor_id"], envelope)
    except Exception as e:
        # The caller already waited for this analysis; hand it back even if it
        # could not be stored. But record the failure on the envelope as well as
        # in the logs — a sync that stores nothing must not report success, or
        # the dashboard serves stale numbers with no indication anything broke.
        log.exception("could not persist summary for %s", report["sensor_id"])
        envelope["_persist_error"] = f"{type(e).__name__}: {e}".splitlines()[0][:300]

    return envelope


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
        return _persist_envelope(report, df, cfg)
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
        return _persist_envelope(report, df, cfg)
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
        return _persist_envelope(report, df, cfg)
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
            signals[stype] = _persist_envelope(report, df, cfg)
        except Exception as e:
            signals[stype] = {"error": str(e)}
        finally:
            os.unlink(tmp_path)

    return {"signals": signals, "unmatched": unmatched}


_SHEET_URL = os.environ.get("RESIDENT_REQUESTS_SHEET_URL", "").strip()

# ---------------------------------------------------------------------------
# GCS ingest
# ---------------------------------------------------------------------------
#
# Three ways a file in the bucket becomes a dashboard entry, all landing in the
# same _analyze_file -> _persist_envelope path:
#
#   POST /api/gcs/pubsub    a push notification, seconds after the file lands.
#                           The primary path once deployed.
#   POST /api/gcs/sync      scan the bucket. Incremental by default, so a repeat
#                           run only picks up what changed. Used by the cron
#                           reconciliation and by hand during local testing,
#                           where Pub/Sub cannot reach a laptop.
#   POST /api/gcs/analyze   one named file, for debugging a specific object.


def _require_bucket(override: str | None = None) -> str:
    name = override or gcs_store.bucket_name()
    if not name:
        raise HTTPException(
            status_code=400,
            detail="Provide ?bucket=... or set GCS_BUCKET_NAME in the environment",
        )
    return name


def _verify_pubsub_token(request: Request) -> None:
    """
    Reject Pub/Sub deliveries that did not come from Google.

    Without this the endpoint is an open write to the dashboard: anyone who
    learns the URL can POST a crafted message and have the server fetch and
    publish an arbitrary object as sensor data. That was tolerable while the API
    only listened on localhost and is not once it is on the public internet.

    Configure the push subscription with an OIDC service account and set
    PUBSUB_AUDIENCE to the endpoint URL. If PUBSUB_VERIFY is explicitly set to
    "0", verification is skipped — only appropriate for local testing.
    """
    if os.environ.get("PUBSUB_VERIFY", "1") == "0":
        log.warning("Pub/Sub token verification is disabled (PUBSUB_VERIFY=0)")
        return

    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="google-auth is required to verify Pub/Sub tokens",
        )

    audience = os.environ.get("PUBSUB_AUDIENCE", "").strip() or None
    try:
        claims = id_token.verify_oauth2_token(
            auth.removeprefix("Bearer "), google_requests.Request(), audience
        )
    except ValueError as e:
        log.warning("rejected Pub/Sub delivery: %s", e)
        raise HTTPException(status_code=401, detail="Invalid token")

    expected_sa = os.environ.get("PUBSUB_SERVICE_ACCOUNT", "").strip()
    if expected_sa and claims.get("email") != expected_sa:
        log.warning("rejected Pub/Sub delivery from %s", claims.get("email"))
        raise HTTPException(status_code=403, detail="Unexpected service account")


def _process_blob(blob_name: str, bucket_override: str | None = None) -> dict:
    """Download one blob, analyse it, store the result. Temp file always removed."""
    tmp_path = gcs_store.download_to_temp(blob_name, bucket_override=bucket_override)
    try:
        return _analyze_file(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/api/gcs/analyze")
def gcs_analyze(
    bucket: str = Query(default=None, description="GCS bucket name (overrides GCS_BUCKET_NAME)"),
    file: str = Query(..., description="Path to the file inside the bucket"),
    sensor_type: str = Query(default=None, description="Override auto-detection"),
):
    """Analyse one named object. Useful for checking a specific file by hand."""
    bucket_name = _require_bucket(bucket)
    tmp_path = gcs_store.download_to_temp(file, bucket_override=bucket_name)
    try:
        result = _analyze_file(tmp_path, sensor_type=sensor_type)
        return {"status": "processed", "bucket": bucket_name, "file": file, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/api/gcs/pubsub")
async def gcs_pubsub(request: Request):
    """
    Push endpoint for GCS object notifications.

        bucket -> Pub/Sub topic -> push subscription -> POST here

    Returns 2xx for messages it deliberately ignores (non-CSV, reserved paths),
    because a non-2xx tells Pub/Sub to redeliver, and retrying a file that will
    never be processable just loops.
    """
    _verify_pubsub_token(request)

    body = await request.json()
    message = body.get("message", {})
    data_b64 = message.get("data", "")
    if not data_b64:
        return {"status": "ignored", "reason": "empty message data"}

    try:
        data = json.loads(base64.b64decode(data_b64).decode("utf-8"))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return {"status": "ignored", "reason": "could not decode message"}

    bucket_name = data.get("bucket")
    blob_path = data.get("name", "")

    if not bucket_name or not blob_path:
        return {"status": "ignored", "reason": "missing bucket or name in message"}

    # Writing a summary triggers another notification for that summary object.
    # Skipping reserved paths is what stops the bucket notifying itself in a loop.
    if gcs_store.is_reserved(blob_path):
        return {"status": "ignored", "reason": "reserved path"}

    if not blob_path.lower().endswith(".csv"):
        return {"status": "ignored", "reason": f"not a CSV: {blob_path}"}

    try:
        result = _process_blob(blob_path, bucket_override=bucket_name)
    except ValueError as e:
        # Unrecognised format. Redelivering will not help, so acknowledge it.
        log.info("skipping %s: %s", blob_path, e)
        return {"status": "skipped", "reason": str(e), "file": blob_path}
    except Exception:
        # A transient fault. Fail loudly so Pub/Sub retries.
        log.exception("failed to process %s", blob_path)
        raise HTTPException(status_code=500, detail=f"failed to process {blob_path}")

    log.info("processed %s as %s", blob_path, result.get("detected_sensor_type"))
    return {
        "status": "processed",
        "bucket": bucket_name,
        "file": blob_path,
        "sensor_type": result.get("detected_sensor_type"),
    }


@app.get("/api/gcs/results")
def get_gcs_results():
    """
    Every analysed sensor, keyed by sensor_id. Polled by the dashboard.

    raw_rows is deliberately absent — see /api/gcs/results/{sensor_id}.
    """
    try:
        return state.read_summary_index()
    except Exception:
        log.exception("could not read summary index")
        raise HTTPException(status_code=502, detail="Could not read stored summaries")


@app.get("/api/gcs/results/{sensor_id}")
def get_gcs_result(sensor_id: str):
    """
    One sensor's full envelope, including raw_rows.

    raw_rows runs to 5000 rows per sensor and is only rendered in the detail
    modal's collapsible table, so it is fetched when that modal opens rather
    than included in the poll that runs every two minutes for every sensor.
    """
    try:
        envelope = state.read_summary(sensor_id)
    except Exception:
        log.exception("could not read summary for %s", sensor_id)
        raise HTTPException(status_code=502, detail="Could not read stored summary")

    if envelope is None:
        raise HTTPException(status_code=404, detail=f"No stored result for {sensor_id}")
    return envelope


@app.post("/api/gcs/sync")
def gcs_sync(
    bucket: str = Query(default=None, description="GCS bucket (overrides GCS_BUCKET_NAME)"),
    prefix: str = Query(default="", description="Only process files under this prefix"),
    full: bool = Query(default=False, description="Re-process every file, ignoring the watermark"),
):
    """
    Scan the bucket and process sensor CSVs.

    Incremental by default: only objects modified since the last successful sync
    are downloaded, so running this on a schedule stays cheap as the bucket
    grows. Pass full=true to rebuild everything from scratch.
    """
    bucket_name = _require_bucket(bucket)
    started_at = datetime.now(timezone.utc)

    watermark = None if full else state.read_sync_watermark()
    try:
        blobs = gcs_store.list_csv_blobs(prefix=prefix, updated_after=watermark)
    except Exception as e:
        log.exception("could not list bucket %s", bucket_name)
        raise HTTPException(status_code=502, detail=f"Could not list bucket: {e}")

    processed, skipped, errors = [], [], []

    for blob in blobs:
        try:
            result = _process_blob(blob.name, bucket_override=bucket_name)
            processed.append({"file": blob.name, "sensor_type": result["detected_sensor_type"]})
        except ValueError as e:
            skipped.append({"file": blob.name, "reason": str(e)})
        except Exception as e:
            log.exception("failed to process %s", blob.name)
            errors.append({"file": blob.name, "error": str(e)})

    # Only advance the watermark if nothing failed. Moving it past a file that
    # errored would mean the next incremental run never retries it.
    if not errors:
        try:
            state.write_sync_watermark(started_at)
        except Exception:
            log.exception("could not write sync watermark")

    log.info(
        "sync: %d processed, %d skipped, %d errors (incremental=%s)",
        len(processed), len(skipped), len(errors), watermark is not None,
    )
    return {
        "bucket": bucket_name,
        "incremental": watermark is not None,
        "considered": len(blobs),
        "processed": processed,
        "skipped": skipped,
        "errors": errors,
    }


# GET as well as POST: platform schedulers (Vercel Cron, Cloud Scheduler's
# default) issue a GET, while a human testing it by hand reaches for POST.
@app.get("/api/cron/sync")
@app.post("/api/cron/sync")
def cron_sync(request: Request):
    """
    Scheduled reconciliation, invoked by the platform scheduler.

    Pub/Sub is the primary ingest path; this catches anything a dropped or failed
    delivery missed. Guarded by CRON_SECRET so a public URL is not an open
    invitation to trigger a full bucket scan.
    """
    secret = os.environ.get("CRON_SECRET", "").strip()
    if secret:
        if request.headers.get("authorization") != f"Bearer {secret}":
            raise HTTPException(status_code=401, detail="Unauthorized")
    else:
        log.warning("CRON_SECRET is not set — /api/cron/sync is unauthenticated")

    return gcs_sync(bucket=None, prefix="", full=False)


@app.post("/api/gcs/sync-geoscope")
def gcs_sync_geoscope(
    window_hours: float = Query(2.0, description="How far back to analyse"),
    max_files_per_sensor: int = Query(200, description="Cap on files pulled per sensor"),
    upload_lag_minutes: float = Query(20.0, description="Allowance for gateway upload delay"),
):
    """
    Analyse a rolling window of Geoscope uploads, one report per device.

    The gateway writes a file roughly every two minutes, so a file is not a
    dataset the way a CSV export is — treating each one separately would give
    every sensor a two-minute report that the next file immediately overwrote.
    Instead the files covering the window are concatenated and analysed once, and
    completeness is measured against the window rather than the file.

    The window is also the cost control. There are ~68,000 objects and 19 GB in
    this bucket; a full sweep is not something a request should ever attempt.
    """
    if not gcs_store.is_configured():
        raise HTTPException(status_code=400, detail="GCS_BUCKET_NAME is not set")

    from loader import parse_geoscope_json

    window_end = datetime.now(timezone.utc)
    window_start = window_end - pd.Timedelta(hours=window_hours)

    # Files are selected by upload time but samples are filtered by the time they
    # were recorded, and the gateway uploads several minutes after the fact. Cast
    # a wider net when listing so the window is fully covered at both ends;
    # without this the first minutes of the window sit in a file uploaded before
    # window_start and are missed, which reads as data loss that never happened.
    upload_lookback = pd.Timedelta(minutes=upload_lag_minutes)
    grouped = gcs_store.list_recent_geoscope_blobs(
        window_start - upload_lookback, window_end
    )
    if not grouped:
        return {
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
            "sensors": {},
            "note": "no Geoscope uploads in this window",
        }

    cfg = SENSOR_CONFIG["vibration"]
    results, truncated = {}, {}

    for sensor_dir, blobs in sorted(grouped.items()):
        if len(blobs) > max_files_per_sensor:
            truncated[sensor_dir] = {"available": len(blobs), "used": max_files_per_sensor}
            blobs = blobs[-max_files_per_sensor:]   # keep the most recent

        frames, failed = [], 0
        for blob in blobs:
            tmp = gcs_store.download_to_temp(blob.name)
            try:
                frames.append(parse_geoscope_json(tmp))
            except Exception:
                failed += 1
                log.exception("could not parse %s", blob.name)
            finally:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass

        frames = [f for f in frames if not f.empty]
        if not frames:
            results[sensor_dir] = {"error": "no parseable files", "files": len(blobs)}
            continue

        df = pd.concat(frames, ignore_index=True).sort_values("timestamp")
        df = df[(df["timestamp"] >= window_start) & (df["timestamp"] <= window_end)]
        if df.empty:
            results[sensor_dir] = {"error": "no samples inside window", "files": len(blobs)}
            continue

        # The tail of the window has not been uploaded yet, so measuring
        # completeness against wall-clock `now` would charge every sensor for the
        # gateway's upload delay and report a healthy device at ~80%. Completeness
        # is measured up to the newest sample actually in hand; whether the sensor
        # has stopped is what `live` and `lag_sec` are for, and they still compare
        # against real time.
        latest_sample = df["timestamp"].max()
        effective_end = min(window_end, latest_sample)
        upload_lag_sec = (window_end - latest_sample).total_seconds()

        report = _analyze(
            df, cfg,
            gap_kwargs={
                "aggregated_interval_sec": 1,
                "window_start": window_start,
                "window_end": effective_end,
            },
        )
        envelope = _persist_envelope(report, df, cfg, extra={"detected_sensor_type": "vibration"})
        results[sensor_dir] = {
            "sensor_id": report["sensor_id"],
            "stored": "_persist_error" not in envelope,
            **({"store_error": envelope["_persist_error"]} if "_persist_error" in envelope else {}),
            "files": len(blobs),
            "unparseable_files": failed,
            "rows": len(df),
            "analysed_through": effective_end.isoformat(),
            "upload_lag_sec": round(upload_lag_sec, 1),
            "data_completeness_pct": report["data_completeness_pct"],
            "gap_count": report["gap_count"],
            "longest_gap_sec": report["longest_gap_sec"],
            "live": report["live"],
            "lag_sec": report["lag_sec"],
        }

    log.info("geoscope sync: %d sensors over %sh", len(results), window_hours)
    return {
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "window_hours": window_hours,
        "sensors": results,
        # Surfaced rather than silently dropped: a capped sensor is reporting on
        # less than the window asked for.
        "truncated": truncated,
    }


@app.post("/api/gcs/reindex")
def gcs_reindex():
    """Rebuild _summaries/_index.json from the per-sensor objects."""
    if not gcs_store.is_configured():
        raise HTTPException(status_code=400, detail="GCS_BUCKET_NAME is not set")
    return gcs_store.rebuild_summary_index()


@app.get("/api/gcs/status")
def gcs_status():
    """
    Whether the GCS connection actually works, and why not if it does not.

    The previous version swallowed every credential and bucket error silently,
    so a wrong bucket name looked exactly like an empty bucket. This is the
    first thing to call after setting the environment variables.
    """
    info = {
        "configured": gcs_store.is_configured(),
        "bucket": gcs_store.bucket_name(),
        "project": gcs_store.project_id(),
        # GCS is read-only in the default setup; state lives in Redis. This
        # reports where state actually goes so a misconfiguration is visible
        # here rather than as summaries that quietly never update.
        "state": redis_store.ping() if state.using_redis() else {"backend": state.backend_name()},
        "credentials": (
            "GCS_CREDENTIALS_B64" if os.environ.get("GCS_CREDENTIALS_B64", "").strip()
            else "GOOGLE_APPLICATION_CREDENTIALS" if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
            else "application-default"
        ),
    }

    if not info["configured"]:
        info["reachable"] = False
        info["error"] = "GCS_BUCKET_NAME is not set"
        return info

    try:
        # Scoped to a single day: this bucket holds ~68,000 objects and a full
        # walk on a health check would take tens of seconds.
        gateways = gcs_store.list_gateway_prefixes()
        info["gateways"] = gateways
        now = datetime.now(timezone.utc)
        recent = gcs_store.list_recent_geoscope_blobs(
            now - pd.Timedelta(hours=24), now, gateway_prefixes=gateways
        )
        info["reachable"] = True
        info["sensors_last_24h"] = {k: len(v) for k, v in sorted(recent.items())}
        newest = max((b for v in recent.values() for b in v),
                     key=lambda b: b.updated, default=None)
        info["newest_object"] = newest.name if newest else None
        info["newest_object_at"] = newest.updated.isoformat() if newest else None
        info["summarised_sensors"] = sorted(state.read_summary_index().keys())
        # Only relevant when GCS is being used as the state store. With Redis
        # holding state the GCS credential needs read access and nothing more.
        if state.using_gcs():
            info["write_access"] = gcs_store.check_write_access()
        watermark = state.read_sync_watermark()
        info["last_synced_at"] = watermark.isoformat() if watermark else None
    except Exception as e:
        info["reachable"] = False
        info["error"] = f"{type(e).__name__}: {e}"

    return info


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
    p_consent = state.read_consent()["overrides"].get(participant_id, {})
    status_map = _sensor_status_map()
    sensors = [
        {
            **s,
            "position": _SENSOR_POSITIONS.get(s["id"]),
            "consented": p_consent.get(s["id"], s.get("consented", True)),
            # status is None (not "offline") when consent is withdrawn — the participant
            # app uses None to render a lock icon rather than a red offline dot.
            "status": status_map.get(s["id"], "offline") if p_consent.get(s["id"], s.get("consented", True)) else None,
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
    # state.set_consent records the toggle and, when turning off, the moment it
    # happened — the researcher view renders that as "Turned off by participant
    # at [time]". Turning back on clears it.
    state.set_consent(participant_id, sensor_id, body.consented)
    return {"participant_id": participant_id, "sensor_id": sensor_id, "consented": body.consented}


@app.get("/api/consent-status")
def get_consent_status():
    consent = state.read_consent()
    result = {}
    for pid, sensors in consent["overrides"].items():
        ts_map = consent["turned_off"].get(pid, {})
        result[pid] = {
            sid: {"consented": consented, "turned_off_at": ts_map.get(sid) if not consented else None}
            for sid, consented in sensors.items()
        }
    return result


@app.get("/api/turned-off-timestamps")
def get_turned_off_timestamps():
    return state.read_consent()["turned_off"]


@app.post("/api/participant/{participant_id}/bump")
def send_bump(participant_id: str, body: _BumpBody):
    existing = state.read_bumps().get(participant_id, [])
    bump = {
        "id": f"B{len(existing) + 1:04d}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "reason": body.reason,
        "note": body.note,
        "read": False,
    }
    state.append_bump(participant_id, bump)
    return bump


@app.get("/api/participant/{participant_id}/bumps")
def get_bumps(participant_id: str):
    if participant_id not in _PARTICIPANT_CONFIG["participants"]:
        raise HTTPException(status_code=404, detail="Participant not found")
    return list(reversed(state.read_bumps().get(participant_id, [])))


@app.patch("/api/participant/{participant_id}/bumps/{bump_id}/read")
def mark_bump_read(participant_id: str, bump_id: str):
    updated = state.mark_bump_read(participant_id, bump_id)
    for b in updated.get(participant_id, []):
        if b["id"] == bump_id:
            return b
    raise HTTPException(status_code=404, detail="Bump not found")


@app.get("/api/bumps/summary")
def get_bumps_summary():
    result = {}
    for pid, lst in state.read_bumps().items():
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
