import os

import pandas as pd
import pytest

from config import SENSOR_CONFIG
from gap_detector import detect_gaps
from loader import parse_apple_watch_csv, parse_geoscope_csv

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

HR_CONFIG = SENSOR_CONFIG["heartrate"]      # interval=5s, threshold=60s
VIB_CONFIG = SENSOR_CONFIG["vibration"]    # interval=0.002s, threshold=5s

REQUIRED_KEYS = {
    "sensor_id", "window_start", "window_end",
    "connection_uptime_pct", "data_completeness_pct",
    "gap_count", "longest_gap_sec", "gaps",
}


def make_regular_df(start_iso, interval_sec, count, sensor_id="heartrate"):
    """Continuous regular-interval DataFrame — no gaps."""
    ts = pd.date_range(start=start_iso, periods=count, freq=f"{interval_sec}s", tz="UTC")
    return pd.DataFrame({"timestamp": ts, "sensor_id": sensor_id, "value": 80.0})


def insert_gap(df, drop_from_idx, drop_to_idx):
    """Drop a contiguous slice of rows to simulate a gap, return reset DataFrame."""
    return df.drop(index=range(drop_from_idx, drop_to_idx)).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

class TestOutputSchema:
    def test_all_required_keys_present(self):
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 10)
        report = detect_gaps(df, HR_CONFIG)
        assert REQUIRED_KEYS == set(report.keys())

    def test_gaps_list_items_have_correct_keys(self):
        # create a 90s gap → one gap item
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 40)
        df = insert_gap(df, 10, 28)  # drops t=50..135, gap = 135-45 = 90s
        report = detect_gaps(df, HR_CONFIG)
        assert report["gap_count"] == 1
        gap = report["gaps"][0]
        assert set(gap.keys()) == {"start", "end", "duration_sec"}


# ---------------------------------------------------------------------------
# No-gap cases
# ---------------------------------------------------------------------------

class TestNoGaps:
    def test_gap_count_zero(self):
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 60)
        assert detect_gaps(df, HR_CONFIG)["gap_count"] == 0

    def test_connection_uptime_100(self):
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 60)
        assert detect_gaps(df, HR_CONFIG)["connection_uptime_pct"] == 100.0

    def test_data_completeness_100(self):
        # Regular data — actual rows slightly exceed expected (window = N-1 intervals)
        # so completeness is capped at 100
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 60)
        assert detect_gaps(df, HR_CONFIG)["data_completeness_pct"] == 100.0

    def test_longest_gap_zero(self):
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 60)
        assert detect_gaps(df, HR_CONFIG)["longest_gap_sec"] == 0.0

    def test_gaps_list_empty(self):
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 60)
        assert detect_gaps(df, HR_CONFIG)["gaps"] == []


# ---------------------------------------------------------------------------
# Threshold boundary (heartrate threshold = 60s)
# ---------------------------------------------------------------------------

class TestThresholdBoundary:
    def test_gap_exactly_at_threshold_not_flagged(self):
        # Gap of exactly 60s: delta == threshold, not > threshold
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 20)
        # t=95 is last before gap; next row should be at t=95+60=155
        df.loc[10, "timestamp"] = df.loc[9, "timestamp"] + pd.Timedelta(seconds=60)
        df = df.iloc[:11]  # keep just enough to test boundary
        # Actually rebuild cleanly:
        ts_before = pd.date_range("2026-01-01T00:00:00Z", periods=10, freq="5s", tz="UTC")
        ts_after = pd.date_range(
            ts_before[-1] + pd.Timedelta(seconds=60), periods=10, freq="5s", tz="UTC"
        )
        df = pd.DataFrame({
            "timestamp": list(ts_before) + list(ts_after),
            "sensor_id": "heartrate",
            "value": 80.0,
        })
        report = detect_gaps(df, HR_CONFIG)
        assert report["gap_count"] == 0

    def test_gap_one_second_over_threshold_is_flagged(self):
        ts_before = pd.date_range("2026-01-01T00:00:00Z", periods=10, freq="5s", tz="UTC")
        ts_after = pd.date_range(
            ts_before[-1] + pd.Timedelta(seconds=61), periods=10, freq="5s", tz="UTC"
        )
        df = pd.DataFrame({
            "timestamp": list(ts_before) + list(ts_after),
            "sensor_id": "heartrate",
            "value": 80.0,
        })
        report = detect_gaps(df, HR_CONFIG)
        assert report["gap_count"] == 1
        assert report["gaps"][0]["duration_sec"] == 61.0


