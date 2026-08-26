"""
Host-neutral Google Cloud Storage access layer.

Everything that has to survive a process restart lives in the bucket, not in a
module-level dict. That is what makes the deployment portable: localhost, Vercel
functions, and Cloud Run all read and write the same objects, so changing hosts
is a config change rather than a data migration.

Object layout inside the bucket:

    <sensor CSVs>                  uploaded by the collection pipeline
    _summaries/_index.json         all sensors, without raw_rows (the poll path)
    _summaries/<sensor_id>.json    one sensor, full envelope incl. raw_rows
    _state/consent.json            consent overrides + turned-off timestamps
    _state/bumps.json              bump/reminder log
    _state/sync.json               incremental-sync watermark

The leading underscore keeps these out of the way of the sensor CSVs: the sync
path skips any blob under a `_` prefix, so summaries are never mistaken for
input data.

Credentials resolve in this order, so the same code authenticates everywhere:

    1. GCS_CREDENTIALS_B64            base64-encoded service account JSON, for
                                     hosts with no writable filesystem to put a
                                     key file on (Vercel)
    2. GOOGLE_APPLICATION_CREDENTIALS path to a key file (local development)
    3. Application Default Credentials  `gcloud auth application-default login`
                                     locally, or the attached service account on
                                     Cloud Run / GCE (no key material at all)

Option 3 is the reason the eventual Cloud Run move needs no code change: attach
a service account to the service and the same client picks it up.
"""

import base64
import binascii
import json
import logging
import os
import tempfile
import threading
import time

# Load .env here rather than relying on the caller, so any entry point that
# imports this module — the API, a cron script, a one-off in a REPL — resolves
# the same configuration. It does not override variables already set, so a real
# deployment's environment always wins over a stray local .env.
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("gcs_store")

SUMMARY_PREFIX = "_summaries/"
SUMMARY_INDEX = "_summaries/_index.json"
STATE_PREFIX = "_state/"
CONSENT_PATH = "_state/consent.json"
BUMPS_PATH = "_state/bumps.json"
SYNC_STATE_PATH = "_state/sync.json"

# Blobs under these prefixes are ours, not sensor input. The sync path skips them.
_RESERVED_PREFIXES = (SUMMARY_PREFIX, STATE_PREFIX)

_client = None
_client_lock = threading.Lock()


class GCSNotConfigured(RuntimeError):
    """Raised when a GCS operation is attempted without GCS_BUCKET_NAME set."""


def bucket_name() -> str | None:
    return os.environ.get("GCS_BUCKET_NAME", "").strip() or None


def project_id() -> str | None:
    return os.environ.get("GCS_PROJECT_ID", "").strip() or None


def state_bucket_name() -> str | None:
    """
    Where summaries and state are written, which need not be where sensor data
    is read from.

    Two reasons to separate them. The data bucket may be a regulated dataset
    that dashboard state has no business being written into, and reading sensor
    data needs only object-viewer while writing summaries needs the delete
    permission that overwriting an object requires. Splitting them keeps the
    read path least-privileged.

    Defaults to the data bucket when unset, so a single-bucket setup needs no
    extra configuration.
    """
    return os.environ.get("GCS_STATE_BUCKET", "").strip() or bucket_name()


def is_configured() -> bool:
    return bucket_name() is not None


def is_reserved(blob_name: str) -> bool:
    """True for objects this module writes, so callers never treat them as input."""
    return blob_name.startswith(_RESERVED_PREFIXES)


def _credentials():
    """
    Build explicit credentials from GCS_CREDENTIALS_B64 if present.

    Returns None to mean "fall through to whatever the google client finds on its
    own" — a key file path in GOOGLE_APPLICATION_CREDENTIALS, or ADC.
    """
    raw = os.environ.get("GCS_CREDENTIALS_B64", "").strip()
    if not raw:
        return None

    try:
        info = json.loads(base64.b64decode(raw))
    except (binascii.Error, ValueError, UnicodeDecodeError) as e:
        # A malformed key is a deployment mistake, not a transient fault. Say so
        # loudly rather than silently falling back to ADC, which would fail later
        # with a much less obvious error.
        raise RuntimeError(
            "GCS_CREDENTIALS_B64 is set but is not valid base64-encoded JSON. "
            "Re-encode the service account key with: "
            "base64 -i key.json | tr -d '\\n'"
        ) from e

    from google.oauth2 import service_account

    return service_account.Credentials.from_service_account_info(info)


