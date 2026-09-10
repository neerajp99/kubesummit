#!/usr/bin/env bash
# PURPOSE: Copy pre-cached runtime images from Docker into every kind node.
# CALLED BY: `make cluster-up` and every checkpoint after the cluster exists.
# READS: Docker image store and the cached Kueue manifest's exact image list.
# MUTATES: containerd image stores inside the topology-lab node containers.
# NETWORK CONTRACT: Never pulls. `make prepare` owns all registry/network access,
# keeping live checkpoints deterministic on unreliable conference Wi-Fi.
# FAILURE MEANING: Missing image -> rerun prepare; `no space left on device` ->
# Docker Desktop's internal storage, not the repository filesystem, is full.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_command docker
require_command kind

kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME" || die "kind cluster '$CLUSTER_NAME' does not exist"

# The loop form makes it straightforward to add another small lab image later.
for image in "$LAB_IMAGE"; do
  docker image inspect "$image" >/dev/null 2>&1 || die "image $image is not cached; run 'make prepare'"
  info "Loading $image into $CLUSTER_NAME"
  kind load docker-image "$image" --name "$CLUSTER_NAME"
done

if [ -f "$KUEUE_MANIFEST" ]; then
  # Discover the exact controller images declared by the pinned release rather
  # than maintaining a second, drift-prone image list.
  kueue_images=$(awk '$1 == "image:" {gsub(/\"/, "", $2); print $2}' "$KUEUE_MANIFEST" | sort -u)
  for image in $kueue_images; do
    docker image inspect "$image" >/dev/null 2>&1 || die "image $image is not cached; run 'make prepare'"
    info "Loading $image into $CLUSTER_NAME"
    kind load docker-image "$image" --name "$CLUSTER_NAME"
  done
else
  warn "Kueue manifest is not cached yet; Lab 1 can proceed, but run 'make prepare' before Lab 2"
fi