# ---------------------------------------------------------------------------
# Single gap — correctness of measurements
# ---------------------------------------------------------------------------

class TestSingleGap:
    @pytest.fixture
    def gapped_df_and_expected(self):
        # 40 rows at 5s: t=0..195. Drop rows 20..29 → gap from t=95 to t=150 = 55s.
        # That's < 60s threshold. Use a larger drop to get a > 60s gap.
        # Drop rows 20..32 → gap from t=95 to t=165 = 70s (> 60s threshold).
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 40)
        df = insert_gap(df, 20, 33)   # drop indices 20..32 inclusive
        # gap_start = t=95, gap_end = t=165, duration = 70s
        gap_start_expected = pd.Timestamp("2026-01-01T00:01:35Z")  # t=95s
        gap_end_expected = pd.Timestamp("2026-01-01T00:02:45Z")    # t=165s
        return df, gap_start_expected, gap_end_expected, 70.0

    def test_gap_count(self, gapped_df_and_expected):
        df, *_ = gapped_df_and_expected
        assert detect_gaps(df, HR_CONFIG)["gap_count"] == 1

    def test_gap_duration(self, gapped_df_and_expected):
        df, _, _, expected_dur = gapped_df_and_expected
        report = detect_gaps(df, HR_CONFIG)
        assert report["gaps"][0]["duration_sec"] == expected_dur

    def test_gap_start_timestamp(self, gapped_df_and_expected):
        df, expected_start, _, _ = gapped_df_and_expected
        report = detect_gaps(df, HR_CONFIG)
        assert report["gaps"][0]["start"] == expected_start

    def test_gap_end_timestamp(self, gapped_df_and_expected):
        df, _, expected_end, _ = gapped_df_and_expected
        report = detect_gaps(df, HR_CONFIG)
        assert report["gaps"][0]["end"] == expected_end

    def test_longest_gap_matches_only_gap(self, gapped_df_and_expected):
        df, _, _, expected_dur = gapped_df_and_expected
        report = detect_gaps(df, HR_CONFIG)
        assert report["longest_gap_sec"] == expected_dur

    def test_connection_uptime(self, gapped_df_and_expected):
        df, *_ = gapped_df_and_expected
        report = detect_gaps(df, HR_CONFIG)
        # window = t=0 to t=195 - (40-13 rows) * 5 = 27 rows → last t = 26*5=130 + 165...
        # Recompute: after dropping 13 rows (20..32), 27 rows remain: t=0..95 (20 rows) + t=165..195 (7 rows)
        # last timestamp = t=165 + 6*5 = t=195
        # window_duration = 195s, gap = 70s
        # uptime = (195-70)/195 * 100 = 125/195 * 100 ≈ 64.10%
        assert report["connection_uptime_pct"] == pytest.approx(125 / 195 * 100, abs=0.01)

    def test_data_completeness(self, gapped_df_and_expected):
        df, *_ = gapped_df_and_expected
        report = detect_gaps(df, HR_CONFIG)
        # window = 195s, expected_rows = 195/5 = 39, actual = 27
        # completeness = 27/39 * 100 ≈ 69.23%
        assert report["data_completeness_pct"] == pytest.approx(27 / 39 * 100, abs=0.01)


# ---------------------------------------------------------------------------
# Multiple gaps
# ---------------------------------------------------------------------------

