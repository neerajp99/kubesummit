#!/usr/bin/env bash
# PURPOSE: Converge a participant laptop to one of three known workshop states.
# CALLED BY: `make checkpoint-1`, `make checkpoint-2`, or `make checkpoint-3`.
# INPUT: One positional phase number: 1, 2, or 3.
# MUTATES: Only the kind cluster/context named topology-lab; helper scripts guard
# Kubernetes mutations against an unexpected context.
# IDEMPOTENCY: Safe to rerun. Declarative objects are reapplied and old workshop
# workloads are deleted so recovery does not depend on the failed intermediate state.
# SUCCESS: Prints every completed CHECKPOINT banner and exits zero.
# PHASES:
#   1 = cluster + namespaces + topology labels + fake GPUs + clean workloads
#   2 = phase 1 + pinned Kueue + TAS objects + Active queue verification
#   3 = phase 2 + final workload reset, preserving all controller/config state
set -euo pipefail
. "$(dirname "$0")/lib.sh"

phase=${1:-}
case "$phase" in 1|2|3) ;; *) die "usage: $0 <1|2|3>" ;; esac

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  info "Creating missing cluster $CLUSTER_NAME"
  kind create cluster --config "$WORKSHOP_ROOT/cluster-setup/kind-config.yaml" --image "$KIND_NODE_IMAGE"
fi
# Phase 1 establishes infrastructure facts and scheduler-visible fake capacity.
# It is safe to repeat and deliberately removes workloads from an earlier run.
kubectl config use-context "$CLUSTER_CONTEXT" >/dev/null
"$WORKSHOP_ROOT/scripts/load-images.sh"
kubectl apply -f "$WORKSHOP_ROOT/cluster-setup/namespaces.yaml"
"$WORKSHOP_ROOT/cluster-setup/label-topology.sh"
"$WORKSHOP_ROOT/cluster-setup/advertise-fake-gpus.sh"
"$WORKSHOP_ROOT/scripts/reset-workloads.sh"
"$WORKSHOP_ROOT/scripts/verify-lab1.sh"
ok "CHECKPOINT 1 — fake GPU datacenter ready"

[ "$phase" = "1" ] && exit 0

# Phase 2 layers Kueue TAS on top of the verified fake datacenter. Applying the
# same declarative objects repeatedly converges rather than creating duplicates.
"$WORKSHOP_ROOT/scripts/install-kueue.sh"
"$WORKSHOP_ROOT/cluster-setup/label-gpu-nodes.sh"
kubectl apply -f "$WORKSHOP_ROOT/kueue-config/topology.yaml"
kubectl apply -f "$WORKSHOP_ROOT/kueue-config/resource-flavor.yaml"
kubectl apply -f "$WORKSHOP_ROOT/kueue-config/cluster-queue.yaml"
kubectl apply -f "$WORKSHOP_ROOT/kueue-config/local-queue.yaml"
"$WORKSHOP_ROOT/scripts/verify-lab2.sh"
ok "CHECKPOINT 2 — Kueue + TAS ready"

[ "$phase" = "2" ] && exit 0

# Phase 3 preserves configuration but clears every exercise Workload and Pod.
"$WORKSHOP_ROOT/scripts/reset-workloads.sh"
ok "CHECKPOINT 3 — clean TAS-ready state restored"
