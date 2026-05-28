"""
Visualizer tests verify:
  - Functions run without error on synthetic data
  - Axes / figure geometry (correct number of subplots)
  - Gap patches are drawn (red bars for gaps)
  - KPI text is present in sparkline title
  - Files are written when output_path is given
  - Integration: real data produces real PNGs
"""
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import pytest

from config import SENSOR_CONFIG
from gap_detector import detect_gaps
from loader import parse_apple_watch_csv, parse_geoscope_csv
from visualizer import (
    plot_sparkline,
    plot_sparklines_grid,
    plot_timeline_comparison,
    plot_timeline_strip,
)

# ---------------------------------------------------------------------------
# Synthetic fixtures
# ---------------------------------------------------------------------------

HR_CONFIG = SENSOR_CONFIG["heartrate"]
VIB_CONFIG = SENSOR_CONFIG["vibration"]


def make_df(start_iso, interval_sec, count, sensor_id, value=80.0):
    ts = pd.date_range(start=start_iso, periods=count, freq=f"{interval_sec}s", tz="UTC")
    return pd.DataFrame({"timestamp": ts, "sensor_id": sensor_id, "value": float(value)})


def make_gapped_df(start_iso, interval_sec, count, sensor_id, drop_from, drop_to):
    df = make_df(start_iso, interval_sec, count, sensor_id)
    return df.drop(index=range(drop_from, drop_to)).reset_index(drop=True)


@pytest.fixture
def hr_no_gap():
    df = make_df("2026-01-01T10:00:00Z", 5, 60, "heartrate", value=90.0)
    report = detect_gaps(df, HR_CONFIG)
    return df, report


@pytest.fixture
def hr_with_gap():
    df = make_gapped_df("2026-01-01T10:00:00Z", 5, 80, "heartrate", 20, 36)
    # gap from t=95s to t=175s → 80s > 60s threshold
    report = detect_gaps(df, HR_CONFIG)
    return df, report


@pytest.fixture
def vib_no_gap():
    # Simulate 1-second RMS bins (already aggregated)
    df = make_df("2026-01-01T10:00:00Z", 1, 60, "GEOSCOPE_SENSOR_140", value=200.0)
    report = detect_gaps(df, VIB_CONFIG, aggregated_interval_sec=1)
    return df, report


# ---------------------------------------------------------------------------
# plot_timeline_strip — single sensor
# ---------------------------------------------------------------------------

class TestTimelineStrip:
    def test_returns_fig_and_ax(self, hr_no_gap):
        df, report = hr_no_gap
        fig, ax = plot_timeline_strip(report)
        assert fig is not None
        assert ax is not None
        plt.close("all")

    def test_one_patch_when_no_gaps(self, hr_no_gap):
        _, report = hr_no_gap
        _, ax = plot_timeline_strip(report)
        # Only the green baseline bar — no red patches
        patches = ax.patches
        colors = [p.get_facecolor() for p in patches]
        import matplotlib.colors as mcolors
        green = mcolors.to_rgba("#2ecc71")
        red = mcolors.to_rgba("#e74c3c")
        assert any(_colors_close(c, green) for c in colors)
        assert not any(_colors_close(c, red) for c in colors)
        plt.close("all")

    def test_red_patch_present_when_gap_exists(self, hr_with_gap):
        _, report = hr_with_gap
        assert report["gap_count"] == 1
        _, ax = plot_timeline_strip(report)
        import matplotlib.colors as mcolors
        red = mcolors.to_rgba("#e74c3c")
        colors = [p.get_facecolor() for p in ax.patches]
        assert any(_colors_close(c, red) for c in colors)
        plt.close("all")

    def test_red_patch_width_matches_gap_duration(self, hr_with_gap):
        _, report = hr_with_gap
        gap_dur = report["gaps"][0]["duration_sec"]
        _, ax = plot_timeline_strip(report)
        import matplotlib.colors as mcolors
        red = mcolors.to_rgba("#e74c3c")
        red_widths = [p.get_width() for p in ax.patches
                      if _colors_close(p.get_facecolor(), red)]
        assert len(red_widths) == 1
        assert red_widths[0] == pytest.approx(gap_dur, rel=1e-3)
        plt.close("all")

    def test_custom_label_on_y_axis(self, hr_no_gap):
        _, report = hr_no_gap
        _, ax = plot_timeline_strip(report, label="My Sensor")
        labels = [t.get_text() for t in ax.get_yticklabels()]
        assert "My Sensor" in labels
        plt.close("all")

    def test_six_x_ticks(self, hr_no_gap):
        _, report = hr_no_gap
        _, ax = plot_timeline_strip(report)
        assert len(ax.get_xticks()) == 6
        plt.close("all")

    def test_ax_provided_externally(self, hr_no_gap):
        _, report = hr_no_gap
        external_fig, external_ax = plt.subplots()
        fig, ax = plot_timeline_strip(report, ax=external_ax)
        assert fig is external_fig
        assert ax is external_ax
        plt.close("all")

    def test_saves_file(self, hr_no_gap, tmp_path):
        _, report = hr_no_gap
        out = str(tmp_path / "strip.png")
        fig, _ = plot_timeline_strip(report)
        fig.savefig(out)
        assert os.path.exists(out)
        assert os.path.getsize(out) > 0
        plt.close("all")