class TestMultipleGaps:
    @pytest.fixture
    def two_gap_df(self):
        # 60 rows at 5s: t=0..295
        # Gap 1: drop rows 10..22 → t=45 to t=115, duration=70s
        # Gap 2: drop rows 35..49 → after first drop, indices shift; rebuild explicitly
        ts = pd.date_range("2026-01-01T00:00:00Z", periods=60, freq="5s", tz="UTC")
        # Keep: 0..44 (t=0..220) skip t=225..285, keep t=290..295
        # Actually let's be explicit: keep t where t not in gap ranges
        keep = [t for t in ts if not (
            pd.Timestamp("2026-01-01T00:00:50Z") < t < pd.Timestamp("2026-01-01T00:02:00Z") or
            pd.Timestamp("2026-01-01T00:03:00Z") < t < pd.Timestamp("2026-01-01T00:04:10Z")
        )]
        return pd.DataFrame({"timestamp": keep, "sensor_id": "heartrate", "value": 80.0})

    def test_gap_count_is_two(self, two_gap_df):
        report = detect_gaps(two_gap_df, HR_CONFIG)
        assert report["gap_count"] == 2

    def test_longest_gap_is_larger_one(self, two_gap_df):
        report = detect_gaps(two_gap_df, HR_CONFIG)
        # Both gaps are > 60s; longest_gap_sec should be the larger of the two
        durations = [g["duration_sec"] for g in report["gaps"]]
        assert report["longest_gap_sec"] == max(durations)


# ---------------------------------------------------------------------------
# Window metadata
# ---------------------------------------------------------------------------

class TestWindowMetadata:
    def test_window_start_is_first_timestamp(self):
        df = make_regular_df("2026-01-01T06:00:00Z", 5, 20)
        report = detect_gaps(df, HR_CONFIG)
        assert report["window_start"] == df["timestamp"].iloc[0]

    def test_window_end_is_last_timestamp(self):
        df = make_regular_df("2026-01-01T06:00:00Z", 5, 20)
        report = detect_gaps(df, HR_CONFIG)
        assert report["window_end"] == df["timestamp"].iloc[-1]

    def test_sensor_id_propagated(self):
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 10, sensor_id="bed_sensor")
        assert detect_gaps(df, HR_CONFIG)["sensor_id"] == "bed_sensor"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_single_row_no_crash(self):
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 1)
        report = detect_gaps(df, HR_CONFIG)
        assert report["gap_count"] == 0
        assert report["connection_uptime_pct"] == 100.0
        assert report["data_completeness_pct"] == 100.0

    def test_empty_dataframe_no_crash(self):
        df = pd.DataFrame(columns=["timestamp", "sensor_id", "value"])
        report = detect_gaps(df, HR_CONFIG)
        assert report["gap_count"] == 0
        assert report["sensor_id"] == ""
        assert report["window_start"] is None

    def test_unsorted_input_still_correct(self):
        df = make_regular_df("2026-01-01T00:00:00Z", 5, 20)
        df = df.sample(frac=1, random_state=42).reset_index(drop=True)  # shuffle
        report = detect_gaps(df, HR_CONFIG)
        assert report["gap_count"] == 0


# ---------------------------------------------------------------------------
# Geoscope aggregated_interval_sec override
# ---------------------------------------------------------------------------

