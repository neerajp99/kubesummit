#!/usr/bin/env bash
# Full destructive test, scoped only to kind cluster topology-lab.
# The EXIT trap guarantees cleanup even if a lab assertion fails midway.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

bash scripts/preflight.sh --prepare
trap 'bash scripts/cleanup.sh' EXIT
bash scripts/checkpoint.sh 1
make lab1-demo
make lab1-reset
bash scripts/checkpoint.sh 2
make lab3-required
make lab3-impossible
make lab3-preferred
make checkpoint-3
echo "END-TO-END SMOKE TEST PASSED"