# ---------------------------------------------------------------------------
# plot_sparkline — single sensor
# ---------------------------------------------------------------------------

class TestSparkline:
    def test_returns_fig_and_ax(self, hr_no_gap):
        df, report = hr_no_gap
        fig, ax = plot_sparkline(df, report, HR_CONFIG)
        assert fig is not None
        plt.close("all")

    def test_kpi_text_present(self, hr_no_gap):
        df, report = hr_no_gap
        _, ax = plot_sparkline(df, report, HR_CONFIG)
        # KPI is written via ax.text(), not set_title(), so check ax.texts
        all_text = " ".join(t.get_text() for t in ax.texts)
        assert "Uptime" in all_text
        assert "Completeness" in all_text
        assert "Gaps" in all_text
        assert "Longest gap" in all_text
        plt.close("all")

    def test_y_label_is_unit(self, hr_no_gap):
        df, report = hr_no_gap
        _, ax = plot_sparkline(df, report, HR_CONFIG)
        assert ax.get_ylabel() == HR_CONFIG["unit"]
        plt.close("all")

    def test_has_line_and_fill(self, hr_no_gap):
        df, report = hr_no_gap
        _, ax = plot_sparkline(df, report, HR_CONFIG)
        assert len(ax.lines) >= 1
        assert len(ax.collections) >= 1  # fill_between produces a PolyCollection
        plt.close("all")

    def test_gap_inserts_nan_break(self, hr_with_gap):
        df, report = hr_with_gap
        _, ax = plot_sparkline(df, report, HR_CONFIG)
        # The line should have NaN in it (gap break)
        line_data = ax.lines[0].get_ydata()
        assert any(pd.isna(v) for v in line_data)
        plt.close("all")

    def test_external_ax(self, hr_no_gap):
        df, report = hr_no_gap
        external_fig, external_ax = plt.subplots()
        fig, ax = plot_sparkline(df, report, HR_CONFIG, ax=external_ax)
        assert ax is external_ax
        plt.close("all")

    def test_saves_file(self, hr_no_gap, tmp_path):
        df, report = hr_no_gap
        out = str(tmp_path / "spark.png")
        fig, _ = plot_sparkline(df, report, HR_CONFIG)
        fig.savefig(out)
        assert os.path.exists(out)
        assert os.path.getsize(out) > 0
        plt.close("all")


# ---------------------------------------------------------------------------
# plot_timeline_comparison — multi-sensor
# ---------------------------------------------------------------------------

class TestTimelineComparison:
    def test_correct_subplot_count(self, hr_no_gap, vib_no_gap):
        _, r1 = hr_no_gap
        _, r2 = vib_no_gap
        fig = plot_timeline_comparison([r1, r2])
        assert len(fig.axes) == 2
        plt.close("all")

    def test_single_sensor_no_crash(self, hr_no_gap):
        _, report = hr_no_gap
        fig = plot_timeline_comparison([report])
        assert len(fig.axes) == 1
        plt.close("all")

    def test_shared_x_range(self, hr_no_gap, vib_no_gap):
        _, r1 = hr_no_gap
        _, r2 = vib_no_gap
        fig = plot_timeline_comparison([r1, r2])
        xlims = [ax.get_xlim() for ax in fig.axes]
        # All axes share the same x range
        assert all(lim == xlims[0] for lim in xlims)
        plt.close("all")

    def test_writes_file_when_path_given(self, hr_no_gap, vib_no_gap, tmp_path):
        _, r1 = hr_no_gap
        _, r2 = vib_no_gap
        out = str(tmp_path / "comparison.png")
        result = plot_timeline_comparison([r1, r2], output_path=out)
        assert result is None        # returns None when saving
        assert os.path.exists(out)
        assert os.path.getsize(out) > 0

    def test_returns_fig_when_no_path(self, hr_no_gap, vib_no_gap):
        _, r1 = hr_no_gap
        _, r2 = vib_no_gap
        fig = plot_timeline_comparison([r1, r2])
        assert fig is not None
        plt.close("all")


