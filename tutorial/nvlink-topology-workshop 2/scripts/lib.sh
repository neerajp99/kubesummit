#!/usr/bin/env bash
# PURPOSE: Centralize names, pinned defaults, output helpers, context safety, and
# bounded wait functions shared by the workshop shell scripts.
# CALLED BY: Sourced with `.`; never intended to be executed as a lab itself.
# MUTATES: Nothing merely by being sourced. Individual helpers are read-only;
# mutating callers must first use require_lab_context.
# PORTABILITY: Written for macOS Bash 3.2 as well as newer Linux/WSL2 Bash.

WORKSHOP_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CLUSTER_NAME=${CLUSTER_NAME:-topology-lab}
CLUSTER_CONTEXT="kind-${CLUSTER_NAME}"
TRAINING_NAMESPACE=${TRAINING_NAMESPACE:-training}
GPU_RESOURCE=${GPU_RESOURCE:-workshop.example.com/gpu}
KUEUE_VERSION=${KUEUE_VERSION:-v0.19.2}
KIND_NODE_IMAGE=${KIND_NODE_IMAGE:-kindest/node:v1.34.0}
LAB_IMAGE=${LAB_IMAGE:-registry.k8s.io/e2e-test-images/agnhost:2.53}
CACHE_DIR=${CACHE_DIR:-${WORKSHOP_ROOT}/.workshop-cache}
KUEUE_MANIFEST="${CACHE_DIR}/kueue-${KUEUE_VERSION}.yaml"

worker_nodes() {
  # kind derives deterministic worker names from cluster-setup/kind-config.yaml.
  printf '%s\n' \
    "${CLUSTER_NAME}-worker" \
    "${CLUSTER_NAME}-worker2" \
    "${CLUSTER_NAME}-worker3" \
    "${CLUSTER_NAME}-worker4"
}

info() { printf '==> %s\n' "$*"; }
ok() { printf 'OK  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*" >&2; }
die() { printf 'ERROR  %s\n' "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_lab_context() {
  # Every mutating helper calls this guard before touching Kubernetes. It keeps
  # a participant's real cluster safe if their current context is unexpected.
  current=$(kubectl config current-context 2>/dev/null || true)
  [ "$current" = "$CLUSTER_CONTEXT" ] || die "refusing to mutate context '${current:-<none>}'; expected '${CLUSTER_CONTEXT}'"
}

wait_for_gpu_allocatable() {
  # Node capacity can appear before kubelet publishes allocatable. Poll the
  # scheduler-consumed field so subsequent Jobs do not race propagation.
  node=$1
  timeout=${2:-90}
  started=$SECONDS
  while :; do
    value=$(kubectl get node "$node" -o go-template="{{index .status.allocatable \"${GPU_RESOURCE}\"}}" 2>/dev/null || true)
    [ "$value" = "1" ] && return 0
    [ $((SECONDS - started)) -ge "$timeout" ] && die "timed out waiting for ${GPU_RESOURCE}=1 in ${node}.status.allocatable"
    sleep 1
  done
}

wait_for_no_pods() {
  # Deletion requests are asynchronous. Wait until selectors return zero Pods
  # before allowing the next experiment to reuse fake GPU capacity.
  namespace=$1
  selector=$2
  timeout=${3:-90}
  started=$SECONDS
  while :; do
    count=$(kubectl get pods -n "$namespace" -l "$selector" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    [ "$count" = "0" ] && return 0
    [ $((SECONDS - started)) -ge "$timeout" ] && die "timed out waiting for pods matching ${selector} to disappear"
    sleep 1
  done
}
