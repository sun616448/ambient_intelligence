"""
Runtime state that has to outlive a single request.

`api.py` used to hold all of this in module-level dicts. That works when there is
exactly one long-lived process, which is true on a laptop and on Cloud Run, and
false on Vercel: functions are ephemeral and horizontally scaled, so every
instance starts empty and two researchers can be served by two different
instances holding different data. Concretely, the symptoms were that
`/api/gcs/results` returned `{}` for one visitor and data for another, and that
participant consent toggles reverted at random.

So state lives in the bucket. Two backends, picked automatically:

    redis    when Upstash credentials are present — the normal deployed setup
    gcs      when GCS_STATE_BUCKET is set explicitly — an alternative for a
             single-cloud deployment; never the sensor bucket by default
    memory   when neither is — kept so the app still runs locally with nothing
             configured, and so the tests need no services

Redis is the default because it keeps GCS strictly read-only. The sensor bucket
is a regulated dataset, so the GCS credential should only ever need
object-viewer; writing dashboard state into it would require the delete
permission that overwriting an object implies, and would put derived state
inside the research data.
"""

import base64
import binascii
import json
import logging
import os
import threading
from datetime import datetime, timezone

import gcs_store
import redis_store

log = logging.getLogger("state")

_HERE = os.path.dirname(os.path.abspath(__file__))
_PARTICIPANT_CONFIG_PATH = os.path.join(_HERE, "participant_config.json")
_LOCAL_BUMPS_PATH = os.path.join(_HERE, "bumps.json")

_lock = threading.Lock()

# Memory-backend stores. Unused when GCS is configured.
_mem_consent: dict | None = None
_mem_bumps: dict | None = None
_mem_summaries: dict = {}


def using_redis() -> bool:
    return redis_store.is_configured()


def using_gcs() -> bool:
    """
    GCS as a *state* store, which is opt-in via GCS_STATE_BUCKET.

    Deliberately not triggered by GCS_BUCKET_NAME alone: that names the bucket
    sensor data is read from, and writing state there is exactly what this
    design avoids.
    """
    return not using_redis() and bool(os.environ.get("GCS_STATE_BUCKET", "").strip())


def backend_name() -> str:
    if using_redis():
        return "redis"
    return "gcs" if using_gcs() else "memory"


# ---------------------------------------------------------------------------
# Seeds
# ---------------------------------------------------------------------------


def load_participant_config() -> dict:
    """
    Participant roster: login PINs, floor plans, and sensor lists.

    Read from the PARTICIPANT_CONFIG_JSON environment variable when set, falling
    back to the local participant_config.json file.

    The environment variable exists because this data contains participant login
    PINs, which must not be committed — the repository is public, and once a PIN
    is in git history removing the file does not unpublish it. Keeping the roster
    in the environment means the deployed API has it and the repository does not.

    The file fallback keeps local development working with no extra setup.
    Accepts raw JSON or base64-encoded JSON, since shells and dashboards mangle
    quoting in different ways.
    """
    raw = os.environ.get("PARTICIPANT_CONFIG_JSON", "").strip()
    if raw:
        if not raw.startswith("{"):
            try:
                raw = base64.b64decode(raw).decode("utf-8")
            except (binascii.Error, ValueError, UnicodeDecodeError) as e:
                raise RuntimeError(
                    "PARTICIPANT_CONFIG_JSON is neither JSON nor valid base64."
                ) from e
        try:
            return json.loads(raw)
        except ValueError as e:
            raise RuntimeError("PARTICIPANT_CONFIG_JSON is not valid JSON.") from e

    try:
        with open(_PARTICIPANT_CONFIG_PATH) as f:
            return json.load(f)
    except FileNotFoundError as e:
        # Loud and specific: this is the expected failure on a deployment where
        # the file was correctly left out of the bundle but the environment
        # variable was never set.
        raise RuntimeError(
            "No participant config. Set PARTICIPANT_CONFIG_JSON in the "
            "environment, or provide participant_config.json locally. "
            "Generate the value with: "
            "base64 -i participant_config.json | tr -d '\\n'"
        ) from e


# Backwards-compatible internal alias.
_participant_config = load_participant_config


def _seed_consent() -> dict:
    """
    Initial consent state, from participant_config.json.

    Used the first time the app runs against a bucket with no consent object yet.
    After that the stored object wins — the config file is a seed, not a source
    of truth, so a participant's live toggle is never silently reverted by a
    redeploy.
    """
    cfg = _participant_config()
    return {
        "overrides": {
            pid: {s["id"]: s.get("consented", True) for s in pdata.get("sensors", [])}
            for pid, pdata in cfg["participants"].items()
        },
        "turned_off": {},
    }


# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------


def read_consent() -> dict:
    """`{"overrides": {pid: {sid: bool}}, "turned_off": {pid: {sid: iso}}}`."""
    if using_redis():
        return redis_store.read_consent(_seed_consent())

    if using_gcs():
        stored = gcs_store.read_json(gcs_store.CONSENT_PATH)
        if stored is None:
            stored = _seed_consent()
            gcs_store.write_json(gcs_store.CONSENT_PATH, stored)
        stored.setdefault("overrides", {})
        stored.setdefault("turned_off", {})
        return stored

    global _mem_consent
    with _lock:
        if _mem_consent is None:
            _mem_consent = _seed_consent()
        return _mem_consent


