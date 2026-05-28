import os
import textwrap

import numpy as np
import pytest

from loader import parse_apple_watch_csv, parse_geoscope_csv, parse_generic_csv

# ---------------------------------------------------------------------------
# Synthetic CSV strings — unit tests run without touching the real data files
# ---------------------------------------------------------------------------

APPLE_WATCH_CSV = textwrap.dedent("""\
    Time,Avg Heart Rate
    2026-01-01T10:00:00-07:00,80,TestWatch
    2026-01-01T10:00:05-07:00,82,TestWatch
    2026-01-01T10:00:10-07:00,84,TestWatch
""")

# 5 rows: 3 readings in second 0, 2 readings in second 1
GEOSCOPE_CSV = textwrap.dedent("""\
    sensor,timestamp_unix_ms,timestamp_pacific,reading
    GEOSCOPE_SENSOR_1,1000000000000,2026-01-01T10:00:00.000000-07:00,100.0
    GEOSCOPE_SENSOR_1,1000000000002,2026-01-01T10:00:00.002000-07:00,200.0
    GEOSCOPE_SENSOR_1,1000000000004,2026-01-01T10:00:00.004000-07:00,300.0
    GEOSCOPE_SENSOR_1,1000000000006,2026-01-01T10:00:01.000000-07:00,400.0
    GEOSCOPE_SENSOR_1,1000000000008,2026-01-01T10:00:01.002000-07:00,500.0
""")

GENERIC_CSV = textwrap.dedent("""\
    ts,reading
    2026-01-01T10:00:00-07:00,1.5
    2026-01-01T10:01:00-07:00,2.5
    2026-01-01T10:02:00-07:00,3.5
""")

EXPECTED_COLUMNS = ["timestamp", "sensor_id", "value"]

# Expected RMS values for the synthetic Geoscope data
# Second 0: values [100, 200, 300]  → sqrt((10000+40000+90000)/3) ≈ 216.025
# Second 1: values [400, 500]       → sqrt((160000+250000)/2)     ≈ 452.769
RMS_S0 = np.sqrt((100**2 + 200**2 + 300**2) / 3)
RMS_S1 = np.sqrt((400**2 + 500**2) / 2)


@pytest.fixture
def apple_watch_file(tmp_path):
    p = tmp_path / "heartrate.csv"
    p.write_text(APPLE_WATCH_CSV)
    return str(p)


@pytest.fixture
def geoscope_file(tmp_path):
    p = tmp_path / "vibration.csv"
    p.write_text(GEOSCOPE_CSV)
    return str(p)


@pytest.fixture
def generic_file(tmp_path):
    p = tmp_path / "generic.csv"
    p.write_text(GENERIC_CSV)
    return str(p)


# ---------------------------------------------------------------------------
# Apple Watch parser
# ---------------------------------------------------------------------------

class TestAppleWatchParser:
    def test_output_columns(self, apple_watch_file):
        df = parse_apple_watch_csv(apple_watch_file)
        assert list(df.columns) == EXPECTED_COLUMNS

    def test_timestamp_is_utc(self, apple_watch_file):
        df = parse_apple_watch_csv(apple_watch_file)
        assert df["timestamp"].dt.tz is not None
        assert str(df["timestamp"].dt.tz) == "UTC"

    def test_sensor_id_is_heartrate(self, apple_watch_file):
        df = parse_apple_watch_csv(apple_watch_file)
        assert (df["sensor_id"] == "heartrate").all()

    def test_value_dtype_is_float(self, apple_watch_file):
        df = parse_apple_watch_csv(apple_watch_file)
        assert df["value"].dtype == float

    def test_row_count(self, apple_watch_file):
        df = parse_apple_watch_csv(apple_watch_file)
        assert len(df) == 3

    def test_values_correct(self, apple_watch_file):
        df = parse_apple_watch_csv(apple_watch_file)
        assert list(df["value"]) == [80.0, 82.0, 84.0]

    def test_no_device_name_in_output(self, apple_watch_file):
        df = parse_apple_watch_csv(apple_watch_file)
        assert set(df.columns) == set(EXPECTED_COLUMNS)
        assert "TestWatch" not in df["sensor_id"].values

    def test_timestamps_are_sorted(self, apple_watch_file):
        df = parse_apple_watch_csv(apple_watch_file)
        assert df["timestamp"].is_monotonic_increasing

    def test_no_nulls(self, apple_watch_file):
        df = parse_apple_watch_csv(apple_watch_file)
        assert df.notna().all().all()


# ---------------------------------------------------------------------------
# Geoscope parser
# ---------------------------------------------------------------------------