# ---------------------------------------------------------------------------
# plot_sparklines_grid — multi-sensor
# ---------------------------------------------------------------------------

class TestSparklineGrid:
    def test_correct_subplot_count(self, hr_no_gap, vib_no_gap):
        df1, r1 = hr_no_gap
        df2, r2 = vib_no_gap
        fig = plot_sparklines_grid([df1, df2], [r1, r2], [HR_CONFIG, VIB_CONFIG])
        assert len(fig.axes) == 2
        plt.close("all")

    def test_writes_file_when_path_given(self, hr_no_gap, vib_no_gap, tmp_path):
        df1, r1 = hr_no_gap
        df2, r2 = vib_no_gap
        out = str(tmp_path / "grid.png")
        result = plot_sparklines_grid(
            [df1, df2], [r1, r2], [HR_CONFIG, VIB_CONFIG], output_path=out
        )
        assert result is None
        assert os.path.exists(out)
        assert os.path.getsize(out) > 0

    def test_returns_fig_when_no_path(self, hr_no_gap, vib_no_gap):
        df1, r1 = hr_no_gap
        df2, r2 = vib_no_gap
        fig = plot_sparklines_grid([df1, df2], [r1, r2], [HR_CONFIG, VIB_CONFIG])
        assert fig is not None
        plt.close("all")

    def test_bottom_axis_has_xlabel(self, hr_no_gap, vib_no_gap):
        df1, r1 = hr_no_gap
        df2, r2 = vib_no_gap
        fig = plot_sparklines_grid([df1, df2], [r1, r2], [HR_CONFIG, VIB_CONFIG])
        assert fig.axes[-1].get_xlabel() == "Time (UTC)"
        plt.close("all")


# ---------------------------------------------------------------------------
# Integration — real data files write actual PNGs
# ---------------------------------------------------------------------------

REAL_AW = os.path.join(os.path.dirname(__file__), "..", "Time sync test_Heartrates.csv")
REAL_GS = os.path.join(os.path.dirname(__file__), "..", "sensor_plot_data_2026-04-17_162000_163500.csv")
PLOTS_DIR = os.path.join(os.path.dirname(__file__), "..", "plots")

both_real = pytest.mark.skipif(
    not (os.path.exists(REAL_AW) and os.path.exists(REAL_GS)),
    reason="real data files not found",
)


@both_real
class TestRealDataPlots:
    @pytest.fixture(scope="class")
    def real_data(self):
        hr_df = parse_apple_watch_csv(REAL_AW)
        hr_report = detect_gaps(hr_df, HR_CONFIG)
        vib_df = parse_geoscope_csv(REAL_GS)
        vib_report = detect_gaps(vib_df, VIB_CONFIG, aggregated_interval_sec=1)
        return hr_df, hr_report, vib_df, vib_report

    def test_timeline_comparison_png_written(self, real_data):
        _, hr_report, _, vib_report = real_data
        out = os.path.join(PLOTS_DIR, "timeline_comparison.png")
        plot_timeline_comparison([hr_report, vib_report], output_path=out)
        assert os.path.exists(out)
        assert os.path.getsize(out) > 10_000  # real PNG is well over 10KB

    def test_sparkline_grid_png_written(self, real_data):
        hr_df, hr_report, vib_df, vib_report = real_data
        out = os.path.join(PLOTS_DIR, "sparklines_grid.png")
        plot_sparklines_grid(
            [hr_df, vib_df],
            [hr_report, vib_report],
            [HR_CONFIG, VIB_CONFIG],
            output_path=out,
        )
        assert os.path.exists(out)
        assert os.path.getsize(out) > 10_000

    def test_hr_standalone_strip_written(self, real_data):
        _, hr_report, _, _ = real_data
        out = os.path.join(PLOTS_DIR, "hr_timeline_strip.png")
        fig, _ = plot_timeline_strip(hr_report)
        fig.savefig(out, dpi=150, bbox_inches="tight")
        plt.close("all")
        assert os.path.exists(out)

    def test_vib_standalone_sparkline_written(self, real_data):
        _, _, vib_df, vib_report = real_data
        out = os.path.join(PLOTS_DIR, "vib_sparkline.png")
        fig, _ = plot_sparkline(vib_df, vib_report, VIB_CONFIG)
        fig.savefig(out, dpi=150, bbox_inches="tight")
        plt.close("all")
        assert os.path.exists(out)


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _colors_close(c1, c2, tol=0.01):
    return all(abs(a - b) < tol for a, b in zip(c1, c2))
