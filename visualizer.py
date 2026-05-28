"""
Two outputs per sensor:
  - timeline_strip : horizontal bar, green=data present, red=gap
  - sparkline      : readings over time (area chart style)

Both functions accept a gap report (from detect_gaps) plus the raw aggregated
DataFrame so the sparkline has actual values to plot.

Multi-sensor helpers:
  - plot_timeline_comparison : stacks timeline strips for all sensors on one shared x-axis
  - plot_sparklines_grid     : one sparkline per sensor in a vertical grid, shared x-axis
"""

import matplotlib
matplotlib.use("Agg")  # headless — no display required

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import pandas as pd

# ---------------------------------------------------------------------------
# Colours (dark-theme-friendly, readable on white too)
# ---------------------------------------------------------------------------
COLOR_OK = "#2ecc71"           # green  — data present
COLOR_GAP = "#e74c3c"          # red    — gap
COLOR_NOT_WEARING = "#f39c12"  # amber  — watch not worn (Empatica only)
COLOR_SPARK = "#3498db"        # blue   — sparkline fill
COLOR_BG = "#1a1a2e"           # dark background (used in multi-sensor comparison)
COLOR_TEXT = "#ecf0f1"

ALPHA_FILL = 0.35


# ---------------------------------------------------------------------------
# Single-sensor: timeline strip
# ---------------------------------------------------------------------------

def plot_timeline_strip(report, ax=None, label=None):
    """
    Draw a single horizontal timeline strip onto ax (creates one if not given).
    Returns the Figure and Axes.

    report : dict returned by detect_gaps()
    label  : y-axis label; defaults to report["sensor_id"]
    """
    standalone = ax is None
    if standalone:
        fig, ax = plt.subplots(figsize=(12, 1.2))
    else:
        fig = ax.get_figure()

    window_start = report["window_start"]
    window_end = report["window_end"]
    total_sec = (window_end - window_start).total_seconds()

    if total_sec == 0:
        ax.set_xlim(0, 1)
        ax.barh(0, 1, color=COLOR_OK, height=0.6)
        _style_strip_ax(ax, label or report["sensor_id"])
        return fig, ax

    # Draw full window as green baseline, then paint not-wearing (amber) and gaps (red) on top
    ax.barh(0, total_sec, left=0, color=COLOR_OK, height=0.6)
    for period in report.get("not_wearing_periods", []):
        offset = (period["start"] - window_start).total_seconds()
        ax.barh(0, period["duration_sec"], left=offset, color=COLOR_NOT_WEARING, height=0.6)
    for gap in report["gaps"]:
        gap_offset = (gap["start"] - window_start).total_seconds()
        ax.barh(0, gap["duration_sec"], left=gap_offset, color=COLOR_GAP, height=0.6)

    ax.set_xlim(0, total_sec)
    _style_strip_ax(ax, label or report["sensor_id"])

    # x-ticks as wall-clock times
    tick_count = 6
    tick_offsets = [i * total_sec / (tick_count - 1) for i in range(tick_count)]
    tick_labels = [
        (window_start + pd.Timedelta(seconds=s)).strftime("%H:%M:%S")
        for s in tick_offsets
    ]
    ax.set_xticks(tick_offsets)
    ax.set_xticklabels(tick_labels, fontsize=7)

    if standalone:
        fig.tight_layout()

    return fig, ax


def _style_strip_ax(ax, label):
    ax.set_yticks([0])
    ax.set_yticklabels([label], fontsize=8)
    ax.tick_params(axis="y", length=0)
    ax.set_ylim(-0.5, 0.5)
    for spine in ["top", "right", "left"]:
        ax.spines[spine].set_visible(False)


# ---------------------------------------------------------------------------
# Single-sensor: sparkline
# ---------------------------------------------------------------------------

