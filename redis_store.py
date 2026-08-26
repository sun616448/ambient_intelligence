"""
Upstash Redis store for everything the API mutates at runtime.

Chosen so that GCS stays strictly read-only. The sensor bucket is a regulated
dataset (the project is named …-phi-…) and dashboard state has no business being
written into it; separating the two also means the GCS credential only ever
needs object-viewer.

The REST client is used rather than a TCP one because a serverless function may
cold-start on any request, and a fresh TCP handshake and auth per invocation
costs more than an HTTPS call to an endpoint that is already keep-alive pooled.

Key layout:

    summary:<sensor_id>     string  full envelope, including raw_rows
    summary_index           hash    field <sensor_id> -> envelope without raw_rows
    consent:overrides       hash    field "<pid>|<sid>" -> "1" / "0"
    consent:turned_off      hash    field "<pid>|<sid>" -> ISO-8601 UTC
    bumps:<pid>             list    JSON strings, oldest first
    sync:watermark          string  ISO-8601 UTC

Hashes rather than one JSON blob per concern, deliberately: HSET writes a single
field atomically, so two participants toggling consent at the same moment on two
different instances cannot clobber each other. A JSON blob would need a
read-modify-write and some form of optimistic locking to be equally safe.
"""

import json
import logging
import os
import threading

log = logging.getLogger("redis_store")

SUMMARY_KEY = "summary:{}"
SUMMARY_INDEX = "summary_index"
CONSENT_OVERRIDES = "consent:overrides"
CONSENT_TURNED_OFF = "consent:turned_off"
BUMPS_KEY = "bumps:{}"
SYNC_WATERMARK = "sync:watermark"

_client = None
_client_lock = threading.Lock()


def _url() -> str:
    # KV_REST_API_* are the names Vercel's Upstash integration injects; the
    # UPSTASH_* names are what the Upstash dashboard shows. Accept both so the
    # same code works whether the store was provisioned through the Marketplace
    # or by hand.
    return (
        os.environ.get("UPSTASH_REDIS_REST_URL", "").strip()
        or os.environ.get("KV_REST_API_URL", "").strip()
    )


def _token() -> str:
    return (
        os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()
        or os.environ.get("KV_REST_API_TOKEN", "").strip()
    )


def is_configured() -> bool:
    return bool(_url() and _token())


def client():
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                from upstash_redis import Redis

                _client = Redis(url=_url(), token=_token())
    return _client


def ping() -> dict:
    """Connectivity check for the status endpoint."""
    info = {"configured": is_configured(), "url_host": None}
    if not is_configured():
        info["error"] = (
            "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set"
        )
        return info

    info["url_host"] = _url().split("//")[-1].split("/")[0]
    try:
        probe = "_probe"
        client().set(probe, "1")
        client().delete(probe)
        info["reachable"] = True
    except Exception as e:
        info["reachable"] = False
        info["error"] = f"{type(e).__name__}: {e}".splitlines()[0][:300]
    return info


def _loads(raw):
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        log.warning("stored value is not valid JSON; ignoring")
        return None


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------


def put_summary(sensor_id: str, envelope: dict) -> None:
    """
    Store one sensor two ways: in full, and without raw_rows in the index.

    raw_rows runs to 5000 rows and is only rendered in the detail modal, so
    keeping it out of the index is what stops the dashboard's two-minute poll
    pulling megabytes for every sensor at once.
    """
    light = {k: v for k, v in envelope.items() if k != "raw_rows"}
    client().set(SUMMARY_KEY.format(sensor_id), json.dumps(envelope, default=str))
    client().hset(SUMMARY_INDEX, sensor_id, json.dumps(light, default=str))


def read_summary_index() -> dict:
    raw = client().hgetall(SUMMARY_INDEX) or {}
    out = {}
    for sensor_id, value in raw.items():
        parsed = _loads(value)
        if parsed is not None:
            out[sensor_id] = parsed
    return out


def read_summary(sensor_id: str):
    return _loads(client().get(SUMMARY_KEY.format(sensor_id)))


# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------


def _field(participant_id: str, sensor_id: str) -> str:
    return f"{participant_id}|{sensor_id}"


def _split(field: str):
    pid, _, sid = field.partition("|")
    return pid, sid


def read_consent(seed: dict) -> dict:
    """
    Current consent, seeded from participant_config.json on first run.

    The seed is only used for participants and sensors with nothing stored yet,
    so a live toggle is never reverted by a redeploy — the config file is a
    starting point, not the source of truth.
    """
    overrides = {pid: dict(sensors) for pid, sensors in seed.get("overrides", {}).items()}
    turned_off: dict = {}

    for field, value in (client().hgetall(CONSENT_OVERRIDES) or {}).items():
        pid, sid = _split(field)
        overrides.setdefault(pid, {})[sid] = value == "1"

    for field, value in (client().hgetall(CONSENT_TURNED_OFF) or {}).items():
        pid, sid = _split(field)
        turned_off.setdefault(pid, {})[sid] = value

    return {"overrides": overrides, "turned_off": turned_off}


def set_consent(participant_id: str, sensor_id: str, consented: bool, now_iso: str) -> None:
    field = _field(participant_id, sensor_id)
    client().hset(CONSENT_OVERRIDES, field, "1" if consented else "0")
    if consented:
        # Clear the timestamp, so the researcher view stops showing
        # "turned off by participant" once it is back on.
        client().hdel(CONSENT_TURNED_OFF, field)
    else:
        client().hset(CONSENT_TURNED_OFF, field, now_iso)


# ---------------------------------------------------------------------------
# Bumps
# ---------------------------------------------------------------------------


def read_bumps_for(participant_id: str) -> list:
    raw = client().lrange(BUMPS_KEY.format(participant_id), 0, -1) or []
    return [b for b in (_loads(x) for x in raw) if b is not None]


def read_all_bumps(participant_ids) -> dict:
    return {pid: read_bumps_for(pid) for pid in participant_ids}


def append_bump(participant_id: str, bump: dict) -> None:
    client().rpush(BUMPS_KEY.format(participant_id), json.dumps(bump, default=str))


def mark_bump_read(participant_id: str, bump_id: str) -> bool:
    key = BUMPS_KEY.format(participant_id)
    raw = client().lrange(key, 0, -1) or []
    for index, item in enumerate(raw):
        entry = _loads(item)
        if entry and entry.get("id") == bump_id:
            entry["read"] = True
            # LSET rewrites one element in place, so a bump appended
            # concurrently is not lost the way rewriting the whole list would.
            client().lset(key, index, json.dumps(entry, default=str))
            return True
    return False


# ---------------------------------------------------------------------------
# Sync watermark
# ---------------------------------------------------------------------------


def read_sync_watermark():
    return client().get(SYNC_WATERMARK)


def write_sync_watermark(iso: str) -> None:
    client().set(SYNC_WATERMARK, iso)
