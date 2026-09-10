#!/usr/bin/env bash
# PURPOSE: Return workload demand to zero without deleting infrastructure or Kueue.
# CALLED BY: Every lab target and Checkpoints 1/3.
# SELECTORS: Deletes only Jobs labeled workshop.example.com/lab and Pods labeled
# workshop.example.com/role=placement-filler in namespace training.
# PRESERVES: Cluster, namespaces, Node labels/capacity, Kueue controller/config,
# cached manifests, and Docker images.
# WHY WAIT: `agnhost pause` never completes and Kubernetes deletion is
# asynchronous; the next experiment must not race unreleased fake GPUs.
# SAFETY: require_lab_context refuses to mutate any context except kind-topology-lab.
set -euo pipefail  # Stop on an error, an unset variable, or a failed pipeline command.

# Load shared constants (for example, TRAINING_NAMESPACE) and helper functions.
. "$(dirname "$0")/lib.sh"

# Refuse all deletion if kubectl is not using the workshop's kind cluster.
require_lab_context

info "Deleting workshop Jobs and deterministic filler Pods"

# Delete only workshop-labeled Jobs. Kubernetes then garbage-collects the
# trainer Pods owned by those Jobs; --ignore-not-found also makes reset repeatable.
kubectl delete job -n "$TRAINING_NAMESPACE" -l workshop.example.com/lab --ignore-not-found --wait=true

# Filler Pods are standalone objects, not children of a Job, so remove them
# separately using their role label.
kubectl delete pod -n "$TRAINING_NAMESPACE" -l workshop.example.com/role=placement-filler --ignore-not-found --wait=true

# Deletion is asynchronous. Wait at most 90 seconds for both Pod groups to
# disappear before declaring that the fake GPUs can be reused safely.
wait_for_no_pods "$TRAINING_NAMESPACE" 'workshop.example.com/lab' 90
wait_for_no_pods "$TRAINING_NAMESPACE" 'workshop.example.com/role=placement-filler' 90

ok "all four fake GPUs are available for the next exercise"
