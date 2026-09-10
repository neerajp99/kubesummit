#!/usr/bin/env bash
# PURPOSE: Give each kind worker one scheduler-visible *fake* GPU.
# CALLED BY: scripts/checkpoint.sh after topology labels are published.
# MUTATES: Node/status only in kind-topology-lab.
# PRODUCTION DIFFERENCE: Real GPUs are advertised by a device plugin or DRA
# driver. This script provides accounting semantics but no device, CUDA, NVLink,
# health monitoring, or isolation and must never be copied to production.
# SUCCESS: Every worker reaches capacity=1 and allocatable=1.
set -euo pipefail  # Stop on an error, an unset variable, or a failed pipeline.

# Resolve the workshop root from this script's location, so the repository can
# be cloned into any filesystem directory.
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# Load shared constants (GPU_RESOURCE, cluster name) and helper functions.
. "$ROOT/scripts/lib.sh"

# Refuse to patch Nodes unless kubectl points at kind-topology-lab.
require_lab_context

# JSON Pointer escapes `/` in the resource name as `~1`.
# This adds capacity=1 for workshop.example.com/gpu to Node/status. Kubernetes
# quantities are strings, which is why the value is written as "1".
patch='[{"op":"add","path":"/status/capacity/workshop.example.com~1gpu","value":"1"}]'

# worker_nodes (from lib.sh) emits the four deterministic kind worker names.
worker_nodes | while read -r node; do
  info "Advertising ${GPU_RESOURCE}=1 on $node"

  # Patch the status subresource rather than Node.spec. `add` is repeatable here:
  # when the capacity key already exists, JSON Patch replaces it with "1".
  kubectl patch node "$node" --subresource=status --type=json --patch "$patch" >/dev/null
done

# The scheduler reads allocatable, which kubelet publishes asynchronously.
worker_nodes | while read -r node; do
  # Poll for at most 90 seconds until status.allocatable reports the fake GPU.
  wait_for_gpu_allocatable "$node" 90

  # Reaching this line proves both the patch and kubelet propagation succeeded.
  ok "$node capacity=1 allocatable=1"
done