class TestGeoscopeParser:
    def test_output_columns(self, geoscope_file):
        df = parse_geoscope_csv(geoscope_file)
        assert list(df.columns) == EXPECTED_COLUMNS

    def test_timestamp_is_utc(self, geoscope_file):
        df = parse_geoscope_csv(geoscope_file)
        assert df["timestamp"].dt.tz is not None
        assert str(df["timestamp"].dt.tz) == "UTC"

    def test_rms_aggregation_reduces_rows(self, geoscope_file):
        # 5 raw rows spanning 2 seconds → 2 aggregated rows
        df = parse_geoscope_csv(geoscope_file)
        assert len(df) == 2

    def test_rms_values_second_0(self, geoscope_file):
        df = parse_geoscope_csv(geoscope_file)
        assert df["value"].iloc[0] == pytest.approx(RMS_S0, rel=1e-3)

    def test_rms_values_second_1(self, geoscope_file):
        df = parse_geoscope_csv(geoscope_file)
        assert df["value"].iloc[1] == pytest.approx(RMS_S1, rel=1e-3)

    def test_sensor_id_from_file(self, geoscope_file):
        df = parse_geoscope_csv(geoscope_file)
        assert (df["sensor_id"] == "GEOSCOPE_SENSOR_1").all()

    def test_value_dtype_is_float(self, geoscope_file):
        df = parse_geoscope_csv(geoscope_file)
        assert df["value"].dtype == float

    def test_no_raw_columns_in_output(self, geoscope_file):
        df = parse_geoscope_csv(geoscope_file)
        for col in ["reading", "timestamp_unix_ms", "timestamp_pacific", "sensor"]:
            assert col not in df.columns

    def test_timestamps_are_sorted(self, geoscope_file):
        df = parse_geoscope_csv(geoscope_file)
        assert df["timestamp"].is_monotonic_increasing

    def test_no_nulls(self, geoscope_file):
        df = parse_geoscope_csv(geoscope_file)
        assert df.notna().all().all()


# ---------------------------------------------------------------------------
# Generic CSV parser
# ---------------------------------------------------------------------------

class TestGenericParser:
    def test_output_columns(self, generic_file):
        df = parse_generic_csv(generic_file, "ts", "reading", "pressure")
        assert list(df.columns) == EXPECTED_COLUMNS

    def test_sensor_id_passed_through(self, generic_file):
        df = parse_generic_csv(generic_file, "ts", "reading", "pressure")
        assert (df["sensor_id"] == "pressure").all()

    def test_timestamp_is_utc(self, generic_file):
        df = parse_generic_csv(generic_file, "ts", "reading", "pressure")
        assert str(df["timestamp"].dt.tz) == "UTC"

    def test_values_correct(self, generic_file):
        df = parse_generic_csv(generic_file, "ts", "reading", "pressure")
        assert list(df["value"]) == [1.5, 2.5, 3.5]


# ---------------------------------------------------------------------------
# Integration tests — use real data files, skipped if files are absent
# ---------------------------------------------------------------------------

REAL_AW = os.path.join(os.path.dirname(__file__), "..", "Time sync test_Heartrates.csv")
REAL_GS = os.path.join(os.path.dirname(__file__), "..", "sensor_plot_data_2026-04-17_162000_163500.csv")


@pytest.mark.skipif(not os.path.exists(REAL_AW), reason="real Apple Watch file not found")
class TestAppleWatchRealFile:
    def test_row_count(self):
        df = parse_apple_watch_csv(REAL_AW)
        assert len(df) == 319  # wc -l undercounts by 1 (no trailing newline)

    def test_columns(self):
        df = parse_apple_watch_csv(REAL_AW)
        assert list(df.columns) == EXPECTED_COLUMNS

    def test_no_nulls(self):
        df = parse_apple_watch_csv(REAL_AW)
        assert df.notna().all().all()

    def test_hr_values_in_range(self):
        df = parse_apple_watch_csv(REAL_AW)
        assert df["value"].between(30, 220).all()


@pytest.mark.skipif(not os.path.exists(REAL_GS), reason="real Geoscope file not found")
class TestGeoscopeRealFile:
    def test_aggregation_reduces_rows_dramatically(self):
        df = parse_geoscope_csv(REAL_GS)
        # 414,632 raw rows → ~838 one-second bins (14-min window)
        assert len(df) < 1000
        assert len(df) > 800

    def test_columns(self):
        df = parse_geoscope_csv(REAL_GS)
        assert list(df.columns) == EXPECTED_COLUMNS

    def test_sensor_id(self):
        df = parse_geoscope_csv(REAL_GS)
        assert (df["sensor_id"] == "GEOSCOPE_SENSOR_140").all()

    def test_no_nulls(self):
        df = parse_geoscope_csv(REAL_GS)
        assert df.notna().all().all()
