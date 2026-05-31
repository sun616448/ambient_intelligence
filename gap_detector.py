"""
gap_detector.py — Core sensor health analysis for the Ambient Intelligence dashboard.

Three public functions:
  detect_gaps()          — main analysis; returns completeness %, gap list, uptime %
  check_sensor_live()    — point-in-time check - did we get data recently?
  check_file_presence()  — Empatica only: did all 16 biomarker CSVs land for a given date?

Two private helpers:
  _compute_not_wearing_periods()  — groups consecutive NaN rows into off-wrist intervals
  _empty_report()                 — returns a zeroed-out report when df is empty

Key distinction between the two completeness metrics:
  connection_uptime_pct  — fraction of the window where the sensor was NOT in a gap
                           (gap = silence exceeding gap_threshold_sec). Measures whether
                           the hardware was reachable and streaming at all.
  data_completeness_pct  — fraction of expected individual rows that arrived with a
                           real value. A sensor can be fully online (uptime = 100%) while
                           still under-sampling — e.g. an Apple Watch that skips beats, or
                           an Empatica device worn only part of the day. This is the primary
                           metric shown on the dashboard because it catches silent under-
                           collection that uptime alone misses.
"""

import os

import pandas as pd


# ── Empatica file inventory ───────────────────────────────────────────────────
# All 16 biomarker signal suffixes that Empatica generates per participant per day.
# check_file_presence() uses this list to identify which files are missing.
# If Empatica adds or renames a signal, update this list.
EXPECTED_BIOMARKERS = [
    "accelerometers-std",
    "acticounts",
    "actigraphy-counts",
    "activity-classification",
    "activity-counts",
    "activity-intensity",
    "body-position",
    "eda",
    "met",
    "prv",
    "pulse-rate",
    "respiratory-rate",
    "sleep-detection",
    "step-counts",
    "temperature",
    "wearing-detection",
]


# ── Empatica file presence check ─────────────────────────────────────────────

def check_file_presence(date, base_path):
    """
    Verify that all expected Empatica biomarker CSVs exist on disk for a given date.

    Empatica data is manually downloaded from the Care portal — it does not arrive
    automatically. A missing file means the download was incomplete or the device
    failed to sync. This check runs before gap analysis so researchers know whether
    they're looking at a true data gap or a missing file. -> THIS MIGHT CHANGE IN THE FUTURE WITH GOOGLE CLOUD 
    STORAGE AND AUTO-DOWNLOADING OF THE DATA

    Parameters
    ----------
    date      : str  "YYYY-MM-DD" — the date to check
    base_path : str  path to the participant_data/ directory
                     (e.g. "data/1/Empatica_raw_data/participant_data")

    Directory structure expected under base_path:
        {date}/
          {participant_folder}/
            digital_biomarkers/aggregated_per_minute/   ← biomarker CSVs
            raw_data/v6/                                 ← .avro files (not used for gap detection)

    Returns
    -------
    {
        "date": "2026-04-17",
        "date_folder_exists": bool,
        "participants": {
            "0-3YKC51P2JM": {
                "biomarkers_present": ["pulse-rate", ...],   # signals that have a file
                "biomarkers_missing": ["eda", ...],          # signals with no file for this date
                "raw_avro_count": int,                       # number of raw .avro files present
                "all_biomarkers_present": bool,              # True only if biomarkers_missing is empty
            }
        }
    }
    """
    date_dir = os.path.join(base_path, date)
    result = {
        "date": date,
        "date_folder_exists": os.path.isdir(date_dir),
        "participants": {},
    }

    if not result["date_folder_exists"]:
        return result

    for participant_folder in sorted(os.listdir(date_dir)):
        participant_path = os.path.join(date_dir, participant_folder)
        if not os.path.isdir(participant_path):
            continue

        biomarker_dir = os.path.join(
            participant_path, "digital_biomarkers", "aggregated_per_minute"
        )
        raw_dir = os.path.join(participant_path, "raw_data", "v6")

        present, missing = [], []
        if os.path.isdir(biomarker_dir):
            existing = os.listdir(biomarker_dir)
            for signal in EXPECTED_BIOMARKERS:
                # Each biomarker CSV is named like: {participant}_{date}_{signal}.csv
                suffix = f"_{date}_{signal}.csv"
                if any(f.endswith(suffix) for f in existing):
                    present.append(signal)
                else:
                    missing.append(signal)
        else:
            # The entire biomarker directory is absent — all 16 signals are missing.
            missing = list(EXPECTED_BIOMARKERS)

        avro_count = 0
        if os.path.isdir(raw_dir):
            avro_count = sum(1 for f in os.listdir(raw_dir) if f.endswith(".avro"))

        result["participants"][participant_folder] = {
            "biomarkers_present": present,
            "biomarkers_missing": missing,
            "raw_avro_count": avro_count,
            "all_biomarkers_present": len(missing) == 0,
        }

    return result


