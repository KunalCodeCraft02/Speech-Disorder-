#!/usr/bin/env python3
"""Scores a session's classification decisions against a clinician/tester-
labeled ground truth, so Z_TACHYLALIA, Z_BRADYLALIA and the composite_z
weights (Part B) get tuned against real accuracy numbers instead of
guesswork (Part G.16).

Inputs
------
--session-log   Path to a JSONL file of per-window records, one per line,
                as written by app/pipeline/session_pipeline.py when
                DEBUG_LOG_FRAMES=true (see app/core/config.py). Each line
                looks like:
                  {"elapsedSec": 12.5, "articulationRateSPS": 6.1,
                   "zRate": 2.3, "zPause": 1.1, "zSyll": 0.4,
                   "compositeZ": 1.8, "rawLabel": "tachylalia",
                   "confirmedLabel": "normal", "confidence": 0.62,
                   "sampleSufficient": true, ...}

--ground-truth  Path to a CSV with columns `start_sec,end_sec,label`, where
                a clinician/tester marked time ranges of a *reviewed
                recording of the same session* as actually
                tachylalic/bradylalic/normal while listening back to it.
                Example:
                  start_sec,end_sec,label
                  0,15,normal
                  15,42,tachylalia
                  42,60,normal

Output
------
Precision/recall/F1 per class plus a confusion matrix, printed to stdout.
Scoring uses each frame's *confirmed* label (`confirmedLabel`) against
whichever ground-truth interval contains that frame's `elapsedSec` — frames
outside every labeled interval are skipped (the tester wasn't reviewing
that stretch, so there's no ground truth to compare against).

Usage
-----
    python scripts/evaluate_accuracy.py \\
        --session-log logs/dsp-frames/<sessionId>.jsonl \\
        --ground-truth truth.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

CLASSES = ("normal", "tachylalia", "bradylalia", "uncalibrated")


def load_session_log(path: Path) -> list[dict]:
    records = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no}: not valid JSON ({exc})") from exc
    records.sort(key=lambda r: r.get("elapsedSec", 0.0))
    return records


def load_ground_truth(path: Path) -> list[tuple[float, float, str]]:
    intervals: list[tuple[float, float, str]] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        required = {"start_sec", "end_sec", "label"}
        if reader.fieldnames is None or not required.issubset(set(reader.fieldnames)):
            raise ValueError(f"{path}: expected columns {sorted(required)}, got {reader.fieldnames}")
        for row_no, row in enumerate(reader, start=2):
            try:
                start = float(row["start_sec"])
                end = float(row["end_sec"])
            except ValueError as exc:
                raise ValueError(f"{path}:{row_no}: start_sec/end_sec must be numeric") from exc
            label = row["label"].strip().lower()
            if label not in CLASSES:
                raise ValueError(f"{path}:{row_no}: label {label!r} must be one of {CLASSES}")
            if end <= start:
                raise ValueError(f"{path}:{row_no}: end_sec must be greater than start_sec")
            intervals.append((start, end, label))
    intervals.sort()
    return intervals


def label_at(intervals: list[tuple[float, float, str]], t: float) -> str | None:
    # Linear scan is fine here -- ground-truth files are hand-labeled and
    # therefore small (dozens of intervals, not thousands).
    for start, end, label in intervals:
        if start <= t < end:
            return label
    return None


def build_confusion_matrix(pairs: list[tuple[str, str]]) -> dict[str, dict[str, int]]:
    matrix: dict[str, dict[str, int]] = {t: {p: 0 for p in CLASSES} for t in CLASSES}
    for true_label, pred_label in pairs:
        matrix[true_label][pred_label] += 1
    return matrix


def precision_recall_f1(matrix: dict[str, dict[str, int]], label: str) -> tuple[float, float, float, int]:
    tp = matrix[label][label]
    fp = sum(matrix[t][label] for t in CLASSES if t != label)
    fn = sum(matrix[label][p] for p in CLASSES if p != label)
    support = sum(matrix[label].values())

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    return precision, recall, f1, support


def print_report(matrix: dict[str, dict[str, int]], total_scored: int, total_skipped: int) -> None:
    used_classes = [c for c in CLASSES if sum(matrix[c].values()) > 0 or any(matrix[t][c] for t in CLASSES)]
    if not used_classes:
        print("No frames overlapped any ground-truth interval -- nothing to score.")
        return

    col_width = max(12, max(len(c) for c in used_classes) + 2)

    print(f"Scored {total_scored} frame(s); skipped {total_skipped} frame(s) with no ground-truth coverage.\n")

    header = "true \\ pred".ljust(col_width) + "".join(c.rjust(col_width) for c in used_classes)
    print("Confusion matrix (rows = ground truth, columns = predicted):")
    print(header)
    for true_label in used_classes:
        row = true_label.ljust(col_width) + "".join(str(matrix[true_label][p]).rjust(col_width) for p in used_classes)
        print(row)
    print()

    print(f"{'class'.ljust(14)}{'precision'.rjust(11)}{'recall'.rjust(11)}{'f1'.rjust(11)}{'support'.rjust(11)}")
    for label in used_classes:
        precision, recall, f1, support = precision_recall_f1(matrix, label)
        if support == 0 and sum(matrix[t][label] for t in CLASSES) == 0:
            continue
        print(f"{label.ljust(14)}{precision:11.3f}{recall:11.3f}{f1:11.3f}{support:11d}")

    total = sum(sum(row.values()) for row in matrix.values())
    correct = sum(matrix[c][c] for c in CLASSES)
    accuracy = correct / total if total > 0 else 0.0
    print(f"\nOverall accuracy: {accuracy:.3f} ({correct}/{total})")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--session-log", required=True, type=Path, help="JSONL frame log (DEBUG_LOG_FRAMES output)")
    parser.add_argument("--ground-truth", required=True, type=Path, help="CSV: start_sec,end_sec,label")
    args = parser.parse_args(argv)

    if not args.session_log.exists():
        print(f"error: session log not found: {args.session_log}", file=sys.stderr)
        return 2
    if not args.ground_truth.exists():
        print(f"error: ground-truth CSV not found: {args.ground_truth}", file=sys.stderr)
        return 2

    try:
        records = load_session_log(args.session_log)
        intervals = load_ground_truth(args.ground_truth)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if not records:
        print("error: session log is empty", file=sys.stderr)
        return 2
    if not intervals:
        print("error: ground-truth CSV has no rows", file=sys.stderr)
        return 2

    pairs: list[tuple[str, str]] = []
    skipped = 0
    for record in records:
        t = record.get("elapsedSec")
        pred = record.get("confirmedLabel")
        if t is None or pred is None:
            skipped += 1
            continue
        true_label = label_at(intervals, t)
        if true_label is None:
            skipped += 1
            continue
        if pred not in CLASSES:
            skipped += 1
            continue
        pairs.append((true_label, pred))

    matrix = build_confusion_matrix(pairs)
    print_report(matrix, total_scored=len(pairs), total_skipped=skipped)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