def client():
    """Cached storage client. Safe to call per-request; the build happens once."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                from google.cloud import storage

                _client = storage.Client(
                    project=project_id(), credentials=_credentials()
                )
    return _client


def bucket():
    """The data bucket — sensor files are read from here."""
    name = bucket_name()
    if not name:
        raise GCSNotConfigured(
            "GCS_BUCKET_NAME is not set. Add it to .env locally, or to the "
            "project's environment variables when deployed."
        )
    return client().bucket(name)


def state_bucket():
    """The state bucket — summaries and consent are written here."""
    name = state_bucket_name()
    if not name:
        raise GCSNotConfigured("Neither GCS_STATE_BUCKET nor GCS_BUCKET_NAME is set.")
    return client().bucket(name)


def check_write_access() -> dict:
    """
    Probe whether state objects can actually be written *and overwritten*.

    Overwriting an object in GCS needs storage.objects.delete, which
    objectCreator does not grant. Without this probe the failure mode is
    invisible: the first sync creates the summaries and every later one gets a
    403 that only shows up in the logs, so the dashboard quietly serves stale
    numbers forever.
    """
    import uuid

    # A fixed name would be left behind by a probe that could create but not
    # delete, and every later run would then report can_create=False because it
    # was really attempting an overwrite.
    probe = f"{STATE_PREFIX}.write-probe-{uuid.uuid4().hex[:8]}"
    result = {"bucket": state_bucket_name(), "can_create": False, "can_overwrite": False}
    try:
        blob = state_bucket().blob(probe)
        blob.upload_from_string("probe", content_type="text/plain")
        result["can_create"] = True
        # The second write is the one that needs delete permission.
        blob.upload_from_string("probe2", content_type="text/plain")
        result["can_overwrite"] = True
        blob.delete()
        result["can_delete"] = True
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}".split("\n")[0][:300]
    return result


# ---------------------------------------------------------------------------
# JSON objects
# ---------------------------------------------------------------------------


def read_json(path: str, default=None):
    """Read a JSON object. Returns `default` if it does not exist yet."""
    from google.cloud import exceptions

    try:
        return json.loads(state_bucket().blob(path).download_as_bytes())
    except exceptions.NotFound:
        return default
    except json.JSONDecodeError:
        # A truncated or hand-edited object should not take the whole app down.
        log.warning("gs://%s/%s is not valid JSON; ignoring", state_bucket_name(), path)
        return default


def write_json(path: str, obj) -> None:
    state_bucket().blob(path).upload_from_string(
        json.dumps(obj, default=str), content_type="application/json"
    )


def update_json(path: str, mutate, default=None, attempts: int = 4):
    """
    Read-modify-write a JSON object without losing a concurrent update.

    `mutate` receives the current value and returns the new one. The write is
    conditional on the object's generation, so if another instance wrote in
    between, the read is retried against the newer value rather than silently
    clobbering it.

    This matters because there is no longer one process holding these dicts:
    two participants toggling consent at the same moment can land on two
    different function instances.
    """
    from google.cloud import exceptions

    blob = state_bucket().blob(path)

    for attempt in range(attempts):
        try:
            current = json.loads(blob.download_as_bytes())
            generation = blob.generation
        except exceptions.NotFound:
            current = default if default is not None else {}
            generation = 0  # 0 means "only if it still does not exist"
        except json.JSONDecodeError:
            current = default if default is not None else {}
            generation = blob.generation

        updated = mutate(current)

        try:
            blob.upload_from_string(
                json.dumps(updated, default=str),
                content_type="application/json",
                if_generation_match=generation,
            )
            return updated
        except exceptions.PreconditionFailed:
            if attempt == attempts - 1:
                raise
            time.sleep(0.05 * (2**attempt))
            blob.reload()

    raise RuntimeError(f"could not update {path} after {attempts} attempts")


# ---------------------------------------------------------------------------
# Blobs
# ---------------------------------------------------------------------------


DATA_SUFFIXES = (".csv", ".json")


def list_data_blobs(prefix: str = "", updated_after=None, suffixes=DATA_SUFFIXES):
    """
    Sensor data objects in the bucket, newest first.

    Reserved objects (summaries, state) are always excluded. When `updated_after`
    is given, only blobs modified since then are returned — this is what keeps an
    incremental sync from re-downloading the whole bucket every run.

    Beware on a large bucket: this walks every object under `prefix`. The
    Geoscope gateway writes ~2,340 files a day, so call it with a prefix narrow
    enough to matter — see list_gateway_prefixes and iter_date_prefixes.
    """
    blobs = [
        b
        for b in client().list_blobs(bucket_name(), prefix=prefix)
        if b.name.lower().endswith(tuple(suffixes)) and not is_reserved(b.name)
    ]
    if updated_after is not None:
        blobs = [b for b in blobs if b.updated and b.updated > updated_after]
    blobs.sort(key=lambda b: b.updated or 0, reverse=True)
    return blobs


def download_to_temp(blob_path: str, bucket_override: str | None = None) -> str:
    """
    Download a blob to a temp file and return the path. Caller deletes it.

    /tmp is the one writable location on every host we care about, including
    Vercel functions, which is why parsing always goes through a temp file.
    """
    name = bucket_override or bucket_name()
    if not name:
        raise GCSNotConfigured("GCS_BUCKET_NAME is not set")

    suffix = os.path.splitext(blob_path)[1] or ".csv"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        client().bucket(name).blob(blob_path).download_to_filename(tmp.name)
        tmp.close()
        return tmp.name
    except Exception:
        tmp.close()
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Sensor summaries
# ---------------------------------------------------------------------------
#
# Each analysed file produces one envelope (gap report + readings + timeline +
# raw_rows). That envelope is stored twice, deliberately:
#
#   _summaries/<sensor_id>.json  full, including raw_rows — read once, when a
#                                researcher opens the detail modal
#   _summaries/_index.json       every sensor without raw_rows — read by the
#                                dashboard poll every 2 minutes
#
# raw_rows is up to 5000 rows per sensor and is only ever rendered in the
# modal's collapsible table. Keeping it out of the index turns the recurring
# poll from megabytes into kilobytes, which matters once the response is
# crossing a network instead of being read out of a local dict.


def _without_raw_rows(envelope: dict) -> dict:
    return {k: v for k, v in envelope.items() if k != "raw_rows"}


def write_summary(sensor_id: str, envelope: dict) -> None:
    """Persist one analysed sensor, and fold it into the shared index."""
    write_json(f"{SUMMARY_PREFIX}{sensor_id}.json", envelope)

    light = _without_raw_rows(envelope)

    def _merge(index):
        if not isinstance(index, dict):
            index = {}
        index[sensor_id] = light
        return index

    update_json(SUMMARY_INDEX, _merge, default={})


def read_summary_index() -> dict:
    """All sensors, without raw_rows. This is the dashboard poll payload."""
    index = read_json(SUMMARY_INDEX, default={})
    return index if isinstance(index, dict) else {}


def read_summary(sensor_id: str) -> dict | None:
    """One sensor's full envelope, including raw_rows."""
    return read_json(f"{SUMMARY_PREFIX}{sensor_id}.json")


