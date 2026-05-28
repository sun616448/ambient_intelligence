"""
Tests for run.py — the pipeline entry point.

Unit tests use tmp_path and synthetic files (no real data required).
Integration tests use the real sample files and are skipped if absent.
"""

import json
import os
import textwrap

import pytest

from run import detect_sensor_type, run_pipeline

# ---------------------------------------------------------------------------
# Synthetic CSV content (mirrors fixtures in test_loader.py)
# ---------------------------------------------------------------------------

APPLE_WATCH_CSV = textwrap.dedent("""\
    Time,Avg Heart Rate
    2026-01-01T10:00:00-07:00,80,TestWatch
    2026-01-01T10:00:05-07:00,82,TestWatch
    2026-01-01T10:02:00-07:00,85,TestWatch
    2026-01-01T10:04:00-07:00,88,TestWatch
    2026-01-01T10:06:00-07:00,90,TestWatch
    2026-01-01T10:08:00-07:00,87,TestWatch
""")

# 4 rows across 3 seconds → 2 one-second RMS bins after aggregation
GEOSCOPE_CSV = textwrap.dedent("""\
    sensor,timestamp_unix_ms,timestamp_pacific,reading
    GEOSCOPE_SENSOR_1,1000000000000,2026-01-01T10:00:00.000000-07:00,100.0
    GEOSCOPE_SENSOR_1,1000000000002,2026-01-01T10:00:00.002000-07:00,200.0
    GEOSCOPE_SENSOR_1,1000000000004,2026-01-01T10:00:01.000000-07:00,300.0
    GEOSCOPE_SENSOR_1,1000000000006,2026-01-01T10:00:01.002000-07:00,400.0
""")


@pytest.fixture
def hr_file(tmp_path):
    p = tmp_path / "hr.csv"
    p.write_text(APPLE_WATCH_CSV)
    return str(p)


@pytest.fixture
def vib_file(tmp_path):
    p = tmp_path / "vib.csv"
    p.write_text(GEOSCOPE_CSV)
    return str(p)


# ---------------------------------------------------------------------------
# Auto-detection
# ---------------------------------------------------------------------------

class TestDetectSensorType:
    def test_detects_heartrate(self, hr_file):
        assert detect_sensor_type(hr_file) == "heartrate"

    def test_detects_vibration(self, vib_file):
        assert detect_sensor_type(vib_file) == "vibration"

    def test_unknown_returns_none(self, tmp_path):
        f = tmp_path / "unknown.csv"
        f.write_text("col_a,col_b\n1,2\n")
        assert detect_sensor_type(str(f)) is None


# ---------------------------------------------------------------------------
# Return value
# ---------------------------------------------------------------------------

class TestReturnValue:
    def test_returns_dict(self, hr_file, vib_file, tmp_path):
        result = run_pipeline([("heartrate", hr_file), ("vibration", vib_file)], out_dir=str(tmp_path))
        assert isinstance(result, dict)

    def test_keys_are_sensor_ids(self, hr_file, vib_file, tmp_path):
        result = run_pipeline([("heartrate", hr_file), ("vibration", vib_file)], out_dir=str(tmp_path))
        assert "heartrate" in result
        assert "GEOSCOPE_SENSOR_1" in result

    def test_each_report_has_required_fields(self, hr_file, vib_file, tmp_path):
        result = run_pipeline([("heartrate", hr_file), ("vibration", vib_file)], out_dir=str(tmp_path))
        required = {
            "sensor_id", "window_start", "window_end",
            "connection_uptime_pct", "data_completeness_pct",
            "gap_count", "longest_gap_sec", "gaps",
        }
        for report in result.values():
            assert required <= set(report.keys())

    def test_hr_only_returns_one_key(self, hr_file, tmp_path):
        result = run_pipeline([("heartrate", hr_file)], out_dir=str(tmp_path))
        assert list(result.keys()) == ["heartrate"]

    def test_vib_only_returns_one_key(self, vib_file, tmp_path):
        result = run_pipeline([("vibration", vib_file)], out_dir=str(tmp_path))
        assert "GEOSCOPE_SENSOR_1" in result

    def test_empty_sensors_returns_empty_dict(self, tmp_path):
        result = run_pipeline([], out_dir=str(tmp_path))
        assert result == {}

    def test_missing_file_skipped_gracefully(self, tmp_path):
        result = run_pipeline(
            [("heartrate", "/nonexistent/hr.csv"), ("vibration", "/nonexistent/vib.csv")],
            out_dir=str(tmp_path),
        )
        assert result == {}

    def test_unknown_sensor_type_skipped(self, tmp_path, hr_file):
        result = run_pipeline([("banana_sensor", hr_file)], out_dir=str(tmp_path))
        assert result == {}


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------

