#!/usr/bin/env bash
# PURPOSE: Assert the complete Checkpoint 1 postcondition.
# CALLED BY: checkpoint.sh and `make verify-lab1`.
# READS ONLY: Node readiness/count, block/leaf labels, status.allocatable, and
# absence of workshop Jobs/Pods that could still consume fake GPU capacity.
# EXPECTS: five total Nodes; workers 1/2 in leaf-a, workers 3/4 in leaf-b;
# every worker in block-1 with exactly one allocatable fake GPU.
# WHY ALLOCATABLE: kube-scheduler consumes status.allocatable; capacity alone
# can be visible before the resource is actually schedulable.
set -euo pipefail  # Stop on an error, an unset variable, or a failed pipeline command.

# Load cluster/resource names plus the ok, die, and context-safety helpers.
. "$(dirname "$0")/lib.sh"

# Read only from the expected workshop cluster; never verify an accidental context.
require_lab_context

# Record failures instead of stopping at the first mismatch, so one run reports
# every problem that the attendee needs to fix.
fail=0

# kubectl prints one row per Node; wc counts the rows and tr removes whitespace.
node_count=$(kubectl get nodes --no-headers | wc -l | tr -d ' ')
# The kind topology contains one control plane plus four workers.
[ "$node_count" = "5" ] && ok "5 nodes present" || { echo "FAIL expected 5 nodes, found $node_count"; fail=1; }

# Print the name of every Node whose STATUS column is not exactly Ready.
not_ready=$(kubectl get nodes --no-headers | awk '$2 != "Ready" {print $1}')
if [ -z "$not_ready" ]; then
  ok "all 5 nodes Ready"
else
  echo "FAIL nodes not Ready: $not_ready"
  fail=1
fi

check_node() {
  # Validate topology and schedulable capacity together. A node with only one
  # half of this contract would make later placement results misleading.
  # The caller supplies a Node name and the leaf that Node should belong to.
  node=$1 expected_leaf=$2

  # Read the published topology labels from Node metadata. The escaped dots
  # tell JSONPath that workshop.example.com is part of one label key.
  leaf=$(kubectl get node "$node" -o jsonpath='{.metadata.labels.workshop\.example\.com/leaf}' 2>/dev/null || true)
  block=$(kubectl get node "$node" -o jsonpath='{.metadata.labels.workshop\.example\.com/block}' 2>/dev/null || true)

  # Read the fake GPU value the scheduler can allocate. The resource key comes
  # from GPU_RESOURCE in lib.sh and contains a slash, so go-template is clearer.
  alloc=$(kubectl get node "$node" -o go-template="{{index .status.allocatable \"${GPU_RESOURCE}\"}}" 2>/dev/null || true)

  # This worker is valid only when its block, leaf, and schedulable GPU agree.
  if [ "$leaf" = "$expected_leaf" ] && [ "$block" = "block-1" ] && [ "$alloc" = "1" ]; then
    ok "$node -> block-1/$leaf, allocatable GPU=1"
  else
    echo "FAIL $node expected block-1/$expected_leaf GPU=1; got ${block:-unset}/${leaf:-unset} GPU=${alloc:-unset}"
    fail=1
  fi
}

# Verify the physical model used in Lab 1: two workers per simulated leaf.
check_node "${CLUSTER_NAME}-worker" leaf-a
check_node "${CLUSTER_NAME}-worker2" leaf-a
check_node "${CLUSTER_NAME}-worker3" leaf-b
check_node "${CLUSTER_NAME}-worker4" leaf-b

# `status.allocatable=1` is a capacity ceiling; it does not decrease when a Pod
# consumes the resource. Prove current availability separately by requiring no
# lab trainer or filler Pods at this clean checkpoint.
# Count trainer Pods by the common lab label; suppress kubectl's empty-result noise.
lab_pods=$(kubectl get pods -n "$TRAINING_NAMESPACE" -l workshop.example.com/lab --no-headers 2>/dev/null | wc -l | tr -d ' ')
# Count the standalone placement fillers through their dedicated role label.
filler_pods=$(kubectl get pods -n "$TRAINING_NAMESPACE" -l workshop.example.com/role=placement-filler --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [ "$lab_pods" = "0" ] && [ "$filler_pods" = "0" ]; then
  ok "zero workshop workload Pods; all four fake GPUs are free"
else
  echo "FAIL expected zero workshop workload Pods; found lab=$lab_pods filler=$filler_pods"
  fail=1
fi

# Convert any accumulated mismatch into a non-zero exit status for Make/Jupyter.
[ "$fail" -eq 0 ] || die "Lab 1 verification failed"
ok "CHECKPOINT 1 VERIFIED — deterministic four-GPU topology ready"
