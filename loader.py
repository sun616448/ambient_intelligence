"""
Loader for the Ambient Intelligence Researcher Dashboard.
This file contains the functions for loading the sensor data from the CSV files.
It is used to load the sensor data from the CSV files and parse it into a pandas DataFrame.
It is also used to parse the sensor data into a pandas DataFrame using the pandas read_csv function.
When adding new sensor types, need to add a new function specific to the sensor to make sure 
it parses correctly 
"""
import numpy as np
import pandas as pd


def parse_apple_watch_csv(filepath):
    """
    Apple Watch HR export has one more data field per row than header fields.
    Pandas auto-detects this and uses the first column (timestamp) as the index,
    mapping the HR value to the column named 'Time' and device name to 'Avg Heart Rate'.
    index_col=0 makes this explicit and safe across pandas versions.
    """
    df = pd.read_csv(filepath, index_col=0)
    df.index = pd.to_datetime(df.index, format="ISO8601", utc=True)
    df.index.name = "timestamp"
    df = df[["Time"]].rename(columns={"Time": "value"})
    df["value"] = df["value"].astype(float)
    df["sensor_id"] = "heartrate"
    return df.reset_index()[["timestamp", "sensor_id", "value"]]


def _rms(series):
    return float(np.sqrt((series**2).mean())) if len(series) > 0 else float("nan")


def parse_geoscope_csv(filepath):
    """
    500 Hz produces ~414K rows per 14 min. Aggregate to 1-second RMS bins
    immediately after loading — never pass raw Geoscope data downstream.
    """
    df = pd.read_csv(filepath)
    df["timestamp"] = pd.to_datetime(df["timestamp_pacific"], format="ISO8601", utc=True)
    sensor_id = df["sensor"].iloc[0]
    df = df.set_index("timestamp")[["reading"]]
    binned = df["reading"].resample("1s").apply(_rms).dropna().rename("value")
    result = binned.reset_index()
    result["sensor_id"] = sensor_id
    return result[["timestamp", "sensor_id", "value"]]


def parse_empatica_biomarker_csv(filepath, signal_col, sensor_id):
    """
    Parser for Empatica digital_biomarkers/aggregated_per_minute CSVs.

    Rows where the device wasn't recording arrive with an empty value column
    and a non-empty missing_value_reason column. Those become NaN in 'value'
    so detect_gaps counts them as missing rather than skipping them entirely.
    """
    df = pd.read_csv(filepath)
    df["timestamp"] = pd.to_datetime(df["timestamp_iso"], format="ISO8601", utc=True)
    df["value"] = pd.to_numeric(df[signal_col], errors="coerce")
    df["sensor_id"] = sensor_id
    return df[["timestamp", "sensor_id", "value"]]


def parse_generic_csv(filepath, timestamp_col, value_col, sensor_id, timestamp_format="ISO8601"):
    """Fallback for well-behaved CSVs with known column names."""
    df = pd.read_csv(filepath)
    df["timestamp"] = pd.to_datetime(df[timestamp_col], format=timestamp_format, utc=True)
    df["value"] = df[value_col].astype(float)
    df["sensor_id"] = sensor_id
    return df[["timestamp", "sensor_id", "value"]]


def parse_geoscope_json(filepath):
    """
    Parser for the Geoscope gateway's JSON upload format.

    A file is a JSON array of records, each one second of sampling:

        [{"uuid": "GEOSCOPE-140",
          "data": [2007, 2007, ...],   # exactly 500 samples = 1 s at 500 Hz
          "gain": 1.0,
          "sendTime": 2525050872929,   # gateway uptime counter, not wall clock
          "timestamp": 1787718149099}, # epoch ms, UTC
         ...]

    Because a record is already a one-second block, the RMS of its samples is
    the one-second bin — there is no need to explode ~53,000 rows and resample
    them back down. Same output as parse_geoscope_csv, a fraction of the work.

    `timestamp` is used rather than the filename. The filename is local Pacific
    time and reflects when the gateway closed the file, which runs a couple of
    minutes ahead of the samples inside it.

    sensor_id is per device (vibration_140, vibration_103, …) because three
    Geoscopes report into this bucket and a shared id would have them
    overwriting each other's reports.
    """
    import json

    with open(filepath) as f:
        records = json.load(f)

    if not records:
        return pd.DataFrame(columns=["timestamp", "sensor_id", "value"])

    timestamps, values, uuids = [], [], []
    for rec in records:
        samples = rec.get("data") or []
        if not samples:
            continue
        arr = np.asarray(samples, dtype=float)
        gain = rec.get("gain") or 1.0
        timestamps.append(rec["timestamp"])
        values.append(float(np.sqrt((arr**2).mean())) / gain)
        uuids.append(rec.get("uuid", ""))

    if not timestamps:
        return pd.DataFrame(columns=["timestamp", "sensor_id", "value"])

    # "GEOSCOPE-140" -> "vibration_140", so the sensor_type stays "vibration"
    # and picks up SENSOR_CONFIG["vibration"] while the id stays per-device.
    device = uuids[0].rsplit("-", 1)[-1] if uuids and "-" in uuids[0] else "unknown"

    result = pd.DataFrame({
        "timestamp": pd.to_datetime(timestamps, unit="ms", utc=True),
        "sensor_id": f"vibration_{device}",
        "value": values,
    })
    return result.sort_values("timestamp").reset_index(drop=True)


def parse_geoscope(filepath):
    """
    Dispatch a Geoscope file to the parser for its format.

    The same physical sensor reaches us two ways: as CSV exports, and as the
    gateway's JSON uploads. Per the one-parser-per-format convention, each has
    its own function and this only picks between them.
    """
    if filepath.lower().endswith(".json"):
        return parse_geoscope_json(filepath)
    return parse_geoscope_csv(filepath)