def plot_sparkline(df, report, sensor_config, ax=None):
    """
    Plot sensor readings over time as a filled area chart.
    Gaps are shown as breaks (nulls) — not zero-filled.

    df            : aggregated DataFrame [timestamp, sensor_id, value]
    report        : dict returned by detect_gaps()
    sensor_config : entry from SENSOR_CONFIG for this sensor type
    """
    standalone = ax is None
    if standalone:
        fig, ax = plt.subplots(figsize=(12, 3))
    else:
        fig = ax.get_figure()

    # Resample to display_bin_sec so the sparkline isn't over-plotted
    bin_sec = sensor_config["display_bin_sec"]
    agg = sensor_config["aggregation"]

    ts = df.set_index("timestamp")["value"].sort_index()

    # Insert NaN sentinels at gap boundaries so the area breaks visually
    for gap in report["gaps"]:
        ts[gap["start"] + pd.Timedelta(milliseconds=1)] = float("nan")
        ts[gap["end"] - pd.Timedelta(milliseconds=1)] = float("nan")
    ts = ts.sort_index()

    resampled = _resample(ts, f"{bin_sec}s", agg)

    ax.fill_between(resampled.index, resampled.values, alpha=ALPHA_FILL, color=COLOR_SPARK)
    ax.plot(resampled.index, resampled.values, color=COLOR_SPARK, linewidth=0.8)

    unit = sensor_config["unit"]
    ax.set_ylabel(unit, fontsize=8)
    ax.set_xlabel("Time (UTC)", fontsize=8)
    ax.tick_params(labelsize=7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    _add_kpi_text(ax, report)

    if standalone:
        fig.tight_layout()

    return fig, ax


def _resample(ts, rule, agg):
    if agg == "mean":
        return ts.resample(rule).mean()
    if agg == "max":
        return ts.resample(rule).max()
    if agg == "rms":
        return ts.resample(rule).apply(
            lambda s: (s**2).mean() ** 0.5 if len(s) > 0 else float("nan")
        )
    if agg == "binary":
        return ts.resample(rule).max()
    if agg == "sum":
        return ts.resample(rule).sum()
    return ts.resample(rule).mean()


def _add_kpi_text(ax, report):
    parts = [
        f"Uptime: {report['connection_uptime_pct']:.1f}%",
        f"Completeness: {report['data_completeness_pct']:.1f}%",
    ]
    if "not_wearing_pct" in report:
        parts.append(f"Not wearing: {report['not_wearing_pct']:.1f}%")
    parts += [
        f"Gaps: {report['gap_count']}",
        f"Longest gap: {report['longest_gap_sec']:.0f}s",
    ]
    kpi = "  |  ".join(parts)
    # ax.text rather than set_title(loc="left") so the string is retrievable
    # via ax.texts in tests and is genuinely left-aligned above the plot
    ax.text(0, 1.02, kpi, transform=ax.transAxes, fontsize=8,
            verticalalignment="bottom", color="#555555")


# ---------------------------------------------------------------------------
# Multi-sensor: stacked timeline comparison
# ---------------------------------------------------------------------------

def plot_timeline_comparison(reports, output_path=None):
    """
    Stack one timeline strip per sensor on a shared x-axis.
    All windows are normalised to the earliest window_start across all sensors.

    reports     : list of detect_gaps() dicts
    output_path : if given, save to this path; otherwise return fig
    """
    n = len(reports)
    fig, axes = plt.subplots(n, 1, figsize=(14, 1.0 * n + 0.6), sharex=False)
    if n == 1:
        axes = [axes]

    # Global time range for shared x reference (seconds from earliest start)
    global_start = min(r["window_start"] for r in reports)

    for ax, report in zip(axes, reports):
        # Shift each sensor's window to global_start offset
        shifted = _shift_report(report, global_start)
        plot_timeline_strip(shifted, ax=ax, label=report["sensor_id"])

    # Common x-axis: wall-clock labels relative to global_start
    global_end = max(r["window_end"] for r in reports)
    total_sec = (global_end - global_start).total_seconds()
    tick_count = 8
    tick_offsets = [i * total_sec / (tick_count - 1) for i in range(tick_count)]
    tick_labels = [
        (global_start + pd.Timedelta(seconds=s)).strftime("%H:%M:%S")
        for s in tick_offsets
    ]
    for ax in axes:
        ax.set_xlim(0, total_sec)
        ax.set_xticks(tick_offsets)
        ax.set_xticklabels(tick_labels, fontsize=7)

    # Only bottom axis shows x-tick labels
    for ax in axes[:-1]:
        ax.tick_params(labelbottom=False)

    has_not_wearing = any(r.get("not_wearing_periods") for r in reports)
    legend_patches = [
        mpatches.Patch(color=COLOR_OK, label="Data present"),
        mpatches.Patch(color=COLOR_GAP, label="Gap"),
    ]
    if has_not_wearing:
        legend_patches.insert(1, mpatches.Patch(color=COLOR_NOT_WEARING, label="Not wearing"))
    fig.legend(handles=legend_patches, loc="upper right", fontsize=8, framealpha=0.7)
    fig.suptitle("Sensor timeline comparison", fontsize=10, y=1.01)
    fig.tight_layout()

    if output_path:
        fig.savefig(output_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        return None

    return fig


def _shift_report(report, global_start):
    """Return a copy of report with gaps re-expressed as offsets from global_start."""
    offset = (report["window_start"] - global_start).total_seconds()
    shifted_gaps = [
        {
            "start": global_start + pd.Timedelta(seconds=offset + (g["start"] - report["window_start"]).total_seconds()),
            "end": global_start + pd.Timedelta(seconds=offset + (g["end"] - report["window_start"]).total_seconds()),
            "duration_sec": g["duration_sec"],
        }
        for g in report["gaps"]
    ]
    return {
        **report,
        "window_start": global_start + pd.Timedelta(seconds=offset),
        "window_end": global_start + pd.Timedelta(seconds=offset + (report["window_end"] - report["window_start"]).total_seconds()),
        "gaps": shifted_gaps,
    }


# ---------------------------------------------------------------------------
# Multi-sensor: sparkline grid
# ---------------------------------------------------------------------------

def plot_sparklines_grid(dfs, reports, sensor_configs, output_path=None):
    """
    One sparkline per sensor, stacked vertically with a shared x-axis (wall clock).

    dfs            : list of DataFrames (matched order with reports)
    reports        : list of detect_gaps() dicts
    sensor_configs : list of SENSOR_CONFIG entries (matched order)
    output_path    : if given, save to this path; otherwise return fig
    """
    n = len(reports)
    fig, axes = plt.subplots(n, 1, figsize=(14, 3 * n), sharex=True)
    if n == 1:
        axes = [axes]

    for ax, df, report, cfg in zip(axes, dfs, reports, sensor_configs):
        plot_sparkline(df, report, cfg, ax=ax)
        ax.set_xlabel("")  # only bottom axis gets label

    axes[-1].set_xlabel("Time (UTC)", fontsize=8)
    fig.tight_layout()

    if output_path:
        fig.savefig(output_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        return None

    return fig
