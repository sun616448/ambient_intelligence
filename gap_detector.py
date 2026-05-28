import os

import pandas as pd

# All 16 biomarker signals Empatica generates per day.
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


def check_file_presence(date, base_path):
    """
    Check which expected Empatica biomarker files are present for a given date.

    date      : str "YYYY-MM-DD"
    base_path : str path to the participant_data directory

    Returns:
    {
        "date": "2026-04-17",
        "date_folder_exists": bool,
        "participants": {
            "0-3YKC51P2JM": {
                "biomarkers_present": [...],
                "biomarkers_missing": [...],
                "raw_avro_count": int,
                "all_biomarkers_present": bool,
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
                suffix = f"_{date}_{signal}.csv"
                if any(f.endswith(suffix) for f in existing):
                    present.append(signal)
                else:
                    missing.append(signal)
        else:
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


def detect_gaps(df, sensor_config, aggregated_interval_sec=None,
                window_start=None, window_end=None):
    """
    aggregated_interval_sec : override expected_interval_sec from config
                              (e.g. Geoscope 1-second RMS bins).
    window_start / window_end : fixed analysis window as timezone-aware datetimes.
                                When provided, completeness is measured against the
                                full window duration, not just the span of received
                                data. Rows outside the window are excluded.
                                When omitted, falls back to first/last data point.

    Interval resolution order:
      1. aggregated_interval_sec (explicit call-site override)
      2. sensor_config["expected_interval_sec"] (config value, if not None)
      3. median of observed timestamp deltas (inferred from data)
    """
    # check if empty 
    if df.empty:
        return _empty_report(window_start=window_start, window_end=window_end)

    # sort by timestamp and grab sensor ID 
    df = df.sort_values("timestamp").reset_index(drop=True)
    sensor_id = df["sensor_id"].iloc[0]

    # Clip to window before any measurement
    if window_start is not None:
        df = df[df["timestamp"] >= window_start].reset_index(drop=True)
    if window_end is not None:
        df = df[df["timestamp"] <= window_end].reset_index(drop=True)

    if df.empty:
        return _empty_report(sensor_id=sensor_id,
                             window_start=window_start, window_end=window_end)

    # get window start and end
    win_start = window_start if window_start is not None else df["timestamp"].iloc[0]
    win_end   = window_end   if window_end   is not None else df["timestamp"].iloc[-1]
    window_duration_sec = (win_end - win_start).total_seconds()

    threshold = sensor_config["gap_threshold_sec"]

    # Resolve effective sampling interval
    #first check if manually passed into function 
    effective_interval = aggregated_interval_sec
    # if not manually passed, check if expected interval is in config
    if effective_interval is None:
        effective_interval = sensor_config.get("expected_interval_sec")
    # if not manually passed and there are more than 1 row, use the median of the timestamp diffs
    if effective_interval is None and len(df) > 1:
        effective_interval = float(df["timestamp"].diff().dt.total_seconds().median())

    # get the diffs between the timestamps
    deltas = df["timestamp"].diff().dt.total_seconds()
    # get the indices of the gaps
    gap_indices = df.index[deltas > threshold]

    gaps = []
    # calculate the total gap duration
    total_gap_sec = 0.0
    for i in gap_indices:
        gap_start = df["timestamp"].iloc[i - 1]
        gap_end = df["timestamp"].iloc[i]
        duration = (gap_end - gap_start).total_seconds()
        gaps.append({"start": gap_start, "end": gap_end, "duration_sec": duration})
        total_gap_sec += duration

    if window_duration_sec > 0 and effective_interval:
        # total window - total gap time / window -> how much of the windo was the sensor present
        connection_uptime_pct = (window_duration_sec - total_gap_sec) / window_duration_sec * 100
        expected_rows = window_duration_sec / effective_interval
        # NaN values mean the device reported absence (e.g. Empatica missing_value_reason)
        valid_rows = int(df["value"].notna().sum())
        # valid rows / how many rows should exist, like Empatica has null value - so not gap but not valid data
        data_completeness_pct = min(valid_rows / expected_rows * 100, 100.0)
    else:
        connection_uptime_pct = 100.0
        data_completeness_pct = 100.0

    report = {
        "sensor_id": sensor_id,
        "window_start": win_start,
        "window_end": win_end,
        "connection_uptime_pct": round(connection_uptime_pct, 2),
        "data_completeness_pct": round(data_completeness_pct, 2),
        "gap_count": len(gaps),
        "longest_gap_sec": max((g["duration_sec"] for g in gaps), default=0.0),
        "gaps": gaps,
    }

    if sensor_config.get("absent_means_not_wearing"):
        not_worn_rows = int(df["value"].isna().sum())
        not_wearing_pct = round(
            min(not_worn_rows / expected_rows * 100, 100.0) if window_duration_sec > 0 and effective_interval else 0.0,
            2,
        )
        report["not_wearing_pct"] = not_wearing_pct
        report["not_wearing_periods"] = _compute_not_wearing_periods(df, effective_interval or 60)

    return report


def check_sensor_live(df, sensor_config, now=None):
    """
    Returns whether the sensor has a recent data point relative to now.

    now : timezone-aware datetime, defaults to current UTC time.

    Returns:
    {
        "live": bool,
        "latest_timestamp": datetime or None,
        "lag_sec": float or None,   # seconds since last data point
        "threshold_sec": float,     # gap_threshold_sec from config
    }
    """
    from datetime import datetime, timezone
    if now is None:
        now = datetime.now(timezone.utc)

    threshold = sensor_config["gap_threshold_sec"]

    if df.empty:
        return {"live": False, "latest_timestamp": None, "lag_sec": None, "threshold_sec": threshold}

    latest = df["timestamp"].max()
    lag = (now - latest).total_seconds()
    return {
        "live": lag <= threshold,
        "latest_timestamp": latest,
        "lag_sec": round(lag, 1),
        "threshold_sec": threshold,
    }


def _compute_not_wearing_periods(df, effective_interval):
    """
    Group consecutive NaN-value rows into contiguous "not wearing" intervals.
    Two NaN rows are considered consecutive if they are within 2x effective_interval apart.
    Returns a list of {start, end, duration_sec} dicts.
    """
    nan_rows = df[df["value"].isna()].reset_index(drop=True)
    if nan_rows.empty:
        return []

    periods = []
    seg_start = nan_rows["timestamp"].iloc[0]
    seg_end = nan_rows["timestamp"].iloc[0]

    for i in range(1, len(nan_rows)):
        t = nan_rows["timestamp"].iloc[i]
        if (t - seg_end).total_seconds() <= 2 * effective_interval:
            seg_end = t
        else:
            end_ts = seg_end + pd.Timedelta(seconds=effective_interval)
            periods.append({
                "start": seg_start,
                "end": end_ts,
                "duration_sec": (end_ts - seg_start).total_seconds(),
            })
            seg_start = t
            seg_end = t

    end_ts = seg_end + pd.Timedelta(seconds=effective_interval)
    periods.append({
        "start": seg_start,
        "end": end_ts,
        "duration_sec": (end_ts - seg_start).total_seconds(),
    })

    return periods


def _empty_report(sensor_id="", window_start=None, window_end=None):
    return {
        "sensor_id": sensor_id,
        "window_start": window_start,
        "window_end": window_end,
        "connection_uptime_pct": 0.0,
        "data_completeness_pct": 0.0,
        "gap_count": 0,
        "longest_gap_sec": 0.0,
        "gaps": [],
    }