# ── Core gap analysis ─────────────────────────────────────────────────────────

def detect_gaps(df, sensor_config, aggregated_interval_sec=None,
                window_start=None, window_end=None):
    """
    Analyse a sensor DataFrame for data gaps and compute completeness metrics.

    Parameters
    ----------
    df : pd.DataFrame
        Standard 3-column shape: timestamp (tz-aware datetime64), sensor_id (str),
        value (float64). All parsers in loader.py return this shape.

    sensor_config : dict
        One entry from SENSOR_CONFIG in config.py. Must contain:
          - gap_threshold_sec        : silence longer than this counts as a gap
          - expected_interval_sec    : nominal sampling interval (may be None)
          - absent_means_not_wearing : optional bool; if True, NaN values are
                                       treated as "device not worn" rather than a
                                       sensor fault (used for wearables only) 

    aggregated_interval_sec : float or None
        Overrides expected_interval_sec from config. Use this when the DataFrame
        has already been downsampled — e.g. Geoscope vibration is collected at
        500 Hz but aggregated to 1-second RMS bins before this function is called,
        so pass aggregated_interval_sec=1 rather than the raw 0.002s config value.

    window_start / window_end : tz-aware datetime or None
        Define the reference window for completeness measurement. When provided:
          - Rows outside the window are dropped before any calculation.
          - Expected row count is based on the full window duration, so a sensor
            that was silent for the first half of the window will show low
            completeness even if every row within the second half arrived.
        When omitted, the window defaults to the first and last timestamps in df,
        meaning completeness is always 100% relative to whatever data arrived —
        useful for ad-hoc file uploads, not meaningful for daily monitoring.

    Interval resolution order (first non-None value wins):
      1. aggregated_interval_sec   (explicit override passed by the caller)
      2. sensor_config["expected_interval_sec"]  (config-defined nominal rate)
      3. median of observed timestamp deltas     (inferred from the data itself)
         — used for sensors whose rate is irregular or unknown

    Returns
    -------
    dict with keys:
        sensor_id              : str
        window_start           : tz-aware datetime
        window_end             : tz-aware datetime
        connection_uptime_pct  : float  — % of window not in a gap
        data_completeness_pct  : float  — % of expected rows that had a real value
        gap_count              : int    — number of gaps exceeding gap_threshold_sec
        longest_gap_sec        : float  — duration of the single worst gap
        gaps                   : list of {start, end, duration_sec}
        not_wearing_pct        : float  — only present when absent_means_not_wearing
        not_wearing_periods    : list   — only present when absent_means_not_wearing
    """
    if df.empty:
        return _empty_report(window_start=window_start, window_end=window_end)

    df = df.sort_values("timestamp").reset_index(drop=True)
    sensor_id = df["sensor_id"].iloc[0]

    # Drop rows outside the requested window before any measurement. This
    # ensures we don't inflate uptime by counting data from outside the period.
    if window_start is not None:
        df = df[df["timestamp"] >= window_start].reset_index(drop=True)
    if window_end is not None:
        df = df[df["timestamp"] <= window_end].reset_index(drop=True)

    if df.empty:
        return _empty_report(sensor_id=sensor_id,
                             window_start=window_start, window_end=window_end)

    # Anchor the window: use caller-supplied boundaries when available so
    # completeness is measured against a fixed reference (e.g. a full 24-hour
    # day), not just the span of whatever data happened to arrive.
    win_start = window_start if window_start is not None else df["timestamp"].iloc[0]
    win_end   = window_end   if window_end   is not None else df["timestamp"].iloc[-1]
    window_duration_sec = (win_end - win_start).total_seconds()

    threshold = sensor_config["gap_threshold_sec"]

    # Resolve which interval to use for expected-row calculations.
    effective_interval = aggregated_interval_sec
    if effective_interval is None:
        effective_interval = sensor_config.get("expected_interval_sec")
    if effective_interval is None and len(df) > 1:
        # Fall back to the median inter-row gap observed in the data. The median
        # is used instead of the mean because a single large gap would skew the
        # mean and produce a misleading expected_rows estimate.
        effective_interval = float(df["timestamp"].diff().dt.total_seconds().median())

    # ── Gap detection ────────────────────────────────────────────────────────
    # Compute the time between consecutive rows. Any gap larger than
    # gap_threshold_sec is a reportable data interruption.
    deltas = df["timestamp"].diff().dt.total_seconds()
    gap_indices = df.index[deltas > threshold]

    gaps = []
    total_gap_sec = 0.0
    for i in gap_indices:
        gap_start = df["timestamp"].iloc[i - 1]
        gap_end   = df["timestamp"].iloc[i]
        duration  = (gap_end - gap_start).total_seconds()
        gaps.append({"start": gap_start, "end": gap_end, "duration_sec": duration})
        total_gap_sec += duration

    # ── Completeness metrics ─────────────────────────────────────────────────
    if window_duration_sec > 0 and effective_interval:
        # connection_uptime_pct: what fraction of the window was the sensor
        # actively streaming? Computed by subtracting gap time from total window.
        connection_uptime_pct = (window_duration_sec - total_gap_sec) / window_duration_sec * 100

        # expected_rows: how many individual readings *should* have arrived in
        # this window at the sensor's nominal rate.
        expected_rows = window_duration_sec / effective_interval

        # valid_rows: rows where value is not NaN. For most sensors, NaN means
        # a parse failure and should be rare. For Empatica, NaN means the device
        # reported a missing_value_reason (e.g. "device_not_recording") — Empatica
        # pre-fills all 1440 minute slots for the day, so absent rows appear as
        # NaN rather than missing rows.
        valid_rows = int(df["value"].notna().sum())

        # Cap at 100 in case the sensor over-sampled or the interval estimate is
        # slightly off (common with jittery sensors like vibration).
        data_completeness_pct = min(valid_rows / expected_rows * 100, 100.0)
    else:
        # Window is a single point or interval is unknown — nothing meaningful
        # to compute, so report perfect scores to avoid false alerts.
        connection_uptime_pct = 100.0
        data_completeness_pct = 100.0

    report = {
        "sensor_id":             sensor_id,
        "window_start":          win_start,
        "window_end":            win_end,
        "connection_uptime_pct": round(connection_uptime_pct, 2),
        "data_completeness_pct": round(data_completeness_pct, 2),
        "gap_count":             len(gaps),
        "longest_gap_sec":       max((g["duration_sec"] for g in gaps), default=0.0),
        "gaps":                  gaps,
    }

    # ── Empatica "not wearing" extension ─────────────────────────────────────
    # For wearables that flag non-wear via NaN (rather than missing rows), we
    # separately surface how much of the day the device was off the wrist.
    # This distinguishes a sensor fault (hardware gap) from a compliance issue
    # (participant removed the device) — both matter, but for different reasons.
    if sensor_config.get("absent_means_not_wearing"):
        not_worn_rows = int(df["value"].isna().sum())
        not_wearing_pct = round(
            min(not_worn_rows / expected_rows * 100, 100.0)
            if window_duration_sec > 0 and effective_interval else 0.0,
            2,
        )
        report["not_wearing_pct"]     = not_wearing_pct
        report["not_wearing_periods"] = _compute_not_wearing_periods(df, effective_interval or 60)

    return report


