#!/usr/bin/env bash
# PURPOSE: Install the pinned Kueue release from the preflight cache.
# CALLED BY: `make checkpoint-2` after Checkpoint 1 is verified.
# READS: .workshop-cache/kueue-${KUEUE_VERSION}.yaml created by `make prepare`.
# MUTATES: Kueue CRDs, RBAC, Services and controller resources in the lab cluster.
# NETWORK CONTRACT: No conference-network access. A missing cache fails early
# with a remediation message instead of hanging halfway through Lab 2.
# SUCCESS: kueue-controller-manager reports Available within five minutes.
# Means if waits upto 5 minutes.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_lab_context
[ -s "$KUEUE_MANIFEST" ] || die "missing $KUEUE_MANIFEST; run 'make prepare' before the workshop"

info "Installing Kueue ${KUEUE_VERSION} from the local cache"
# Server-side apply handles large CRDs without relying on the size-limited
# kubectl.kubernetes.io/last-applied-configuration annotation.
kubectl apply --server-side -f "$KUEUE_MANIFEST"
kubectl wait deployment/kueue-controller-manager -n kueue-system --for=condition=Available --timeout=300s
ok "Kueue controller available"
