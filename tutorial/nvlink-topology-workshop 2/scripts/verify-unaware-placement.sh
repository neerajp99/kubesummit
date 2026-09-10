#!/usr/bin/env bash
# PURPOSE: Prove the deliberately topology-blind Job spans exactly two leaves.
# CALLED BY: `make lab1-demo` after fillers and the Job are applied.
# READS ONLY: trainer Pod readiness/bindings and the selected Nodes' leaf labels.
# EXPECTS: exactly two Ready trainer Pods and two unique leaf values.
# DETERMINISM: Filler Pods consume one GPU in each leaf, leaving only worker2
# and worker4. Without fillers, the scheduler's valid choice could vary.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_lab_context

kubectl wait pod -n "$TRAINING_NAMESPACE" -l job-name=training-unaware --for=condition=Ready --timeout=90s
nodes=$(kubectl get pods -n "$TRAINING_NAMESPACE" -l job-name=training-unaware -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}')
count=$(printf '%s\n' "$nodes" | sed '/^$/d' | wc -l | tr -d ' ')
[ "$count" = "2" ] || die "expected 2 training-unaware Pods, found $count"

leaves=""
for node in $nodes; do
  leaf=$(kubectl get node "$node" -o jsonpath='{.metadata.labels.workshop\.example\.com/leaf}')
  printf '%-32s -> %s\n' "$node" "$leaf"
  leaves="${leaves}${leaf}\n"
done
unique=$(printf '%b' "$leaves" | sed '/^$/d' | sort -u | wc -l | tr -d ' ')
[ "$unique" = "2" ] || die "expected deterministic cross-leaf placement, but Pods landed in $unique leaf domain(s)"
ok "default scheduler produced a valid but topology-unaware cross-leaf placement"
