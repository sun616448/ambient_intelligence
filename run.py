"""
Entry point for the sensor gap analysis pipeline.

Usage:
    python run.py --file hr.csv --file vib.csv
    python run.py --file hr.csv
    python run.py --file hr.csv --out-dir results/

Sensor type is auto-detected from file headers — no need to specify it.

Outputs (written to --out-dir, default: plots/):
    gap_report_{sensor_type}.json   — one per sensor
    timeline_comparison.png
    sparklines_grid.png
    {sensor_id}_sparkline.png       — one per sensor

To add a new Empatica signal: add an entry with signal_col to config.py — routes are built automatically.
To add a non-Empatica sensor type: add entries to _SENSOR_ROUTES and _HEADER_SIGNATURES below.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from functools import partial

import matplotlib.pyplot as plt

from config import SENSOR_CONFIG
from gap_detector import check_sensor_live, detect_gaps
from loader import parse_apple_watch_csv, parse_empatica_biomarker_csv, parse_geoscope_csv
from visualizer import plot_sparkline, plot_sparklines_grid, plot_timeline_comparison

_HERE = os.path.dirname(os.path.abspath(__file__))

# Maps sensor_type → parser function and kwargs forwarded to detect_gaps.
_SENSOR_ROUTES = {
    "heartrate": {
        "parser": parse_apple_watch_csv,
        "gap_kwargs": {},
    },
    "vibration": {
        "parser": parse_geoscope_csv,
        "gap_kwargs": {"aggregated_interval_sec": 1},
    },
}

# Column substrings that uniquely identify each sensor's file format.
# Checked against the first (header) line of the CSV.
_HEADER_SIGNATURES = {
    "heartrate": {"Avg Heart Rate"},
    "vibration": {"timestamp_pacific", "reading"},
}

# Empatica biomarker routes — built from SENSOR_CONFIG entries that have signal_col.
# Adding a new Empatica signal only requires adding an entry to config.py.
for _stype, _cfg in SENSOR_CONFIG.items():
    if "signal_col" in _cfg:
        _SENSOR_ROUTES[_stype] = {
            "parser": partial(parse_empatica_biomarker_csv,
                              signal_col=_cfg["signal_col"],
                              sensor_id=_stype),
            "gap_kwargs": {},
        }
        _HEADER_SIGNATURES[_stype] = {_cfg["signal_col"]}


def detect_sensor_type(filepath):
    """Return the sensor_type for a file by inspecting its header, or None if unrecognised."""
    with open(filepath) as f:
        header = f.readline()
    for sensor_type, required_cols in _HEADER_SIGNATURES.items():
        if all(col in header for col in required_cols):
            return sensor_type
    return None


# ---------------------------------------------------------------------------
# Core pipeline — importable by Lambda
# ---------------------------------------------------------------------------

def run_pipeline(sensors, out_dir=None, window_hours=None):
    """
    sensors      : list of (sensor_type, filepath) tuples
    out_dir      : output directory for JSON reports and PNGs
    window_hours : analysis window size in hours, anchored to now.
                   When None, the window spans the data in the file.

    Returns a dict of gap reports keyed by sensor_id.
    All file I/O is contained here; callers can ignore output paths
    if they only want the returned reports (e.g. unit tests, Lambda).
    """
    now = datetime.now(timezone.utc)
    window_start = window_end = None
    if window_hours is not None:
        window_end = now
        window_start = now - timedelta(hours=window_hours)

    out_dir = out_dir or os.path.join(_HERE, "plots")
    os.makedirs(out_dir, exist_ok=True)

    dfs, reports, configs = [], [], []

    for sensor_type, filepath in sensors:
        if not os.path.exists(filepath):
            print(f"[{sensor_type}] file not found: {filepath}", file=sys.stderr)
            continue

        if sensor_type not in _SENSOR_ROUTES:
            known = ", ".join(_SENSOR_ROUTES)
            print(f"[{sensor_type}] unknown sensor type (known: {known})", file=sys.stderr)
            continue

        route = _SENSOR_ROUTES[sensor_type]
        cfg = SENSOR_CONFIG[sensor_type]

        print(f"[{sensor_type}] loading {os.path.basename(filepath)} ...", flush=True)
        df = route["parser"](filepath)
        report = detect_gaps(df, cfg, window_start=window_start, window_end=window_end, **route["gap_kwargs"])
        live = check_sensor_live(df, cfg, now=now)
        report["live"] = live["live"]
        report["lag_sec"] = live["lag_sec"]
        report["latest_timestamp"] = live["latest_timestamp"]
        _write_json(report, os.path.join(out_dir, f"gap_report_{sensor_type}.json"))
        _print_summary(report)
        dfs.append(df)
        reports.append(report)
        configs.append(cfg)

    if not reports:
        print("No sensor files loaded — nothing to do.", file=sys.stderr)
        return {}

    # ---- Plots -------------------------------------------------------------
    timeline_path = os.path.join(out_dir, "timeline_comparison.png")
    sparkline_path = os.path.join(out_dir, "sparklines_grid.png")

    print(f"\nWriting plots to {out_dir}/ ...", flush=True)
    plot_timeline_comparison(reports, output_path=timeline_path)
    print(f"  {os.path.basename(timeline_path)}")
    plot_sparklines_grid(dfs, reports, configs, output_path=sparkline_path)
    print(f"  {os.path.basename(sparkline_path)}")

    for df, report, cfg in zip(dfs, reports, configs):
        sensor_id = report["sensor_id"]
        path = os.path.join(out_dir, f"{sensor_id}_sparkline.png")
        fig, _ = plot_sparkline(df, report, cfg)
        fig.savefig(path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        print(f"  {os.path.basename(path)}")

    return {r["sensor_id"]: r for r in reports}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_json(report, path):
    serialisable = {
        **report,
        "window_start": _iso(report["window_start"]),
        "window_end": _iso(report["window_end"]),
        "latest_timestamp": _iso(report.get("latest_timestamp")),
        "gaps": [
            {**g, "start": _iso(g["start"]), "end": _iso(g["end"])}
            for g in report["gaps"]
        ],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(path, "w") as f:
        json.dump(serialisable, f, indent=2)
    print(f"  → {os.path.basename(path)}")


def _iso(ts):
    return ts.isoformat() if ts is not None else None


def _print_summary(report):
    dur = (report["window_end"] - report["window_start"]).total_seconds() / 60
    lag = report.get("lag_sec")
    live_str = ("LIVE" if report.get("live") else "OFFLINE") + (f"  (lag: {lag}s)" if lag is not None else "")
    print(
        f"  sensor_id          : {report['sensor_id']}\n"
        f"  window             : {report['window_start'].strftime('%H:%M:%S')} → "
        f"{report['window_end'].strftime('%H:%M:%S')} UTC  ({dur:.1f} min)\n"
        f"  connection uptime  : {report['connection_uptime_pct']:.1f}%\n"
        f"  data completeness  : {report['data_completeness_pct']:.1f}%\n"
        f"  gap count          : {report['gap_count']}\n"
        f"  longest gap        : {report['longest_gap_sec']:.0f}s\n"
        f"  live status        : {live_str}\n"
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args():
    p = argparse.ArgumentParser(description="Sensor gap analysis pipeline")
    p.add_argument(
        "--file", metavar="FILE",
        action="append", dest="files", default=[],
        help="Sensor data file (repeatable). Type is auto-detected from headers.",
    )
    p.add_argument(
        "--out-dir", default=os.path.join(_HERE, "plots"), metavar="DIR",
        help="Output directory for JSON reports and PNGs",
    )
    p.add_argument(
        "--window-hours", type=float, default=None, metavar="HOURS",
        help="Analysis window in hours, anchored to now (default: full data span in file)",
    )
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    if not args.files:
        print("No files specified. Use: --file path/to/sensor.csv", file=sys.stderr)
        sys.exit(1)
    sensors = []
    for filepath in args.files:
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}", file=sys.stderr)
            sys.exit(1)
        sensor_type = detect_sensor_type(filepath)
        if sensor_type is None:
            print(f"Could not detect sensor type for {os.path.basename(filepath)}", file=sys.stderr)
            print(f"Known types: {', '.join(_SENSOR_ROUTES)}", file=sys.stderr)
            sys.exit(1)
        print(f"Detected {os.path.basename(filepath)} → {sensor_type}")
        sensors.append((sensor_type, filepath))
    run_pipeline(sensors, out_dir=args.out_dir, window_hours=args.window_hours)