# ── Live-status check ─────────────────────────────────────────────────────────

def check_sensor_live(df, sensor_config, now=None):
    """
    Point-in-time check: did the sensor deliver a data point recently?

    "Recently" means within gap_threshold_sec of now. If the lag exceeds that
    threshold, the sensor is considered offline — the same threshold used by
    detect_gaps() for mid-session gap detection.

    Parameters
    ----------
    df           : pd.DataFrame  standard 3-column shape (may be empty)
    sensor_config: dict          one entry from SENSOR_CONFIG
    now          : tz-aware datetime or None  defaults to current UTC time

    Returns
    -------
    {
        "live":             bool,
        "latest_timestamp": datetime or None,  — timestamp of the most recent row
        "lag_sec":          float or None,     — seconds since that row arrived
        "threshold_sec":    float,             — gap_threshold_sec from config
    }
    """
    from datetime import datetime, timezone
    if now is None:
        now = datetime.now(timezone.utc)

    threshold = sensor_config["gap_threshold_sec"]

    if df.empty:
        return {"live": False, "latest_timestamp": None,
                "lag_sec": None, "threshold_sec": threshold}

    latest = df["timestamp"].max()
    lag    = (now - latest).total_seconds()
    return {
        "live":             lag <= threshold,
        "latest_timestamp": latest,
        "lag_sec":          round(lag, 1),
        "threshold_sec":    threshold,
    }


