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