def rebuild_summary_index() -> dict:
    """
    Reconstruct _index.json from the per-sensor objects.

    Only needed if the index is lost or hand-edited; the per-sensor objects are
    the source of truth and the index is derived from them.
    """
    index = {}
    for blob in client().list_blobs(state_bucket_name(), prefix=SUMMARY_PREFIX):
        if not blob.name.endswith(".json") or blob.name == SUMMARY_INDEX:
            continue
        sensor_id = os.path.basename(blob.name)[: -len(".json")]
        try:
            index[sensor_id] = _without_raw_rows(
                json.loads(blob.download_as_bytes())
            )
        except json.JSONDecodeError:
            log.warning("skipping unreadable summary %s", blob.name)
    write_json(SUMMARY_INDEX, index)
    return index


def list_csv_blobs(prefix: str = "", updated_after=None):
    """CSV-only view of list_data_blobs."""
    return list_data_blobs(prefix=prefix, updated_after=updated_after, suffixes=(".csv",))


def list_gateway_prefixes() -> list[str]:
    """
    Top-level directories in the bucket, e.g. ["lime2-01/"].

    Uses a delimited listing, so this is one cheap call that returns directory
    names rather than walking all 68,000 objects.
    """
    it = client().list_blobs(bucket_name(), prefix="", delimiter="/")
    list(it)  # the prefixes attribute is only populated once the page is consumed
    # Exclude our own _summaries/ and _state/ directories, which are output, not
    # a gateway feeding data in.
    return sorted(p for p in it.prefixes if not is_reserved(p))


def list_recent_geoscope_blobs(window_start, window_end, gateway_prefixes=None):
    """
    Geoscope JSON uploads whose *file* falls in a time window.

    The layout is <gateway>/data/<YYYY-MM-DD>/<SENSOR_DIR>/<local-timestamp>.json,
    so the window is turned into a small set of date prefixes and only those are
    listed. Listing the whole bucket to find two hours of files would mean
    walking every object for every sync.

    Dates are taken one day either side of the window because the directory date
    is local (Pacific) while the window is UTC, and the two disagree across the
    evening boundary.

    Returns {sensor_dir: [blob, ...]} with each list oldest-first.
    """
    import datetime as _dt

    prefixes = gateway_prefixes if gateway_prefixes is not None else list_gateway_prefixes()

    day = window_start.date() - _dt.timedelta(days=1)
    last = window_end.date() + _dt.timedelta(days=1)
    dates = []
    while day <= last:
        dates.append(day.isoformat())
        day += _dt.timedelta(days=1)

    grouped: dict[str, list] = {}
    for gw in prefixes:
        for date in dates:
            for blob in client().list_blobs(bucket_name(), prefix=f"{gw}data/{date}/"):
                if not blob.name.lower().endswith(".json") or is_reserved(blob.name):
                    continue
                # Filter on the object's own modified time: the filename is
                # local wall-clock and the payload timestamps are UTC, so
                # `updated` is the one field that is unambiguous here.
                if blob.updated and not (window_start <= blob.updated <= window_end):
                    continue
                grouped.setdefault(blob.name.split("/")[-2], []).append(blob)

    for blobs in grouped.values():
        blobs.sort(key=lambda b: b.updated or 0)
    return grouped
