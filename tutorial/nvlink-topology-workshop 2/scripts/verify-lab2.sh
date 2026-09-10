#!/usr/bin/env bash
# PURPOSE: Assert the Kueue/TAS control-plane contract before placement tests.
# CALLED BY: checkpoint.sh and `make verify-lab2`.
# READS ONLY: controller availability, Topology levels, ResourceFlavor selector
# and reference, ClusterQueue condition, and LocalQueue reference.
# EXPECTS: controller available; block->leaf->hostname hierarchy; four eligible
# workers through h100-topology; gpu-training Active; gpu-queue linked to it.
# WHY: Object existence is insufficient—broken references can leave a queue
# present but inactive.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_lab_context
fail=0

available=$(kubectl get deployment/kueue-controller-manager -n kueue-system -o jsonpath='{.status.availableReplicas}' 2>/dev/null || true)
[ "${available:-0}" -ge 1 ] && ok "Kueue controller available" || { echo "FAIL Kueue controller unavailable"; fail=1; }

levels=$(kubectl get topology gpu-fabric -o jsonpath='{.spec.levels[*].nodeLabel}' 2>/dev/null || true)
[ "$levels" = "workshop.example.com/block workshop.example.com/leaf kubernetes.io/hostname" ] && ok "Topology levels: $levels" || { echo "FAIL unexpected/missing Topology levels: ${levels:-unset}"; fail=1; }

topology_name=$(kubectl get resourceflavor h100-topology -o jsonpath='{.spec.topologyName}' 2>/dev/null || true)
selector=$(kubectl get resourceflavor h100-topology -o jsonpath='{.spec.nodeLabels.workshop\.example\.com/gpu-node}' 2>/dev/null || true)
[ "$topology_name" = "gpu-fabric" ] && [ "$selector" = "true" ] && ok "ResourceFlavor selects GPU nodes and references gpu-fabric" || { echo "FAIL ResourceFlavor contract mismatch"; fail=1; }

active=$(kubectl get clusterqueue gpu-training -o jsonpath='{.status.conditions[?(@.type=="Active")].status}' 2>/dev/null || true)
[ "$active" = "True" ] && ok "ClusterQueue gpu-training Active=True" || { echo "FAIL ClusterQueue Active=${active:-unset}"; fail=1; }

cluster_queue=$(kubectl get localqueue gpu-queue -n "$TRAINING_NAMESPACE" -o jsonpath='{.spec.clusterQueue}' 2>/dev/null || true)
[ "$cluster_queue" = "gpu-training" ] && ok "training/gpu-queue -> gpu-training" || { echo "FAIL LocalQueue contract mismatch"; fail=1; }

[ "$fail" -eq 0 ] || die "Lab 2 verification failed"
ok "CHECKPOINT 2 VERIFIED — Kueue topology-aware admission ready"