class TestAggregatedInterval:
    def test_geoscope_completeness_uses_aggregated_interval(self):
        # 60 one-second bins: window = 59s, expected_rows = 59/1 = 59, actual = 60 → 100%
        ts = pd.date_range("2026-01-01T00:00:00Z", periods=60, freq="1s", tz="UTC")
        df = pd.DataFrame({"timestamp": ts, "sensor_id": "GEOSCOPE_SENSOR_140", "value": 200.0})
        # Without override: expected = 59 / 0.002 = 29,500 → completeness ≈ 0.2%
        report_raw = detect_gaps(df, VIB_CONFIG)
        assert report_raw["data_completeness_pct"] < 1.0  # confirms the problem

        # With override: expected = 59 / 1 = 59 → completeness = 100%
        report_agg = detect_gaps(df, VIB_CONFIG, aggregated_interval_sec=1)
        assert report_agg["data_completeness_pct"] == 100.0

    def test_aggregated_interval_does_not_affect_gap_detection(self):
        # Gap detection still uses gap_threshold_sec from config regardless
        ts = pd.date_range("2026-01-01T00:00:00Z", periods=10, freq="1s", tz="UTC")
        # Insert 10s gap (> 5s vibration threshold)
        ts_after = pd.date_range(
            ts[-1] + pd.Timedelta(seconds=10), periods=10, freq="1s", tz="UTC"
        )
        df = pd.DataFrame({
            "timestamp": list(ts) + list(ts_after),
            "sensor_id": "GEOSCOPE_SENSOR_140",
            "value": 200.0,
        })
        report = detect_gaps(df, VIB_CONFIG, aggregated_interval_sec=1)
        assert report["gap_count"] == 1
        assert report["gaps"][0]["duration_sec"] == 10.0


# ---------------------------------------------------------------------------
# Integration — real data files
# ---------------------------------------------------------------------------

REAL_AW = os.path.join(os.path.dirname(__file__), "..", "Time sync test_Heartrates.csv")
REAL_GS = os.path.join(os.path.dirname(__file__), "..", "sensor_plot_data_2026-04-17_162000_163500.csv")


@pytest.mark.skipif(not os.path.exists(REAL_AW), reason="real Apple Watch file not found")
class TestAppleWatchGapReport:
    @pytest.fixture(scope="class")
    def report(self):
        return detect_gaps(parse_apple_watch_csv(REAL_AW), HR_CONFIG)

    def test_sensor_id(self, report):
        assert report["sensor_id"] == "heartrate"

    def test_window_covers_full_recording(self, report):
        # Recording ran ~27 minutes
        duration = (report["window_end"] - report["window_start"]).total_seconds()
        assert 1500 < duration < 1800

    def test_data_completeness_reasonable(self, report):
        # Apple Watch occasionally drops samples; expect >85%
        assert report["data_completeness_pct"] > 85.0

    def test_connection_uptime_reasonable(self, report):
        assert report["connection_uptime_pct"] > 85.0

    def test_no_gap_below_57s_threshold(self, report):
        # Known baseline: Apple Watch gaps up to ~57s are normal and below the 60s threshold
        # So all detected gaps should be >= 60s (strictly over threshold)
        for gap in report["gaps"]:
            assert gap["duration_sec"] > HR_CONFIG["gap_threshold_sec"]

    def test_report_is_json_serialisable_types(self, report):
        # window_start/end should be Timestamps, gaps list should be a list
        assert isinstance(report["gaps"], list)
        assert isinstance(report["gap_count"], int)
        assert isinstance(report["longest_gap_sec"], float)


@pytest.mark.skipif(not os.path.exists(REAL_GS), reason="real Geoscope file not found")
class TestGeoscopeGapReport:
    @pytest.fixture(scope="class")
    def report(self):
        df = parse_geoscope_csv(REAL_GS)
        return detect_gaps(df, VIB_CONFIG, aggregated_interval_sec=1)

    def test_sensor_id(self, report):
        assert report["sensor_id"] == "GEOSCOPE_SENSOR_140"

    def test_window_covers_full_recording(self, report):
        # Recording ran ~14 minutes
        duration = (report["window_end"] - report["window_start"]).total_seconds()
        assert 800 < duration < 900

    def test_no_gaps_in_continuous_recording(self, report):
        # Expect no gaps in this clean continuous test file
        assert report["gap_count"] == 0

    def test_data_completeness_near_100(self, report):
        assert report["data_completeness_pct"] == 100.0

    def test_connection_uptime_100(self, report):
        assert report["connection_uptime_pct"] == 100.0
