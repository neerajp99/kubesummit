#!/usr/bin/env bash
# PURPOSE: Validate the host and optionally cache every network dependency.
# CALLED BY: `make preflight` (--check) and `make prepare` (--prepare).
# --check: Read-only tool/daemon/host-filesystem checks; performs no downloads.
# --prepare: Repeats checks, atomically caches the pinned Kueue manifest, and
# pulls the kind node, lab, and manifest-discovered Kueue controller images.
# WRITES: .workshop-cache/ and Docker's image store only; creates no cluster.
# SUCCESS: --check prints CHECKS PASSED; --prepare prints READY FOR KUBESUMMIT.
# LIMITATION: `df` measures host free space. Docker Desktop's internal Linux
# disk can still fill independently; inspect it separately when image load fails.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

mode=${1:---check}
case "$mode" in
  --check|--prepare) ;;
  *) die "usage: $0 [--check|--prepare]" ;;
esac

fail=0
# Keep the dependency list small and portable across macOS, Linux, and WSL2.
for tool in bash docker kind kubectl curl make python3; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool -> $(command -v "$tool")"
  else
    echo "MISSING  $tool"
    fail=1
  fi
done

if [ "${OS:-}" = "Windows_NT" ] && [ ! -f /proc/version ]; then
  echo "MISSING  WSL2/bash (Windows Command Prompt and native PowerShell are not supported)"
  fail=1
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then ok "Docker daemon reachable"; else echo "MISSING  running Docker daemon"; fail=1; fi
fi

available_kb=$(df -Pk "$WORKSHOP_ROOT" | awk 'NR==2 {print $4}')
if [ "${available_kb:-0}" -ge 5242880 ]; then
  ok "at least 5 GiB free disk"
else
  echo "MISSING  5 GiB free disk (available: ${available_kb:-unknown} KiB)"
  fail=1
fi

[ "$fail" -eq 0 ] || die "preflight failed; fix MISSING items before the workshop"

if [ "$mode" = "--check" ]; then
  echo "CHECKS PASSED — run 'make prepare' while you still have reliable internet."
  exit 0
fi

mkdir -p "$CACHE_DIR"
tmp_manifest="${KUEUE_MANIFEST}.tmp"
# Download to a temporary path and validate content before atomically replacing
# the cache. A partial download must never become the workshop dependency.
info "Caching Kueue ${KUEUE_VERSION} manifest"
curl --fail --location --retry 4 --retry-all-errors \
  "https://github.com/kubernetes-sigs/kueue/releases/download/${KUEUE_VERSION}/manifests.yaml" \
  --output "$tmp_manifest"
grep -q 'kind: Deployment' "$tmp_manifest" || die "downloaded Kueue manifest did not contain a Deployment"
mv "$tmp_manifest" "$KUEUE_MANIFEST"

info "Pulling pinned workshop images"
docker pull "$KIND_NODE_IMAGE"
docker pull "$LAB_IMAGE"
kueue_images=$(awk '$1 == "image:" {gsub(/\"/, "", $2); print $2}' "$KUEUE_MANIFEST" | sort -u)
[ -n "$kueue_images" ] || die "could not discover controller images in $KUEUE_MANIFEST"
for image in $kueue_images; do docker pull "$image"; done

echo ""
echo "✓ READY FOR KUBESUMMIT"
echo "  kind node: $KIND_NODE_IMAGE"
echo "  lab image: $LAB_IMAGE"
echo "  Kueue:     $KUEUE_VERSION (manifest cached locally)"