# ── Private helpers ───────────────────────────────────────────────────────────

def _compute_not_wearing_periods(df, effective_interval):
    """
    Group consecutive NaN-value rows into contiguous "not wearing" time blocks.

    Empatica pre-fills every minute of the day. When the device is off the wrist,
    those rows have NaN values rather than being absent. This function stitches
    adjacent NaN rows into single intervals so the frontend can render them as
    one "not worn" segment on the timeline rather than hundreds of individual dots.

    Two NaN rows are treated as part of the same segment if the time between them
    is at most 2× the effective_interval. The 2× tolerance handles the case where
    a single valid row appears in the middle of an otherwise off-wrist period
    (e.g. a spurious reading just before the device was fully removed).

    Each period's end timestamp is advanced by one effective_interval so the
    segment covers the full last minute slot rather than ending at its start.

    Returns a list of {start, end, duration_sec} dicts, empty if no NaN rows.
    """
    nan_rows = df[df["value"].isna()].reset_index(drop=True)
    if nan_rows.empty:
        return []

    periods   = []
    seg_start = nan_rows["timestamp"].iloc[0]
    seg_end   = nan_rows["timestamp"].iloc[0]

    for i in range(1, len(nan_rows)):
        t = nan_rows["timestamp"].iloc[i]
        if (t - seg_end).total_seconds() <= 2 * effective_interval:
            # Still within the same contiguous off-wrist block — extend it.
            seg_end = t
        else:
            # Gap between NaN rows is large enough to be a separate period.
            end_ts = seg_end + pd.Timedelta(seconds=effective_interval)
            periods.append({
                "start":        seg_start,
                "end":          end_ts,
                "duration_sec": (end_ts - seg_start).total_seconds(),
            })
            seg_start = t
            seg_end   = t

    # Flush the final segment.
    end_ts = seg_end + pd.Timedelta(seconds=effective_interval)
    periods.append({
        "start":        seg_start,
        "end":          end_ts,
        "duration_sec": (end_ts - seg_start).total_seconds(),
    })

    return periods


def _empty_report(sensor_id="", window_start=None, window_end=None):
    """Return a zeroed-out gap report when the DataFrame is empty or entirely outside the window."""
    return {
        "sensor_id":             sensor_id,
        "window_start":          window_start,
        "window_end":            window_end,
        "connection_uptime_pct": 0.0,
        "data_completeness_pct": 0.0,
        "gap_count":             0,
        "longest_gap_sec":       0.0,
        "gaps":                  [],
    }
