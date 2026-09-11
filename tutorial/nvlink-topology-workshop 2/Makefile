# Participant-facing command interface for the workshop.
#
# Targets provide a stable participant interface over the explicitly documented
# scripts and manifests named in each recipe. They are orchestration shortcuts,
# not hidden behavior: the notebook explains inputs, mutations, evidence, and
# recovery for every target. Each live lab starts from a known state and ends
# with automated assertions so forty attendees share the same experiment.
# `clean` is scoped to the kind cluster named topology-lab; cached assets remain.
SHELL := /bin/bash
.DEFAULT_GOAL := help

# Reproducibility contract. Override only when validating a planned upgrade.
KUEUE_VERSION ?= v0.19.2
KIND_NODE_IMAGE ?= kindest/node:v1.34.0
LAB_IMAGE ?= registry.k8s.io/e2e-test-images/agnhost:2.53

export KUEUE_VERSION KIND_NODE_IMAGE LAB_IMAGE

.PHONY: help
help:
	@echo "Topology-Aware GPU Placement workshop"
	@echo ""
	@echo "Before the conference:"
	@echo "  make preflight          Validate tools, Docker, RAM and disk"
	@echo "  make prepare            Cache images and the pinned Kueue manifest"
	@echo ""
	@echo "Live workshop path:"
	@echo "  make checkpoint-1       Recover/create the fake GPU datacenter"
	@echo "  make lab1-demo          Deterministic topology-blind placement"
	@echo "  make lab1-reset         Return to the Lab 1 start state"
	@echo "  make checkpoint-2       Recover/install Kueue + TAS configuration"
	@echo "  make lab3-required      Require one leaf for the whole PodSet"
	@echo "  make lab3-impossible    Prove required locality waits"
	@echo "  make lab3-preferred     Prove preferred locality widens"
	@echo "  make checkpoint-3       Recover the clean TAS-ready state"
	@echo ""
	@echo "Optional/reference:"
	@echo "  make notebook           Regenerate the attendee notebook"
	@echo "  make admission-policy   Install the scoped CEL policy"
	@echo "  make test               Run static and unit tests (no cluster needed)"
	@echo "  make smoke              Run the full lab against a working Docker daemon"
	@echo "  make reset-jobs         Delete lab Jobs/Pods and wait for release"
	@echo "  make clean              Delete only the topology-lab kind cluster"

.PHONY: preflight
# Read-only host checks. Network downloads happen only in the prepare target.
preflight:
	bash scripts/preflight.sh --check

.PHONY: prepare
# Networked preparation: cache the release manifest and pinned Docker images.
prepare:
	bash scripts/preflight.sh --prepare

.PHONY: cluster-up
# Create the five-node simulated datacenter and load only pre-cached images.
cluster-up:
	@if kind get clusters 2>/dev/null | grep -qx topology-lab; then \
		echo "Cluster topology-lab already exists."; \
	else \
		kind create cluster --config cluster-setup/kind-config.yaml --image "$(KIND_NODE_IMAGE)"; \
	fi
	bash scripts/load-images.sh
	kubectl apply -f cluster-setup/namespaces.yaml

.PHONY: label-topology
# Validate sample-inventory.json, then publish block/leaf/rack Node labels.
label-topology:
	bash cluster-setup/label-topology.sh

.PHONY: advertise-gpus
# Publish one fake extended resource on each worker and wait for allocatable=1.
advertise-gpus:
	bash cluster-setup/advertise-fake-gpus.sh

.PHONY: verify-lab1
verify-lab1:
	bash scripts/verify-lab1.sh

.PHONY: checkpoint-1
checkpoint-1:
	bash scripts/checkpoint.sh 1

.PHONY: lab1-demo test-unaware
# Demonstrate a valid quantity-based placement that crosses leaf domains.
lab1-demo test-unaware:
	bash scripts/reset-workloads.sh
	kubectl apply -f jobs/placement-fillers.yaml
	kubectl wait pod -n training -l workshop.example.com/role=placement-filler --for=condition=Ready --timeout=90s
	kubectl apply -f jobs/training-unaware.yaml
	bash scripts/verify-unaware-placement.sh

.PHONY: lab1-reset
# Remove experiment Jobs/fillers and wait until their fake GPU claims are gone.
lab1-reset:
	bash scripts/reset-workloads.sh

.PHONY: kueue-install
# Apply the pinned local Kueue manifest; no registry or GitHub access occurs.
kueue-install:
	bash scripts/install-kueue.sh

.PHONY: label-gpu-nodes
# Mark simulated GPU workers eligible for ResourceFlavor/h100-topology.
label-gpu-nodes:
	bash cluster-setup/label-gpu-nodes.sh

.PHONY: kueue-config
# Apply the Topology -> ResourceFlavor -> ClusterQueue -> LocalQueue chain.
kueue-config:
	kubectl apply -f kueue-config/topology.yaml
	kubectl apply -f kueue-config/resource-flavor.yaml
	kubectl apply -f kueue-config/cluster-queue.yaml
	kubectl apply -f kueue-config/local-queue.yaml

.PHONY: verify-lab2
verify-lab2:
	bash scripts/verify-lab2.sh

.PHONY: checkpoint-2
# Compose Checkpoint 1 with Kueue installation and the complete TAS object graph.
checkpoint-2:
	bash scripts/checkpoint.sh 2

.PHONY: lab3-required test-required
# Feasible strict locality: both trainer replicas must fit in one leaf.
lab3-required test-required:
	bash scripts/reset-workloads.sh
	kubectl apply -f jobs/training-topology-required.yaml
	bash scripts/verify-lab3.sh --expect admitted --job training-topology-aware --same-leaf

.PHONY: lab3-impossible test-impossible
# Infeasible strict locality: Kueue must hold the Workload and create zero Pods.
lab3-impossible test-impossible:
	bash scripts/reset-workloads.sh
	kubectl apply -f jobs/training-impossible.yaml
	bash scripts/verify-lab3.sh --expect pending --job training-impossible

.PHONY: lab3-preferred test-preferred
# Soft locality: try leaf first, then widen to block so the Job can run.
lab3-preferred test-preferred:
	bash scripts/reset-workloads.sh
	kubectl apply -f jobs/training-topology-preferred.yaml
	bash scripts/verify-lab3.sh --expect admitted --job training-preferred --cross-leaf

.PHONY: verify-lab3
verify-lab3:
	bash scripts/verify-lab3.sh

.PHONY: checkpoint-3
checkpoint-3:
	bash scripts/checkpoint.sh 3

.PHONY: admission-policy
# Optional: enforce object-local topology intent through CEL admission policy.
admission-policy:
	kubectl apply -f webhook/validating-admission-policy.yaml

.PHONY: notebook
# Regenerate the canonical notebook inside this self-contained workshop folder.
notebook:
	node scripts/build-notebook.js

.PHONY: reset-jobs
# Alias for the bounded workload cleanup used between experiments.
reset-jobs:
	bash scripts/reset-workloads.sh

.PHONY: test
# Offline checks only; this target neither needs nor mutates a live cluster.
test:
	bash tests/static-test.sh
	python3 -m unittest discover -s tests -p 'test_*.py' -v

.PHONY: smoke
# Destructive integration test scoped to topology-lab; cleanup runs on exit.
smoke:
	bash tests/smoke-test.sh

.PHONY: all
all: checkpoint-2
	@echo "Cluster + Kueue + TAS are ready. Next: make lab3-required"

.PHONY: clean
# Delete topology-lab only; preserve cached manifest and Docker images.
clean:
	bash scripts/cleanup.sh
