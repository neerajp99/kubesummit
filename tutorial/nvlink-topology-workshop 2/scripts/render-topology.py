#!/usr/bin/env python3
"""Validate topology inventory and render scheduler-facing Node-label data.

This module models the boundary between infrastructure inventory and
Kubernetes. It reads the normalized JSON inventory, validates the semantic
rules required by the workshop, and renders one of three read-only views:

* ``table`` for a human-readable inventory summary;
* ``commands`` for explicit ``kubectl label node`` examples; or
* ``tsv`` for the machine interface consumed by ``label-topology.sh``.

The module itself never contacts Kubernetes and never mutates a Node. The shell
publisher consumes its validated output and performs the guarded API writes.
Sorting by Node name makes the rendered output deterministic and reviewable.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Literal

# Resolve defaults relative to this source file, not the caller's directory.
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INVENTORY = ROOT / "topology-pipeline" / "sample-inventory.json"

# Kubernetes label values in this workshop use a deliberately conservative
# lowercase subset. Empty values and leading/trailing hyphens are rejected.
LABEL_VALUE = re.compile(r"^[a-z0-9]([-a-z0-9]*[a-z0-9])?$")

# Every record must identify where its important facts originated. Provenance
# is part of the infrastructure-to-platform contract, not decorative metadata.
REQUIRED_SOURCE_KEYS = ("rack", "leaf", "gpuSku", "numa")

# The JSON document is validated at runtime before being treated as Inventory.
# Any is appropriate at the ingestion boundary because json.loads accepts
# arbitrary JSON types; validate() narrows the structure before render().
Inventory = dict[str, Any]
OutputFormat = Literal["table", "commands", "tsv"]


def load_and_validate(path: Path) -> Inventory:
    """Load one JSON inventory and enforce its semantic invariants.

    Args:
        path: Filesystem path to the normalized topology inventory.

    Returns:
        The parsed inventory after :func:`validate` accepts it.

    Raises:
        OSError: The file cannot be opened or read.
        json.JSONDecodeError: The file is not valid JSON.
        ValueError: The top-level value or an inventory record violates the
            workshop contract.
    """
    data: Any = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("inventory must be a JSON object")
    validate(data)
    return data


def validate(data: Inventory) -> None:
    """Reject incomplete, duplicate, or non-normalized topology records.

    Validation occurs before any label command is rendered. The checks protect
    the publisher from ambiguous Node identity, malformed label values, and
    topology facts that lack ownership/provenance.

    Args:
        data: Parsed top-level inventory object.

    Raises:
        ValueError: The schema version, node collection, required fields,
            topology values, uniqueness, or provenance is invalid.
    """
    # Schema versions make changes to this cross-team data contract explicit.
    if data.get("schemaVersion") != "v1":
        raise ValueError("schemaVersion must be 'v1'")

    nodes = data.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("nodes must be a non-empty array")

    # Node names are the join key used by `kubectl label node`; duplicates
    # would make two inventory records compete to label the same API object.
    names: set[str] = set()
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            raise ValueError(f"nodes[{index}] must be an object")

        required = ("name", "block", "leaf", "rack", "nic", "gpuSku", "sources")
        missing = [key for key in required if key not in node]
        if missing:
            raise ValueError(f"nodes[{index}] missing: {', '.join(missing)}")

        if not isinstance(node["name"], str) or not node["name"]:
            raise ValueError(f"nodes[{index}].name must be a non-empty string")
        if node["name"] in names:
            raise ValueError(f"duplicate node name: {node['name']}")
        names.add(node["name"])

        # These values become Kubernetes metadata labels, so reject values that
        # would be invalid or inconsistent before reaching `kubectl label`.
        for key in ("block", "leaf", "rack"):
            if not isinstance(node[key], str) or not LABEL_VALUE.fullmatch(node[key]):
                raise ValueError(f"nodes[{index}].{key} is not a valid normalized label value")

        sources = node["sources"]
        if not isinstance(sources, dict):
            raise ValueError(f"nodes[{index}].sources must be an object")

        missing_sources = [key for key in REQUIRED_SOURCE_KEYS if not node["sources"].get(key)]
        if missing_sources:
            raise ValueError(f"nodes[{index}].sources missing: {', '.join(missing_sources)}")


def render(data: Inventory, output_format: OutputFormat) -> str:
    """Render validated inventory in a deterministic requested format.

    Args:
        data: Inventory previously accepted by :func:`validate`.
        output_format: ``table`` for people, ``commands`` for explanatory
            kubectl examples, or ``tsv`` for ``label-topology.sh``.

    Returns:
        Newline-delimited text sorted by Node name.

    Raises:
        ValueError: ``output_format`` is not one of the supported formats.
    """
    # Stable ordering prevents input reordering from producing noisy diffs.
    nodes = sorted(data["nodes"], key=lambda item: item["name"])

    if output_format == "tsv":
        # TSV is intentionally headerless because the shell loop consumes every
        # line as: node, block, leaf, rack.
        return "\n".join(f"{n['name']}\t{n['block']}\t{n['leaf']}\t{n['rack']}" for n in nodes)

    if output_format == "commands":
        # This view makes the eventual Kubernetes mutations easy to inspect;
        # rendering the text does not execute the commands.
        return "\n".join(
            "kubectl label node "
            f"{n['name']} workshop.example.com/block={n['block']} "
            f"workshop.example.com/leaf={n['leaf']} workshop.example.com/rack={n['rack']} --overwrite"
            for n in nodes
        )

    if output_format == "table":
        # Include leaf provenance so a reviewer can see which upstream system
        # supplied the fabric-domain relationship.
        rows = ["NODE\tBLOCK\tLEAF\tRACK\tLEAF SOURCE"]
        rows.extend(f"{n['name']}\t{n['block']}\t{n['leaf']}\t{n['rack']}\t{n['sources']['leaf']}" for n in nodes)
        return "\n".join(rows)

    raise ValueError(f"unsupported format: {output_format}")


def main() -> int:
    """Parse CLI arguments, validate the inventory, and print one result.

    Returns:
        Process exit code: ``0`` on success and ``1`` for a readable inventory
        or validation error.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--inventory",
        type=Path,
        default=DEFAULT_INVENTORY,
        help="path to the normalized topology inventory JSON",
    )
    parser.add_argument(
        "--format",
        choices=("table", "commands", "tsv"),
        default="table",
        help="output format used when --check is not set",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate only; do not render inventory rows",
    )
    args = parser.parse_args()

    try:
        data = load_and_validate(args.inventory)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if args.check:
        print(f"OK: {len(data['nodes'])} nodes satisfy topology inventory v1")
    else:
        print(render(data, args.format))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
