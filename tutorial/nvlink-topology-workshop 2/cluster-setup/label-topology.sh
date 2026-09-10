#!/usr/bin/env bash
# PURPOSE: Publish the validated inventory as block/leaf/rack Node labels.
# CALLED BY: scripts/checkpoint.sh during every checkpoint.
# READS: topology-pipeline/sample-inventory.json through render-topology.py.
# MUTATES: Metadata on the four deterministic kind worker Nodes only.
# SAFETY: require_lab_context refuses to run outside kind-topology-lab.
# SUCCESS: Prints the final Node table with all three label columns.
set -euo pipefail  # Stop on an error, an unset variable, or a failed pipeline.

# Resolve the workshop root from this script's location, so the repository can
# be cloned into any filesystem directory.
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# Load the expected cluster context plus shared logging and safety helpers.
. "$ROOT/scripts/lib.sh"

# Refuse to label Nodes unless kubectl points at kind-topology-lab.
require_lab_context

# This versioned file is the source of each node -> block/leaf/rack mapping.
inventory="$ROOT/topology-pipeline/sample-inventory.json"

# Never publish before validation. This checks schema version, uniqueness,
# normalized label values, required fields, and provenance.
python3 "$ROOT/scripts/render-topology.py" --inventory "$inventory" --check

# TSV is an internal machine interface: node, block, leaf, rack. Each record is
# converted into idempotent `kubectl label --overwrite` operations.
python3 "$ROOT/scripts/render-topology.py" --inventory "$inventory" --format tsv |
while IFS=$'\t' read -r node block leaf rack; do
  # One row becomes four shell variables, for example:
  # node=topology-lab-worker block=block-1 leaf=leaf-a rack=rack-a1.
  info "Labeling $node -> block=$block leaf=$leaf rack=$rack"

  # Attach topology facts to the existing Node object's metadata. These values
  # are labels, not separate Block, Leaf, or Rack Kubernetes objects.
  kubectl label node "$node" \
    "workshop.example.com/block=$block" \
    "workshop.example.com/leaf=$leaf" \
    "workshop.example.com/rack=$rack" \
    --overwrite  # Reconcile changed inventory values when the script is rerun.
done

# Display the resulting topology columns as immediate, human-readable evidence.
kubectl get nodes -L workshop.example.com/block -L workshop.example.com/leaf -L workshop.example.com/rack

# Basically it means that the following commands are equivalent to the above loop, but the loop is more maintainable and less error-prone. The commented-out commands are left here for reference.
# kubectl label node topology-lab-worker \
#   workshop.example.com/block=block-1 \
#   workshop.example.com/leaf=leaf-a \
#   workshop.example.com/rack=rack-a1 \
#   --overwrite

# kubectl label node topology-lab-worker2 \
#   workshop.example.com/block=block-1 \
#   workshop.example.com/leaf=leaf-a \
#   workshop.example.com/rack=rack-a1 \
#   --overwrite

# kubectl label node topology-lab-worker3 \
#   workshop.example.com/block=block-1 \
#   workshop.example.com/leaf=leaf-b \
#   workshop.example.com/rack=rack-b1 \
#   --overwrite

# kubectl label node topology-lab-worker4 \
#   workshop.example.com/block=block-1 \
#   workshop.example.com/leaf=leaf-b \
#   workshop.example.com/rack=rack-b1 \
#   --overwrite
