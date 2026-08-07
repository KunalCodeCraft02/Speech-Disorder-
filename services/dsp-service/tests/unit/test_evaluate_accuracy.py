import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "evaluate_accuracy.py"
_spec = importlib.util.spec_from_file_location("evaluate_accuracy", SCRIPT_PATH)
evaluate_accuracy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(evaluate_accuracy)


def _write_session_log(path: Path, records: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")


def _write_ground_truth(path: Path, rows: list[tuple[float, float, str]]) -> None:
    with path.open("w", encoding="utf-8") as f:
        f.write("start_sec,end_sec,label\n")
        for start, end, label in rows:
            f.write(f"{start},{end},{label}\n")


class TestLoaders:
    def test_load_session_log_sorts_by_elapsed(self, tmp_path):
        path = tmp_path / "log.jsonl"
        _write_session_log(path, [{"elapsedSec": 5.0, "confirmedLabel": "normal"}, {"elapsedSec": 1.0, "confirmedLabel": "normal"}])
        records = evaluate_accuracy.load_session_log(path)
        assert [r["elapsedSec"] for r in records] == [1.0, 5.0]

    def test_load_session_log_rejects_malformed_json(self, tmp_path):
        path = tmp_path / "log.jsonl"
        path.write_text("not json\n", encoding="utf-8")
        with pytest.raises(ValueError):
            evaluate_accuracy.load_session_log(path)

    def test_load_ground_truth_parses_rows(self, tmp_path):
        path = tmp_path / "truth.csv"
        _write_ground_truth(path, [(0, 10, "normal"), (10, 20, "tachylalia")])
        intervals = evaluate_accuracy.load_ground_truth(path)
        assert intervals == [(0.0, 10.0, "normal"), (10.0, 20.0, "tachylalia")]

    def test_load_ground_truth_rejects_unknown_label(self, tmp_path):
        path = tmp_path / "truth.csv"
        _write_ground_truth(path, [(0, 10, "not-a-real-label")])
        with pytest.raises(ValueError):
            evaluate_accuracy.load_ground_truth(path)

    def test_load_ground_truth_rejects_missing_columns(self, tmp_path):
        path = tmp_path / "truth.csv"
        path.write_text("foo,bar\n1,2\n", encoding="utf-8")
        with pytest.raises(ValueError):
            evaluate_accuracy.load_ground_truth(path)


class TestLabelAt:
    def test_finds_containing_interval(self):
        intervals = [(0.0, 10.0, "normal"), (10.0, 20.0, "tachylalia")]
        assert evaluate_accuracy.label_at(intervals, 5.0) == "normal"
        assert evaluate_accuracy.label_at(intervals, 15.0) == "tachylalia"

    def test_none_outside_any_interval(self):
        intervals = [(0.0, 10.0, "normal")]
        assert evaluate_accuracy.label_at(intervals, 50.0) is None


class TestConfusionMatrixAndMetrics:
    def test_perfect_predictions_yield_full_precision_recall(self):
        pairs = [("normal", "normal"), ("normal", "normal"), ("tachylalia", "tachylalia")]
        matrix = evaluate_accuracy.build_confusion_matrix(pairs)
        precision, recall, f1, support = evaluate_accuracy.precision_recall_f1(matrix, "normal")
        assert precision == 1.0
        assert recall == 1.0
        assert f1 == 1.0
        assert support == 2

    def test_all_wrong_yields_zero_precision_and_recall(self):
        pairs = [("normal", "tachylalia"), ("normal", "tachylalia")]
        matrix = evaluate_accuracy.build_confusion_matrix(pairs)
        precision, recall, f1, support = evaluate_accuracy.precision_recall_f1(matrix, "normal")
        assert precision == 0.0
        assert recall == 0.0
        assert f1 == 0.0


class TestMainEndToEnd:
    def test_runs_without_errors_and_returns_zero(self, tmp_path, capsys):
        log_path = tmp_path / "session.jsonl"
        truth_path = tmp_path / "truth.csv"

        _write_session_log(
            log_path,
            [
                {"elapsedSec": 1.0, "confirmedLabel": "normal"},
                {"elapsedSec": 5.0, "confirmedLabel": "normal"},
                {"elapsedSec": 12.0, "confirmedLabel": "tachylalia"},
                {"elapsedSec": 16.0, "confirmedLabel": "normal"},  # a miss
                {"elapsedSec": 100.0, "confirmedLabel": "normal"},  # outside any labeled interval -- skipped
            ],
        )
        _write_ground_truth(truth_path, [(0.0, 10.0, "normal"), (10.0, 20.0, "tachylalia")])

        rc = evaluate_accuracy.main(["--session-log", str(log_path), "--ground-truth", str(truth_path)])
        assert rc == 0

        out = capsys.readouterr().out
        assert "Confusion matrix" in out
        assert "Overall accuracy" in out
        assert "Scored 4 frame(s); skipped 1 frame(s)" in out

    def test_missing_files_return_nonzero(self, tmp_path):
        rc = evaluate_accuracy.main(
            ["--session-log", str(tmp_path / "missing.jsonl"), "--ground-truth", str(tmp_path / "missing.csv")]
        )
        assert rc != 0
