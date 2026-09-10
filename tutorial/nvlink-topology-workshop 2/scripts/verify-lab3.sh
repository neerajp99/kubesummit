#!/usr/bin/env bash
# PURPOSE: Verify both sides of a topology-aware admission decision.
# CALLED BY: all three `make lab3-*` targets with an expected state and Job name.
# READS ONLY: Workload conditions/assignment, Pod bindings, and Node leaf labels.
# INPUTS: --expect admitted|pending, --job NAME, optional --same-leaf|--cross-leaf.
# Verify both sides of a TAS decision:
#   1. Kueue admission state and persisted topologyAssignment.
#   2. Actual Pod bindings compared with the selected Nodes' leaf labels.
# Pending tests additionally require zero trainer Pods, proving that impossible
# strict locality is rejected before partial GPU allocation begins.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_lab_context

expect=""; job=""; locality=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --expect) expect=$2; shift 2 ;;
    --job) job=$2; shift 2 ;;
    --same-leaf) locality=same; shift ;;
    --cross-leaf) locality=cross; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

find_workload() {
  # Kueue-generated Workload names contain a hash. Resolve the stable Job name
  # through ownerReferences instead of depending on generated naming details.
  wanted=$1
  for resource in $(kubectl get workloads.kueue.x-k8s.io -n "$TRAINING_NAMESPACE" -o name 2>/dev/null || true); do
    owner=$(kubectl get -n "$TRAINING_NAMESPACE" "$resource" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null || true)
    [ "$owner" = "$wanted" ] && { basename "$resource"; return 0; }
  done
  return 1
}

if [ -n "$job" ]; then
  started=$SECONDS
  workload=""
  while [ -z "$workload" ]; do
    workload=$(find_workload "$job" || true)
    [ $((SECONDS - started)) -ge 60 ] && die "timed out waiting for Workload owned by Job/$job"
    [ -n "$workload" ] || sleep 1
  done
  resources=$workload
else
  resources=$(kubectl get workloads.kueue.x-k8s.io -n "$TRAINING_NAMESPACE" -o name 2>/dev/null || true)
  [ -n "$resources" ] || die "no Kueue Workloads found in namespace $TRAINING_NAMESPACE"
fi

for workload in $resources; do
  workload=$(basename "$workload")
  if [ "$expect" = "admitted" ]; then
    kubectl wait workload/"$workload" -n "$TRAINING_NAMESPACE" --for=condition=Admitted --timeout=90s
  elif [ "$expect" = "pending" ]; then
    # Pending is an expected policy outcome for the impossible experiment.
    # Wait for an explicit negative condition instead of relying on a sleep.
    started=$SECONDS
    while :; do
      admitted=$(kubectl get workload "$workload" -n "$TRAINING_NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Admitted")].status}' 2>/dev/null || true)
      quota=$(kubectl get workload "$workload" -n "$TRAINING_NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="QuotaReserved")].status}' 2>/dev/null || true)
      { [ "$admitted" = "False" ] || [ "$quota" = "False" ]; } && break
      [ $((SECONDS - started)) -ge 60 ] && die "Workload/$workload did not report a pending condition"
      sleep 1
    done
  fi

  admitted=$(kubectl get workload "$workload" -n "$TRAINING_NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Admitted")].status}' 2>/dev/null || true)
  quota=$(kubectl get workload "$workload" -n "$TRAINING_NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="QuotaReserved")].status}' 2>/dev/null || true)
  echo "Workload/$workload  Admitted=${admitted:-Unknown}  QuotaReserved=${quota:-Unknown}"
  kubectl get workload "$workload" -n "$TRAINING_NAMESPACE" -o jsonpath='{range .status.admission.podSetAssignments[*]}  PodSet={.name} domains={.topologyAssignment.domains}{"\n"}{end}' 2>/dev/null || true
done

if [ "$expect" = "pending" ]; then
  # Required locality must fail closed: no partially started training group.
  pods=$(kubectl get pods -n "$TRAINING_NAMESPACE" -l "job-name=$job" --no-headers 2>/dev/null | wc -l | tr -d ' ')
  [ "$pods" = "0" ] || die "pending workload created $pods Pods; expected zero"
  ok "required topology held the impossible workload before GPU allocation"
  exit 0
fi

if [ -n "$job" ]; then
  # Admission intent is not sufficient evidence. Confirm the resulting Pod
  # bindings satisfy the same-leaf or widened cross-leaf expectation.
  kubectl wait pod -n "$TRAINING_NAMESPACE" -l "job-name=$job" --for=condition=Ready --timeout=90s
  leaves=""
  nodes=$(kubectl get pods -n "$TRAINING_NAMESPACE" -l "job-name=$job" -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}')
  for node in $nodes; do
    leaf=$(kubectl get node "$node" -o jsonpath='{.metadata.labels.workshop\.example\.com/leaf}')
    echo "$node -> $leaf"
    leaves="${leaves}${leaf}\n"
  done
  unique=$(printf '%b' "$leaves" | sed '/^$/d' | sort -u | wc -l | tr -d ' ')
  if [ "$locality" = "same" ] && [ "$unique" != "1" ]; then
    die "expected one leaf, observed $unique"
  fi
  if [ "$locality" = "cross" ] && [ "$unique" -lt 2 ]; then
    die "expected widened cross-leaf placement, observed $unique leaf"
  fi
fi
ok "Lab 3 expectation satisfied"
