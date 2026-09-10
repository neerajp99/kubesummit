"""Offline unit tests for inventory integrity and benchmark mathematics.

These tests intentionally avoid Kubernetes and Docker so `make test` remains a
fast pre-commit and pre-conference gate. Live behavior belongs in smoke-test.sh.
"""

import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_module(name: str, path: Path):
    """Load command-line scripts as modules without duplicating their logic."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


topology = load_module("render_topology", ROOT / "scripts" / "render-topology.py")
benchmarks = load_module("summarize_results", ROOT / "benchmarks" / "summarize_results.py")


class TopologyContractTest(unittest.TestCase):
    """Protect the normalized inventory consumed by the label publisher."""
    def setUp(self):
        self.path = ROOT / "topology-pipeline" / "sample-inventory.json"
        self.data = json.loads(self.path.read_text())

    def test_sample_is_valid_and_deterministic(self):
        data = topology.load_and_validate(self.path)
        lines = topology.render(data, "tsv").splitlines()
        self.assertEqual(len(lines), 4)
        self.assertEqual(lines[0].split("\t")[1:3], ["block-1", "leaf-a"])

    def test_duplicate_node_is_rejected(self):
        duplicate = copy.deepcopy(self.data)
        duplicate["nodes"].append(copy.deepcopy(duplicate["nodes"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate node name"):
            topology.validate(duplicate)


class BenchmarkTest(unittest.TestCase):
    """Protect the formulas used to compare measured placement scenarios."""
    def test_efficiency_and_cost_multiplier(self):
        rows = benchmarks.read_rows(ROOT / "benchmarks" / "scenario-model.csv")
        result = benchmarks.summarize(rows)
        self.assertAlmostEqual(result[2]["relative_efficiency"], 58.0)
        self.assertAlmostEqual(result[2]["gpu_hour_multiplier"], 1.72)


if __name__ == "__main__":
    unittest.main()
