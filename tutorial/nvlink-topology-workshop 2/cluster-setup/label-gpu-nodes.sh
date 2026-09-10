#!/usr/bin/env bash
# PURPOSE: Mark the four simulated GPU workers as eligible for ResourceFlavor.
# CALLED BY: scripts/checkpoint.sh after Kueue installation.
# MUTATES: Adds workshop.example.com/gpu-node=true to the four workers only.
# WHY SEPARATE: block/leaf/rack describe physical location; gpu-node describes
# capacity-class eligibility. Keeping those dimensions separate prevents a
# location label from accidentally promising a particular accelerator type.
# SAFETY: require_lab_context refuses to run outside kind-topology-lab.
# SUCCESS: The final table shows true for all workers and blank for control-plane.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/lib.sh"
require_lab_context

worker_nodes | while read -r node; do
  info "Marking $node eligible for the h100-topology ResourceFlavor"
  kubectl label node "$node" workshop.example.com/gpu-node=true --overwrite
done
kubectl get nodes -L workshop.example.com/gpu-node
