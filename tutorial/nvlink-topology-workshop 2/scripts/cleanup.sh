#!/usr/bin/env bash
# PURPOSE: Remove the workshop's live Kubernetes state after the event.
# CALLED BY: `make clean` and the smoke-test EXIT trap.
# DELETES: Only the kind cluster named topology-lab (its containers and network).
# PRESERVES: .workshop-cache, Docker images, repository files, and all unrelated
# Docker/Kubernetes resources. The cluster can be recreated with a checkpoint.
# NOTE: Deletion is idempotent; `|| true` treats an already-absent cluster as clean.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
info "Deleting only kind cluster '$CLUSTER_NAME'"
kind delete cluster --name "$CLUSTER_NAME" || true
ok "cluster removed; preflight cache preserved for recovery"