def set_consent(participant_id: str, sensor_id: str, consented: bool) -> dict:
    """
    Record a consent toggle, and the moment it was turned off.

    The turned-off timestamp is what the researcher view renders as "Turned off
    by participant at [time]", so it is cleared on toggle-on to stop the card
    claiming a sensor is off when it is back on.
    """
    now = datetime.now(timezone.utc).isoformat()

    def _mutate(current):
        if not isinstance(current, dict):
            current = _seed_consent()
        overrides = current.setdefault("overrides", {})
        turned_off = current.setdefault("turned_off", {})

        overrides.setdefault(participant_id, {})[sensor_id] = consented
        pid_ts = turned_off.setdefault(participant_id, {})
        if consented:
            pid_ts.pop(sensor_id, None)
        else:
            pid_ts[sensor_id] = now
        return current

    if using_redis():
        redis_store.set_consent(participant_id, sensor_id, consented, now)
        return read_consent()

    if using_gcs():
        return gcs_store.update_json(
            gcs_store.CONSENT_PATH, _mutate, default=_seed_consent()
        )

    with _lock:
        global _mem_consent
        if _mem_consent is None:
            _mem_consent = _seed_consent()
        _mem_consent = _mutate(_mem_consent)
        return _mem_consent


# ---------------------------------------------------------------------------
# Bumps
# ---------------------------------------------------------------------------


def _seed_bumps() -> dict:
    try:
        with open(_LOCAL_BUMPS_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def read_bumps() -> dict:
    """`{participant_id: [ {id, timestamp, reason, note, read} ]}`."""
    if using_redis():
        return redis_store.read_all_bumps(_participant_config()["participants"].keys())

    if using_gcs():
        stored = gcs_store.read_json(gcs_store.BUMPS_PATH)
        if stored is None:
            # Carry over anything already in the local file the first time, so
            # existing bump history is not lost on the move to the bucket.
            stored = _seed_bumps()
            gcs_store.write_json(gcs_store.BUMPS_PATH, stored)
        return stored

    global _mem_bumps
    with _lock:
        if _mem_bumps is None:
            _mem_bumps = _seed_bumps()
        return _mem_bumps


def _write_bumps_memory(mutate) -> dict:
    """
    Memory backend: mutate and mirror to bumps.json.

    The file write is best-effort — on a read-only filesystem it fails, and
    losing bump history is not worth failing the request over. The GCS backend
    is the one that actually persists.
    """
    global _mem_bumps
    with _lock:
        if _mem_bumps is None:
            _mem_bumps = _seed_bumps()
        _mem_bumps = mutate(_mem_bumps)
        try:
            with open(_LOCAL_BUMPS_PATH, "w") as f:
                json.dump(_mem_bumps, f, indent=2)
        except OSError as e:
            log.warning("could not write %s: %s", _LOCAL_BUMPS_PATH, e)
        return _mem_bumps


def append_bump(participant_id: str, bump: dict) -> dict:
    def _mutate(current):
        if not isinstance(current, dict):
            current = {}
        current.setdefault(participant_id, []).append(bump)
        return current

    if using_redis():
        redis_store.append_bump(participant_id, bump)
        return read_bumps()

    if using_gcs():
        return gcs_store.update_json(gcs_store.BUMPS_PATH, _mutate, default={})
    return _write_bumps_memory(_mutate)


def mark_bump_read(participant_id: str, bump_id: str) -> dict:
    def _mutate(current):
        if not isinstance(current, dict):
            current = {}
        for entry in current.get(participant_id, []):
            if entry.get("id") == bump_id:
                entry["read"] = True
        return current

    if using_redis():
        redis_store.mark_bump_read(participant_id, bump_id)
        return read_bumps()

    if using_gcs():
        return gcs_store.update_json(gcs_store.BUMPS_PATH, _mutate, default={})
    return _write_bumps_memory(_mutate)


# ---------------------------------------------------------------------------
# Sensor summaries
# ---------------------------------------------------------------------------


def put_summary(sensor_id: str, envelope: dict) -> None:
    if using_redis():
        redis_store.put_summary(sensor_id, envelope)
        return

    if using_gcs():
        gcs_store.write_summary(sensor_id, envelope)
        return
    with _lock:
        _mem_summaries[sensor_id] = envelope


def read_summary_index() -> dict:
    """Every analysed sensor, without raw_rows. The dashboard poll payload."""
    if using_redis():
        return redis_store.read_summary_index()

    if using_gcs():
        return gcs_store.read_summary_index()
    with _lock:
        return {
            sid: {k: v for k, v in env.items() if k != "raw_rows"}
            for sid, env in _mem_summaries.items()
        }


def read_summary(sensor_id: str) -> dict | None:
    """One sensor's full envelope, including raw_rows."""
    if using_redis():
        return redis_store.read_summary(sensor_id)

    if using_gcs():
        return gcs_store.read_summary(sensor_id)
    with _lock:
        return _mem_summaries.get(sensor_id)


# ---------------------------------------------------------------------------
# Incremental sync watermark
# ---------------------------------------------------------------------------


def read_sync_watermark() -> datetime | None:
    """When the last successful sync ran, so the next one can skip old blobs."""
    if using_redis():
        raw = redis_store.read_sync_watermark()
    elif using_gcs():
        raw = (gcs_store.read_json(gcs_store.SYNC_STATE_PATH, default={}) or {}).get(
            "last_synced_at"
        )
    else:
        return None
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        log.warning("ignoring unparseable sync watermark: %r", raw)
        return None


def write_sync_watermark(when: datetime) -> None:
    if using_redis():
        redis_store.write_sync_watermark(when.isoformat())
        return

    if using_gcs():
        gcs_store.write_json(
            gcs_store.SYNC_STATE_PATH, {"last_synced_at": when.isoformat()}
        )
