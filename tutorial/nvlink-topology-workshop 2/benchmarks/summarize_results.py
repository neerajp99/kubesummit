#!/usr/bin/env python3
"""Turn NCCL/training measurements into a comparable placement table.

The first row is the declared baseline. Analytical rows are rejected by default
so teaching scenarios cannot accidentally be reported as production evidence.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path


def read_rows(path: Path) -> list[dict[str, str]]:
    """Load and validate the minimum evidence fields used by the comparison."""
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    if not rows:
        raise ValueError("results file has no rows")
    required = {"placement", "gpus", "step_time_ms", "tokens_per_second", "mfu", "source"}
    missing = required.difference(rows[0])
    if missing:
        raise ValueError(f"missing columns: {', '.join(sorted(missing))}")
    for index, row in enumerate(rows, 2):
        for key in ("gpus", "step_time_ms", "tokens_per_second", "mfu"):
            if row[key] == "":
                raise ValueError(f"row {index}: {key} is empty")
            if float(row[key]) <= 0:
                raise ValueError(f"row {index}: {key} must be positive")
    return rows


def summarize(rows: list[dict[str, str]]) -> list[dict[str, float | str]]:
    """Calculate efficiency, degradation, and GPU-hour cost versus baseline."""
    baseline = rows[0]
    baseline_tokens = float(baseline["tokens_per_second"])
    baseline_step = float(baseline["step_time_ms"])
    output = []
    for row in rows:
        tokens = float(row["tokens_per_second"])
        step = float(row["step_time_ms"])
        output.append({
            "placement": row["placement"],
            "relative_efficiency": 100.0 * tokens / baseline_tokens,
            "throughput_degradation": 100.0 * (1.0 - tokens / baseline_tokens),
            "gpu_hour_multiplier": step / baseline_step,
            "mfu": float(row["mfu"]),
            "source": row["source"],
        })
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv", type=Path)
    parser.add_argument("--allow-analytical", action="store_true")
    args = parser.parse_args()
    try:
        rows = read_rows(args.csv)
        if not args.allow_analytical and any(row["source"] != "measured" for row in rows):
            raise ValueError("non-measured data refused; pass --allow-analytical only for teaching examples")
        output = summarize(rows)
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print("PLACEMENT                  EFFICIENCY  DEGRADATION  GPU-HOUR×  MFU")
    for row in output:
        print(f"{row['placement']:<26} {row['relative_efficiency']:>8.1f}% {row['throughput_degradation']:>11.1f}% {row['gpu_hour_multiplier']:>9.2f} {row['mfu']:>5.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