class TestJsonOutput:
    def test_hr_json_written(self, hr_file, tmp_path):
        run_pipeline([("heartrate", hr_file)], out_dir=str(tmp_path))
        assert (tmp_path / "gap_report_heartrate.json").exists()

    def test_vib_json_written(self, vib_file, tmp_path):
        run_pipeline([("vibration", vib_file)], out_dir=str(tmp_path))
        assert (tmp_path / "gap_report_vibration.json").exists()

    def test_json_is_valid(self, hr_file, tmp_path):
        run_pipeline([("heartrate", hr_file)], out_dir=str(tmp_path))
        with open(tmp_path / "gap_report_heartrate.json") as f:
            data = json.load(f)
        assert data["sensor_id"] == "heartrate"

    def test_json_timestamps_are_strings(self, hr_file, tmp_path):
        run_pipeline([("heartrate", hr_file)], out_dir=str(tmp_path))
        with open(tmp_path / "gap_report_heartrate.json") as f:
            data = json.load(f)
        assert isinstance(data["window_start"], str)
        assert isinstance(data["window_end"], str)

    def test_json_has_generated_at(self, hr_file, tmp_path):
        run_pipeline([("heartrate", hr_file)], out_dir=str(tmp_path))
        with open(tmp_path / "gap_report_heartrate.json") as f:
            data = json.load(f)
        assert "generated_at" in data

    def test_json_gaps_timestamps_are_strings(self, hr_file, tmp_path):
        run_pipeline([("heartrate", hr_file)], out_dir=str(tmp_path))
        with open(tmp_path / "gap_report_heartrate.json") as f:
            data = json.load(f)
        for gap in data["gaps"]:
            assert isinstance(gap["start"], str)
            assert isinstance(gap["end"], str)

    def test_no_json_written_when_no_sensors(self, tmp_path):
        run_pipeline([], out_dir=str(tmp_path))
        assert list(tmp_path.glob("*.json")) == []


# ---------------------------------------------------------------------------
# PNG output
# ---------------------------------------------------------------------------

class TestPngOutput:
    def test_timeline_png_written(self, hr_file, vib_file, tmp_path):
        run_pipeline([("heartrate", hr_file), ("vibration", vib_file)], out_dir=str(tmp_path))
        assert (tmp_path / "timeline_comparison.png").exists()

    def test_sparkline_grid_png_written(self, hr_file, vib_file, tmp_path):
        run_pipeline([("heartrate", hr_file), ("vibration", vib_file)], out_dir=str(tmp_path))
        assert (tmp_path / "sparklines_grid.png").exists()

    def test_pngs_are_non_empty(self, hr_file, vib_file, tmp_path):
        run_pipeline([("heartrate", hr_file), ("vibration", vib_file)], out_dir=str(tmp_path))
        assert os.path.getsize(tmp_path / "timeline_comparison.png") > 1000
        assert os.path.getsize(tmp_path / "sparklines_grid.png") > 1000

    def test_pngs_still_written_with_single_sensor(self, hr_file, tmp_path):
        run_pipeline([("heartrate", hr_file)], out_dir=str(tmp_path))
        assert (tmp_path / "timeline_comparison.png").exists()
        assert (tmp_path / "sparklines_grid.png").exists()

    def test_per_sensor_sparkline_written(self, hr_file, vib_file, tmp_path):
        run_pipeline([("heartrate", hr_file), ("vibration", vib_file)], out_dir=str(tmp_path))
        assert (tmp_path / "heartrate_sparkline.png").exists()
        assert (tmp_path / "GEOSCOPE_SENSOR_1_sparkline.png").exists()

    def test_out_dir_created_if_missing(self, hr_file, tmp_path):
        new_dir = str(tmp_path / "new" / "nested" / "dir")
        run_pipeline([("heartrate", hr_file)], out_dir=new_dir)
        assert os.path.isdir(new_dir)


# ---------------------------------------------------------------------------
# Integration — real data files
# ---------------------------------------------------------------------------

REAL_AW = os.path.join(os.path.dirname(__file__), "..", "Time sync test_Heartrates.csv")
REAL_GS = os.path.join(os.path.dirname(__file__), "..", "sensor_plot_data_2026-04-17_162000_163500.csv")
PLOTS_DIR = os.path.join(os.path.dirname(__file__), "..", "plots")

both_real = pytest.mark.skipif(
    not (os.path.exists(REAL_AW) and os.path.exists(REAL_GS)),
    reason="real data files not found",
)


@both_real
class TestRealDataPipeline:
    @pytest.fixture(scope="class")
    def result(self):
        return run_pipeline(
            [("heartrate", REAL_AW), ("vibration", REAL_GS)],
            out_dir=PLOTS_DIR,
        )

    def test_both_sensors_in_result(self, result):
        assert "heartrate" in result
        assert "GEOSCOPE_SENSOR_140" in result

    def test_hr_window_duration(self, result):
        r = result["heartrate"]
        dur = (r["window_end"] - r["window_start"]).total_seconds()
        assert 1500 < dur < 1800  # ~27 min

    def test_vib_window_duration(self, result):
        r = result["GEOSCOPE_SENSOR_140"]
        dur = (r["window_end"] - r["window_start"]).total_seconds()
        assert 800 < dur < 900  # ~14 min

    def test_hr_completeness_reasonable(self, result):
        assert result["heartrate"]["data_completeness_pct"] > 85.0

    def test_vib_no_gaps(self, result):
        assert result["GEOSCOPE_SENSOR_140"]["gap_count"] == 0

    def test_json_files_written(self):
        assert os.path.exists(os.path.join(PLOTS_DIR, "gap_report_heartrate.json"))
        assert os.path.exists(os.path.join(PLOTS_DIR, "gap_report_vibration.json"))

    def test_png_files_written(self):
        assert os.path.exists(os.path.join(PLOTS_DIR, "timeline_comparison.png"))
        assert os.path.exists(os.path.join(PLOTS_DIR, "sparklines_grid.png"))

    def test_per_sensor_sparklines_written(self):
        assert os.path.exists(os.path.join(PLOTS_DIR, "heartrate_sparkline.png"))
        assert os.path.exists(os.path.join(PLOTS_DIR, "GEOSCOPE_SENSOR_140_sparkline.png"))

    def test_json_is_valid_and_complete(self):
        with open(os.path.join(PLOTS_DIR, "gap_report_heartrate.json")) as f:
            data = json.load(f)
        assert data["sensor_id"] == "heartrate"
        assert "generated_at" in data
        assert isinstance(data["window_start"], str)
