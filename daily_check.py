"""
Daily sensor health check for Empatica data.

Usage:
    python daily_check.py --date 2026-04-17 --base-path 1/Empatica_raw_data/participant_data
    python daily_check.py --date 2026-04-17 --base-path 1/Empatica_raw_data/participant_data --out-dir reports/

Outputs a JSON report per participant to --out-dir (or prints to stdout if omitted).

Report structure:
    {
        "date": "2026-04-17",
        "participant_folder": "0-3YKC51P2JM",
        "signals": {
            "empatica_pulse_rate": {
                "file_found": bool,
                "data_completeness_pct": float,   # valid rows / expected rows for the 24h window
                "gap_count": int,                  # timestamp gaps exceeding threshold
                "longest_gap_sec": float,
                "live": bool,                      # data received within threshold of now
                "lag_sec": float,                  # seconds since last valid data point
            },
            ...
        }
    }
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from functools import partial

import pandas as pd

from config import SENSOR_CONFIG
from gap_detector import check_file_presence, check_sensor_live, detect_gaps
from loader import parse_empatica_biomarker_csv

# Parser per sensor type, bound to the right signal_col from config.
_ROUTES = {
    stype: partial(parse_empatica_biomarker_csv, signal_col=cfg["signal_col"], sensor_id=stype)
    for stype, cfg in SENSOR_CONFIG.items()
    if "signal_col" in cfg
}


def _find_biomarker_file(biomarker_dir, date, source_file):
    """Return the path of the biomarker CSV for this signal, or None if absent."""
    suffix = f"_{date}_{source_file}.csv"
    for fname in os.listdir(biomarker_dir):
        if fname.endswith(suffix):
            return os.path.join(biomarker_dir, fname)
    return None


def run_daily_check(date, base_path, now=None, window_hours=24, out_dir=None):
    """
    date         : str "YYYY-MM-DD"
    base_path    : str path to the participant_data directory
    now          : timezone-aware datetime for live check (defaults to current UTC)
    window_hours : analysis window in hours from midnight on the given date (default: 24)
    out_dir      : if given, writes JSON reports and PNGs here

    Returns a list of per-participant report dicts.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    win_start = pd.Timestamp(f"{date}T00:00:00Z")
    win_end   = win_start + pd.Timedelta(hours=window_hours)

    presence = check_file_presence(date, base_path)
    reports = []

    if not presence["date_folder_exists"]:
        return [{"date": date, "participant_folder": None,
                 "error": "date folder missing", "signals": {}}]

    for participant_folder, pinfo in presence["participants"].items():
        biomarker_dir = os.path.join(
            base_path, date, participant_folder,
            "digital_biomarkers", "aggregated_per_minute"
        )

        signals = {}
        vis_dfs, vis_reports, vis_configs = [], [], []
        for stype, parser in _ROUTES.items():
            cfg = SENSOR_CONFIG[stype]
            source_file = cfg["source_file"]

            filepath = _find_biomarker_file(biomarker_dir, date, source_file)
            if filepath is None:
                signals[stype] = {"file_found": False}
                continue

            df = parser(filepath)
            report = detect_gaps(df, cfg, window_start=win_start, window_end=win_end)
            live   = check_sensor_live(df, cfg, now=now)
            vis_dfs.append(df)
            vis_reports.append(report)
            vis_configs.append(cfg)

            entry = {
                "file_found": True,
                "data_completeness_pct": report["data_completeness_pct"],
                "gap_count": report["gap_count"],
                "longest_gap_sec": report["longest_gap_sec"],
                "live": live["live"],
                "lag_sec": live["lag_sec"],
            }
            if "not_wearing_pct" in report:
                entry["not_wearing_pct"] = report["not_wearing_pct"]
            signals[stype] = entry

        if out_dir and vis_reports:
            _write_plots(vis_reports, vis_dfs, vis_configs, date, participant_folder, out_dir)

        reports.append({
            "date": date,
            "participant_folder": participant_folder,
            "signals": signals,
        })

    return reports


def _write_plots(reports, dfs, configs, date, participant_folder, out_dir):
    try:
        from visualizer import plot_sparklines_grid, plot_timeline_comparison
    except ImportError as e:
        print(
            f"Warning: skipping PNG plots (matplotlib/visualizer unavailable): {e}",
            file=sys.stderr,
        )
        return

    os.makedirs(out_dir, exist_ok=True)
    stem = f"daily_{date}_{participant_folder}"

    timeline_path = os.path.join(out_dir, f"{stem}_timeline.png")
    plot_timeline_comparison(reports, output_path=timeline_path)
    print(f"  → {timeline_path}")

    sparklines_path = os.path.join(out_dir, f"{stem}_sparklines.png")
    plot_sparklines_grid(dfs, reports, configs, output_path=sparklines_path)
    print(f"  → {sparklines_path}")


def _write_report(report, out_dir):
    date = report["date"]
    participant = report["participant_folder"] or "unknown"
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"daily_{date}_{participant}.json")
    with open(path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"  → {path}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Daily Empatica sensor health check")
    p.add_argument("--date", required=True, help="Date to check (YYYY-MM-DD)")
    p.add_argument("--base-path", required=True, help="Path to participant_data directory")
    p.add_argument("--out-dir", default=None, help="Directory to write JSON reports (default: print to stdout)")
    p.add_argument("--window-hours", type=float, default=24, metavar="HOURS",
                   help="Analysis window in hours from midnight on the given date (default: 24)")
    args = p.parse_args()

    reports = run_daily_check(args.date, args.base_path, window_hours=args.window_hours, out_dir=args.out_dir)

    for report in reports:
        if args.out_dir:
            _write_report(report, args.out_dir)
        else:
            print(json.dumps(report, indent=2))
