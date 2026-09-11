#!/usr/bin/env node
// Build the attendee notebooks from one reviewed source.
//
// The notebook is intentionally more detailed than the projected deck: slides
// explain the model, while this artifact carries commands, expected evidence,
// interpretation prompts, and recovery instructions. Never edit either .ipynb
// directly; update this file and run `node scripts/build-notebook.js`.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tutorialRoot = path.dirname(root);
const cells = [];
const nextId = () => `cell-${String(cells.length + 1).padStart(3, "0")}`;
const markdown = (source) => cells.push({ id: nextId(), cell_type: "markdown", metadata: {}, source: source.split(/(?<=\n)/) });
const code = (source) => cells.push({ id: nextId(), cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: `${source.trim()}\n`.split(/(?<=\n)/) });
const bash = (source) => code(`%%bash\n${source}`);
const bullets = (items) => items.map((item) => `- ${item}`).join("\n");
const executionGuide = ({ title, mode, simple, objective, invokes, actions, changes, success, meaning, recovery, caution }) => {
  const labels = [];
  if (/PRE-EVENT|BEFORE THE EVENT/.test(mode)) labels.push("PRE-EVENT");
  else if (/TAKE-HOME/.test(mode)) labels.push("TAKE-HOME");
  else if (/LIVE/.test(mode)) labels.push("LIVE");
  else if (/OPTIONAL/.test(mode)) labels.push("OPTIONAL");
  else labels.push("REFERENCE");
  if (/READ-ONLY/.test(mode)) labels.push("READ-ONLY");
  if (/NETWORK/.test(mode)) labels.push("NEEDS INTERNET");
  if (/MUTAT/.test(mode)) labels.push("CHANGES LAB");
  if (/DESTRUCTIVE/.test(mode)) labels.push("DELETES LAB");
  const badges = labels.map((part) => `\`${part}\``).join("  ");
  markdown(`### ${title || objective}

${badges}

**Why this cell is here**

${simple || objective}

**What it does**

${bullets(actions)}

**Expected result**

${success}

<details>
<summary><strong>Implementation details, interpretation and recovery</strong></summary>

**Runs or reads**

${bullets(invokes)}

**State changed:** ${changes}

**How to interpret the result:** ${meaning}

**If it fails:** ${recovery}${caution ? `\n\n**Safety / caveat:** ${caution}` : ""}

</details>`);
};
const guidedBash = (source, guide) => {
  executionGuide(guide);
  bash(source);
};
const guidedCode = (source, guide) => {
  executionGuide(guide);
  code(source);
};

markdown(`# The Scheduler Has Never Heard of NVLink
### Topology-Aware GPU Placement on Kubernetes — advanced attendee workbook

This notebook is the executable companion to the **39-slide live deck**. The deck establishes the mental model; the notebook proves the scheduling behavior and exposes the implementation.

**Environment:** Bash on macOS/Linux or WSL2, Docker, kind, kubectl, curl, make, and Python 3. **No physical GPU is required.** Fake extended resources model Kubernetes capacity; they do not model CUDA, NVLink bandwidth, NCCL, DCGM, or training performance.

Every experiment follows the same contract:

> **QUESTION → START STATE → ACTION → EXPECTED EVIDENCE → INTERPRETATION → RECOVERY**

Run the notebook from the repository root. Do not paste commands from screenshots; the Makefile and versioned manifests are the source of truth.`);

markdown(`## Start here — establish the notebook working directory

The “repository root” for this workbook means the directory containing this workshop's \`Makefile\`, \`jobs/\`, \`kueue-config/\`, and \`scripts/\`:

\`\`\`bash
cd "kubesummit/tutorial/nvlink-topology-workshop 2"
make preflight
make prepare
jupyter lab workshop-walkthrough.ipynb
\`\`\`

If the workshop folder was copied elsewhere, \`cd\` to that copy instead.

Why this matters: every \`%%bash\` cell is a new shell process, but it inherits the Jupyter server's current directory. A \`cd\` performed inside one Bash cell does **not** carry into the next cell. Launching Jupyter here makes every relative path deterministic.`);

markdown(`### How to read the notebook

Every runnable cell begins with a specific action heading such as **Create the lab cluster**, **Start the filler and trainer Pods**, or **Prove strict locality**.

- The short explanation, action, and expected result remain visible.
- Small badges tell you whether the step is live, optional, read-only, or mutating.
- Detailed implementation, state changes, interpretation, and recovery are inside a collapsed section. Expand it while preparing or troubleshooting; leave it closed while presenting.

The Makefile is the stable participant interface; the guide exposes its implementation so convenience does not become opacity.`);

guidedCode(`from pathlib import Path

workshop_root = Path.cwd().resolve()
required = ["Makefile", "scripts", "jobs", "kueue-config", "cluster-setup"]
missing = [name for name in required if not (workshop_root / name).exists()]
assert not missing, (
    f"Wrong working directory: {workshop_root}\\n"
    f"Missing: {', '.join(missing)}\\n"
    "Restart Jupyter from the nvlink-topology-workshop 2 directory."
)
print(f"WORKSHOP ROOT: {workshop_root}")
print("OK — relative paths in later cells will resolve correctly.")`, {
  title: "Confirm that Jupyter is in the workshop directory",
  mode: "REQUIRED ONCE · READ-ONLY",
  objective: "Fail immediately if Jupyter was launched from the wrong directory instead of discovering the problem halfway through a lab.",
  invokes: ["Python's standard-library `pathlib`; it does not invoke Docker or Kubernetes."],
  actions: ["Resolves the kernel's current directory.", "Checks for five workshop landmarks used by later cells."],
  changes: "None. This is a local filesystem inspection.",
  success: "The output shows `WORKSHOP ROOT: .../nvlink-topology-workshop 2` followed by `OK`.",
  meaning: "Passing proves paths such as `jobs/...` and `scripts/...` will resolve. It says nothing yet about Docker or the cluster.",
  recovery: "Stop the Jupyter server, `cd` to the workshop directory, relaunch it, and rerun this cell. Changing directory in one `%%bash` cell is not a durable fix."
});

markdown(`## 90-minute route

| Time | Live slides | Activity | Primary medium |
|---:|---:|---|---|
| 0–12 min | 1–8 | Problem, communication hierarchy, ownership | Slides |
| 12–27 min | 9–14 | Phase 1: fake datacenter and topology-blind placement | Notebook |
| 27–42 min | 15–20 | Phase 2: model the fabric in Kueue | Slides + notebook |
| 42–64 min | 21–28 | Phase 3: required, impossible, preferred locality | Notebook |
| 64–73 min | 29–31 | Gang scheduling, TAS, Cohort, Topology Manager | Slides + workbook reference |
| 73–82 min | 32–37 | Inventory pipeline, policy, evidence | Notebook |
| 82–87 min | 38–39 | Production architecture and rules | Slides |
| 87–90 min | — | Questions or recovery buffer | — |

The live labs are the center of the workshop. Advanced production sections are designed for guided inspection rather than installation on the fake cluster.`);

markdown(`## 1 — The physical model before Kubernetes

> **Presentation mapping — Live slides 1–8:** use this section while explaining the topology problem, bandwidth hierarchy, AllReduce, and responsibility map. No live cluster action is required yet.

A distributed training job does not consume an unordered bag of GPUs. It consumes positions in a communication graph:

\`\`\`text
GPU ↔ NVLink/NVSwitch ↔ GPU
          │
       PCIe root / NUMA
          │
      ConnectX NIC
          │
   leaf switch ↔ spine ↔ leaf switch
\`\`\`

Reference orders of magnitude:

| Link | Advertised rate | Scope |
|---|---:|---|
| H100 NVLink | approximately 900 GB/s aggregate | GPU-to-GPU inside the node |
| PCIe Gen5 x16 | approximately 64 GB/s per direction | device-to-host/NIC path |
| InfiniBand NDR | 400 Gb/s ≈ 50 GB/s raw line rate | node-to-node |
| InfiniBand HDR | 200 Gb/s ≈ 25 GB/s raw line rate | prior-generation node-to-node |

The units matter: **Gb/s is gigabits; GB/s is gigabytes**. Real application bandwidth is lower than raw line rate.`);

markdown(`### Why AllReduce makes placement visible

Data-parallel training repeatedly executes:

\`\`\`text
forward → backward → gradient AllReduce → optimizer step
\`\`\`

Communication time depends on message size, collective algorithm, link bandwidth, topology, and congestion. NCCL can optimize within the placement it receives; it cannot move a Pod to another Kubernetes node.

This laptop lab proves:

- labels can describe topology domains;
- Kueue can admit a whole PodSet into a domain;
- required locality can wait instead of partially allocating GPUs;
- preferred locality can widen under pressure.

It does **not** prove bandwidth, MFU, NCCL efficiency, or a universal 40–60% performance difference.`);

markdown(`## 2 — Preflight before conference Wi-Fi

> **Presentation mapping — before Live slide 1:** complete this preparation before the session. If necessary, show only the final readiness result before beginning the deck.

Preparation has two deliberately separate stages. \`make preflight\` is read-only. \`make prepare\` uses the network and writes only to the workshop cache plus Docker Desktop's image store.`);

guidedBash(`make preflight`, {
  title: "Check that this laptop can run the workshop",
  mode: "REQUIRED BEFORE THE EVENT · READ-ONLY",
  objective: "Prove that the host has the command-line tools and minimum host-side capacity needed by the workshop.",
  invokes: ["`Makefile` target `preflight`.", "`scripts/preflight.sh --check`."],
  actions: ["Locates Bash, Docker, kind, kubectl, curl, make, and Python 3.", "Calls `docker info` to prove the Docker daemon is reachable.", "Uses `df` on the workshop filesystem and requires at least 5 GiB of host free space.", "On Windows, requires WSL2/Bash."],
  changes: "None. It does not pull images, create a cluster, switch context, or modify Kubernetes.",
  success: "Every line begins with `OK`, followed by `CHECKS PASSED — run 'make prepare'...`.",
  meaning: "This validates host prerequisites only. It cannot guarantee that Docker Desktop's internal Linux disk has enough free space for five kind nodes.",
  recovery: "Fix each line marked `MISSING`; start Docker Desktop if the daemon is unavailable, then rerun the cell.",
  caution: "Host disk and Docker Desktop VM disk are different capacity pools. A later `no space left on device` from containerd means Docker's internal storage needs cleanup or a larger disk allocation even if this check passed."
});

guidedBash(`make prepare`, {
  title: "Download and cache the workshop dependencies",
  mode: "REQUIRED BEFORE THE EVENT · NETWORK + LOCAL CACHE WRITE",
  objective: "Make the live checkpoints independent of conference Wi-Fi by downloading every pinned dependency in advance.",
  invokes: ["`Makefile` target `prepare`.", "`scripts/preflight.sh --prepare`.", "GitHub Releases through `curl` and image registries through `docker pull`."],
  actions: ["Repeats all preflight checks.", "Creates `.workshop-cache/`.", "Downloads Kueue `v0.19.2` to a temporary file, checks that it contains a Deployment, then atomically renames it to `.workshop-cache/kueue-v0.19.2.yaml`.", "Pulls `kindest/node:v1.34.0`, `registry.k8s.io/e2e-test-images/agnhost:2.53`, and every controller image discovered from the pinned Kueue manifest."],
  changes: "Writes one manifest beneath `.workshop-cache/` and adds images to Docker Desktop's image store. It does not create the kind cluster.",
  success: "The final line is `✓ READY FOR KUBESUMMIT` and lists the pinned kind image, lab image, and Kueue version.",
  meaning: "The host now owns the installation inputs. Later checkpoints copy these cached images into kind; they do not pull from the network.",
  recovery: "Keep reliable internet available, free host/Docker storage if needed, and rerun `make prepare`. The temporary-download/atomic-move design prevents a partial manifest from replacing a valid cache."
});

guidedBash(`test -s .workshop-cache/kueue-v0.19.2.yaml
grep -m1 'kind: Deployment' .workshop-cache/kueue-v0.19.2.yaml
docker image inspect kindest/node:v1.34.0 --format 'kind image: {{.Id}}'
docker image inspect registry.k8s.io/e2e-test-images/agnhost:2.53 --format 'lab image:  {{.Id}}'
docker image inspect registry.k8s.io/kueue/kueue:v0.19.2 --format 'Kueue:     {{.Id}}'
if ! docker system df; then
  echo "WARN: required workshop artifacts passed, but Docker's optional usage report failed."
  echo "Restart Docker Desktop; if it persists, inspect/reclaim unused build cache with: docker builder prune"
fi`, {
  title: "Confirm that the offline cache is ready",
  mode: "RECOMMENDED PRE-EVENT INSPECTION · READ-ONLY",
  objective: "Verify the artifacts that `make prepare` promised instead of treating its readiness banner as a black box.",
  invokes: ["POSIX file tests and `grep` for the cached manifest.", "`docker image inspect` for each pinned image.", "`docker system df` for Docker-managed usage and reclaimable space."],
  actions: ["Confirms the manifest is non-empty and contains a Deployment.", "Prints immutable local image IDs.", "Attempts to summarize Docker images, containers, volumes, and build cache; this optional report is handled as a warning if Docker's cache metadata is unhealthy."],
  changes: "None.",
  success: "Three image IDs print without errors. A Docker usage table normally follows; a clearly labeled warning is acceptable because it does not invalidate the required cached artifacts.",
  meaning: "The manifest and three image inspections are the readiness assertions. `docker system df` is diagnostics only. Images live inside Docker Desktop's Linux VM/disk image, not this repository.",
  recovery: "Rerun `make prepare` for a missing manifest/image. If only `docker system df` fails with a missing `overlay2` path, restart Docker Desktop. If it persists, `docker builder prune` removes unused build cache after confirmation; avoid broad `docker system prune --volumes` because it can delete unrelated data."
});

guidedBash(`make test`, {
  title: "Optional instructor check: validate the workshop repository",
  mode: "OPTIONAL INSTRUCTOR PRE-EVENT CHECK · OFFLINE · READ-ONLY",
  objective: "Let maintainers catch broken source assets before publishing; participants do not need this for the live labs.",
  invokes: ["`tests/static-test.sh`.", "Python `unittest` discovery for `tests/test_*.py`."],
  actions: ["Runs `bash -n` on every shell entry point.", "Dry-runs important Make recipes.", "Parses every YAML document, validates the inventory against JSON Schema, validates the canonical notebook, and checks that its Bash cells parse.", "Tests the topology renderer, admission-policy core, and benchmark summarizer."],
  changes: "None. `make test` is not the end-to-end cluster test; that is the optional destructive `make smoke`.",
  success: "`Static validation passed...` followed by all Python tests reporting `OK`.",
  meaning: "The repository is internally coherent. It does not prove that Docker has enough internal disk or that a live kind cluster can start.",
  recovery: "Maintainers should fix the first reported source artifact. Participants may skip this optional check and use `make preflight`, `make prepare`, and the numbered checkpoints."
});

markdown(`### Recovery contract

| Symptom | Recovery command | Restored state |
|---|---|---|
| Cluster, labels, or fake resources drifted | \`make checkpoint-1\` | Five Ready nodes and four allocatable fake GPUs |
| Lab 1 Pods still own capacity | \`make lab1-reset\` | All four fake GPUs free |
| Kueue or TAS objects are missing | \`make checkpoint-2\` | Controller available and ClusterQueue Active |
| Lab 3 Workloads collide | \`make checkpoint-3\` | TAS ready with zero lab workloads |

In a 40-person room, use checkpoints instead of debugging one laptop serially.`);

markdown(`---
# Phase 1 — Build a fake datacenter and reproduce bad placement

> **Presentation mapping — Live slides 9–14:** build the fake topology, reproduce cross-leaf placement, inspect the result, and reset the capacity boundary.

The cluster has one control-plane node and four worker nodes. Each worker advertises one fake GPU.

\`\`\`text
                       block-1
              ┌──────────┴──────────┐
            leaf-a                leaf-b
       ┌──────┴──────┐       ┌──────┴──────┐
     worker       worker2   worker3       worker4
      1 GPU         1 GPU    1 GPU          1 GPU
\`\`\`

The resource name is \`workshop.example.com/gpu\` so nobody mistakes it for a real NVIDIA device plugin resource.`);

markdown(`## 3 — Restore Checkpoint 1

> **Presentation cue — Live slides 9–10:** establish the four-GPU, two-leaf baseline before explaining the transaction boundary.

This idempotent command creates the named kind cluster if needed, loads cached images, applies the topology inventory, advertises fake resources, removes stale workloads, and verifies the result.`);
guidedBash(`make checkpoint-1`, {
  title: "Create or restore the four-GPU fake datacenter",
  mode: "LIVE PATH · MUTATES ONLY `kind-topology-lab`",
  objective: "Converge every laptop on the same five-node, four-fake-GPU starting state for slides 9–10.",
  invokes: ["`Makefile` → `scripts/checkpoint.sh 1`.", "That script composes kind, `load-images.sh`, namespace YAML, topology rendering/labeling, fake-GPU advertisement, workload reset, and `verify-lab1.sh`."],
  actions: ["Creates cluster `topology-lab` only if absent; otherwise reuses it.", "Selects context `kind-topology-lab`, loads pre-cached images into all kind nodes, and applies the `training` namespace.", "Validates inventory, labels four workers as two leaves, patches one fake GPU into each worker's Node status, waits for allocatable, deletes stale lab workloads, then asserts the complete baseline."],
  changes: "May create five Docker containers for kind; switches the current kubectl context; labels/patches Nodes; removes workshop-labeled Jobs and Pods. It never touches another Kubernetes context.",
  success: "Ends with `CHECKPOINT 1 VERIFIED` and `CHECKPOINT 1 — fake GPU datacenter ready`; five Nodes are Ready and four workers each expose one allocatable fake GPU.",
  meaning: "The simulated infrastructure facts now exist in the Kubernetes API. No Kueue controller or topology-aware policy is installed yet.",
  recovery: "It is idempotent: rerun the same target. If image loading says `no space left on device`, delete the partial lab cluster with `make clean`, reclaim/increase Docker Desktop storage, then rerun `make checkpoint-1`."
});

markdown(`## 4 — Inspect the topology source contract

> **Presentation cue — Live slide 9; revisited on slides 32–33:** connect the visual topology to the versioned inventory that produces the Node labels.

Node labels should be output from an owned data pipeline, not handwritten folklore. The sample inventory contains:

- normalized block, leaf, rack, NIC, and GPU SKU;
- provenance for rack, leaf, GPU, and NUMA facts;
- a schema version and generation timestamp.

### Field dictionary

| Field | Plain-language meaning | Example in this lab |
|---|---|---|
| \`$schema\` | Points editors and tooling to the local validation/documentation contract | \`./inventory.schema.json\` |
| \`schemaVersion\` | Version of our inventory contract—not the Kubernetes version | \`v1\` |
| \`generatedAt\` | When this normalized snapshot was produced; used to detect stale data | \`2026-09-02T00:00:00Z\` |
| \`name\` | Exact Kubernetes Node name that will receive the labels | \`topology-lab-worker2\` |
| \`block\` | Coarse network/fabric domain containing multiple leaf switches | \`block-1\` |
| \`leaf\` | Leaf-switch domain connected to the node; our important locality boundary | \`leaf-a\` |
| \`rack\` | Physical rack location | \`rack-a1\` |
| \`nic\` | High-speed network-interface identifier | \`mlx5_0\` |
| \`gpuSku\` | Normalized accelerator model/capacity class; \`h100-sxm5\` means NVIDIA H100 SXM5-class | \`h100-sxm5\` |
| \`sources\` | Provenance: which authoritative system supplied each fact | NetBox, LLDP/fabric API, GPU Operator, kubelet |

The values describe the production-style contract we want to teach. The kind workers still have **fake extended GPU resources**, not physical H100s or ConnectX NICs.

In production, these facts normally come from DCIM, LLDP/fabric APIs, GPU Operator/DRA, and kubelet/device discovery.`);
guidedBash(`sed -n '1,220p' topology-pipeline/sample-inventory.json
sed -n '1,240p' topology-pipeline/inventory.schema.json`, {
  title: "Read the datacenter map and its validation rules",
  mode: "GUIDED INSPECTION · READ-ONLY",
  simple: "The first file is our map of the fake datacenter. The second file is the rulebook that says what a valid map must contain. This cell only displays both files.",
  objective: "See the source-of-truth records and the machine-enforced contract before looking at their Kubernetes labels.",
  invokes: ["`sed` against `topology-pipeline/sample-inventory.json` and `inventory.schema.json`."],
  actions: ["Prints the normalized node records: name, block, leaf, rack, NIC, GPU SKU, NUMA data, and field provenance.", "Prints the JSON Schema that constrains types and required fields."],
  changes: "None; both files are only read.",
  success: "Four worker records appear, with two mapped to `leaf-a` and two to `leaf-b`; the schema identifies required inventory fields.",
  meaning: "The inventory is infrastructure data, while the schema is its interface contract. Neither file by itself mutates Kubernetes.",
  recovery: "If a path is missing, rerun the working-directory guard. If output is truncated in the notebook UI, open the files directly."
});

guidedBash(`python3 scripts/render-topology.py --check
python3 scripts/render-topology.py --format table`, {
  title: "Validate the inventory and render a readable topology table",
  mode: "LIVE EXPLANATION · READ-ONLY",
  objective: "Demonstrate the validation and normalization boundary between infrastructure inventory and Kubernetes publication.",
  invokes: ["`scripts/render-topology.py` first in validation mode, then in human-readable table mode."],
  actions: ["Parses JSON, checks schema version, non-empty/unique node names, normalized label syntax, and provenance for rack/leaf/GPU/NUMA fields.", "Sorts nodes and renders a deterministic table."],
  changes: "None. `--check` and `--format table` do not label Nodes.",
  success: "`OK: 4 nodes satisfy topology inventory v1`, followed by a four-row table.",
  meaning: "Only validated, deterministic topology should enter the scheduling control plane. The publisher later consumes the same renderer as TSV.",
  recovery: "Read the `ERROR:` line and correct the named inventory field. Do not bypass validation and publish guessed labels."
});

guidedBash(`kubectl get nodes -L workshop.example.com/block -L workshop.example.com/leaf -L workshop.example.com/rack`, {
  title: "Confirm that the topology labels reached Kubernetes",
  mode: "LIVE EVIDENCE · READ-ONLY",
  objective: "Compare the intended inventory with the labels actually published on Kubernetes Nodes.",
  invokes: ["`kubectl get nodes` with three label columns."],
  actions: ["Queries the current cluster and joins each Node's Ready/role information with block, leaf, and rack labels."],
  changes: "None.",
  success: "All five Nodes appear; the four workers show `block-1`, an even `leaf-a`/`leaf-b` split, and distinct rack labels. The control-plane may have blank workshop labels.",
  meaning: "Scheduler-visible topology is Node metadata. This is the published view, not proof that LLDP/DCIM facts are correct in the physical world.",
  recovery: "Confirm context with `kubectl config current-context`; if labels are missing, rerun `make checkpoint-1`."
});

markdown(`## 5 — Understand the fake extended resource

> **Presentation cue — supports Live slides 9–10:** explain how the lab creates scheduler-visible capacity. This implementation detail does not need a full projected walkthrough.

The lab patches the Node \`status\` subresource because extended-resource capacity is reported as node status. The script then waits for \`status.allocatable\`: scheduler feasibility uses **allocatable**, not merely capacity.

This is a simulation mechanism for kind. A production cluster uses a device plugin or DRA driver; operators should not patch GPU capacity manually.`);
guidedBash(`sed -n '1,220p' cluster-setup/advertise-fake-gpus.sh`, {
  title: "See how the lab creates fake GPU capacity",
  mode: "OPTIONAL IMPLEMENTATION INSPECTION · READ-ONLY",
  simple: "This displays the script that makes each ordinary kind worker appear to Kubernetes as if it owns one GPU. It shows the script; it does not run it again.",
  objective: "Remove the magic behind the fake GPU: see precisely how scheduler-visible capacity is simulated.",
  invokes: ["`sed` against `cluster-setup/advertise-fake-gpus.sh`."],
  actions: ["Shows a JSON Patch to `/status/capacity/workshop.example.com~1gpu` for each deterministic worker name.", "Shows the subsequent polling of `status.allocatable`, the field the scheduler actually consumes."],
  changes: "None; this cell prints the script. The script itself already ran inside Checkpoint 1.",
  success: "You can identify the status-subresource patch and `wait_for_gpu_allocatable` loop.",
  meaning: "This is a control-plane simulation. It does not provide a device, driver, CUDA runtime, NVLink, or isolation.",
  recovery: "If the file is missing, check the working directory. Do not run the patch pattern against a production node."
});

guidedBash(`kubectl get nodes -o go-template='{{range .items}}{{.metadata.name}}{{"  capacity="}}{{index .status.capacity "workshop.example.com/gpu"}}{{"  allocatable="}}{{index .status.allocatable "workshop.example.com/gpu"}}{{"\\n"}}{{end}}'`, {
  title: "Confirm one fake GPU is schedulable on every worker",
  mode: "LIVE EVIDENCE · READ-ONLY",
  objective: "Inspect capacity and allocatable separately so the fake resource is not mistaken for merely decorative metadata.",
  invokes: ["`kubectl get nodes` with a Go template indexing the extended-resource key."],
  actions: ["Reads both `.status.capacity` and `.status.allocatable` for every Node."],
  changes: "None.",
  success: "Each worker reports `capacity=1 allocatable=1`; the control-plane reports empty values.",
  meaning: "Capacity describes what the node owns. Allocatable is the schedulable amount after reservation; kube-scheduler filters on allocatable.",
  recovery: "Rerun `make checkpoint-1`. If capacity appears before allocatable, the checkpoint waits up to 90 seconds for kubelet reconciliation."
});

markdown(`## 6 — Lab 1 hypothesis: quantity without locality

> **Presentation mapping — Live slides 11–14:** inspect the unaware Job, run the deterministic cross-leaf case, interpret the evidence, and reset.

The default scheduler can satisfy two independent one-GPU Pods without knowing that they are peer ranks in one collective. To make the demonstration deterministic, filler Pods occupy one GPU in each leaf. The remaining feasible nodes are on different leaves.

Before executing, inspect the intent:

- filler Pods are pinned to known nodes;
- the training Job requests one fake GPU per replica;
- the Job has no Kueue queue label and no topology annotation.

### The two files have different jobs

1. **\`placement-fillers.yaml\` prepares the experiment.** It creates \`leaf-a-filler\` on \`worker\` and \`leaf-b-filler\` on \`worker3\`. Each holds one fake GPU, leaving only \`worker2\` and \`worker4\` available.
2. **\`training-unaware.yaml\` is the workload under test.** It creates a Job whose controller creates two trainer Pods. Each requests one fake GPU, but neither asks to share a leaf.

The following inspection cell creates nothing. The Pods appear only when we later run \`make lab1-demo\`.`);
guidedBash(`sed -n '1,180p' jobs/placement-fillers.yaml
sed -n '1,200p' jobs/training-unaware.yaml`, {
  title: "Meet the two kinds of Pods used in Lab 1",
  mode: "LIVE MANIFEST WALKTHROUGH · READ-ONLY",
  simple: "`placement-fillers.yaml` creates two harmless placeholder Pods that deliberately occupy one fake GPU in each leaf. `training-unaware.yaml` defines a Kubernetes Job whose controller creates the two pretend trainer Pods we want to observe. This cell only displays the files; `make lab1-demo` applies them later.",
  objective: "Predict the topology-blind outcome from the workload declarations before executing them.",
  invokes: ["`sed` against the filler Pod manifest and the topology-unaware Job."],
  actions: ["Shows two filler Pods pinned to workers in different leaves, each consuming one fake GPU.", "Shows a two-replica Job requesting one fake GPU per Pod, with no queue label or TAS annotation."],
  changes: "None.",
  success: "You can point to each filler's hostname `nodeSelector`, `parallelism: 2` on the Job, the extended-resource request/limit, and the absence of Kueue topology intent.",
  meaning: "The scheduler sees four independent resource consumers. Nothing declares that the two trainer Pods exchange gradients or should share a leaf.",
  recovery: "If the manifests differ from this description, stop and run `make test`; the checked-in assets may have drifted."
});

guidedBash(`make lab1-demo`, {
  title: "Create two filler Pods, then start two trainer Pods",
  mode: "LIVE LAB 1 · MUTATING · ABOUT 1–2 MINUTES",
  objective: "Create a deterministic example where default scheduling is valid by resource quantity but poor for communication locality.",
  invokes: ["`scripts/reset-workloads.sh`.", "`jobs/placement-fillers.yaml` and `jobs/training-unaware.yaml`.", "`scripts/verify-unaware-placement.sh`."],
  actions: ["Clears previous lab workloads and waits for GPU release.", "Starts one filler in each leaf, waits for them to become Ready, then creates the two-replica unaware Job.", "Waits for both trainers and resolves their Node labels, failing unless two distinct leaves are observed."],
  changes: "Creates two filler Pods, one Job, and two trainer Pods in namespace `training`; all four fake GPUs become allocated.",
  success: "Ends with `default scheduler produced a valid but topology-unaware cross-leaf placement` and prints one trainer node from each leaf.",
  meaning: "Kubernetes did not make an illegal decision; the workload omitted locality semantics. Deterministic fillers make the missing contract visible.",
  recovery: "Run `make lab1-reset`, then `make checkpoint-1`, and rerun this cell. Inspect Pending Pods with `kubectl describe pod -n training <name>` if the verifier times out."
});

guidedBash(`kubectl get pods -n training -l job-name=training-unaware -o wide
kubectl get nodes -L workshop.example.com/leaf
kubectl describe job training-unaware -n training | sed -n '1,120p'`, {
  title: "Show where the trainer Pods actually landed",
  mode: "LIVE EVIDENCE · READ-ONLY",
  objective: "Trace the result from Job declaration to Pod-to-Node binding and then to physical leaf labels.",
  invokes: ["Three `kubectl` reads: trainer Pods, labeled Nodes, and the Job description/events."],
  actions: ["Shows each trainer's `NODE`.", "Maps those node names to leaf domains.", "Shows Job status and recent scheduling-related events."],
  changes: "None.",
  success: "Two Ready trainer Pods appear on nodes whose leaf columns differ; Job desired/current counts are two.",
  meaning: "Pod phase proves execution; Node plus leaf proves physical placement. Neither alone proves model throughput.",
  recovery: "If Pods are Pending, inspect the Events section and confirm the fillers and fake GPU allocatable state. Restore with `make checkpoint-1` if state is unclear."
});

markdown(`### Interpretation checkpoint

Answer before continuing:

1. Did Kubernetes violate any declared constraint? **No.**
2. Did it know these Pods were communication peers? **No.**
3. Would \`topologySpreadConstraints\` solve packing? Usually not; it primarily expresses spreading/skew.
4. Would plain \`nodeAffinity\` be enough? Only if the submitter already knew which currently available leaf could fit the entire group.

The failure is not an incorrect scheduler decision. It is an incomplete workload contract.`);

guidedBash(`make lab1-reset
make verify-lab1`, {
  title: "Delete the Lab 1 Pods and verify a clean baseline",
  mode: "REQUIRED LIVE RESET · MUTATING",
  objective: "Release all four fake GPUs and prove the infrastructure baseline survived Lab 1.",
  invokes: ["`scripts/reset-workloads.sh`, then `scripts/verify-lab1.sh`."],
  actions: ["Deletes workshop-labeled Jobs and filler Pods with server-side waiting.", "Polls until matching Pods are actually gone, then rechecks node count, topology labels, and allocatable fake GPUs."],
  changes: "Deletes only workshop workloads in namespace `training`; it preserves the cluster, labels, and capacity declaration.",
  success: "Reports `all four fake GPUs are available` and `CHECKPOINT 1 VERIFIED`.",
  meaning: "Deletion is asynchronous, so the explicit wait creates a trustworthy capacity boundary for Phase 2.",
  recovery: "Rerun the cell. If objects are stuck terminating, inspect them before forcing deletion; the safe broad recovery is `make checkpoint-1`."
});

markdown(`---
# Phase 2 — Represent topology in Kueue

> **Presentation mapping — Live slides 15–20:** explain admission versus placement, read the four-object contract, then install and verify it with Checkpoint 2.

Kueue is an admission controller in front of kube-scheduler:

\`\`\`text
Job → LocalQueue → ClusterQueue quota + ResourceFlavor
                                  │
                                  └→ Topology hierarchy
                                             ↓
                                Workload topologyAssignment
                                             ↓
                                  kube-scheduler binds Nodes
\`\`\`

Kueue chooses an admissible domain and reserves capacity for the PodSet. The Kubernetes scheduler still performs final Pod-to-node binding.`);

markdown(`## 7 — Restore Checkpoint 2

> **Presentation cue — Live slide 20:** run this after slides 15–19 have explained the Kueue object chain.

This installs pinned Kueue assets from the local cache, marks eligible nodes, applies all four Kueue objects, and waits for an Active ClusterQueue.`);
guidedBash(`make checkpoint-2`, {
  title: "Install Kueue and create the topology-aware queues",
  mode: "LIVE CHECKPOINT · MUTATING · ABOUT 2–5 MINUTES",
  objective: "Layer Kueue Topology Aware Scheduling (TAS) on the verified fake datacenter.",
  invokes: ["`scripts/checkpoint.sh 2`, which first runs all of Checkpoint 1.", "`scripts/install-kueue.sh`, `label-gpu-nodes.sh`, four manifests under `kueue-config/`, and `verify-lab2.sh`."],
  actions: ["Re-establishes clean topology/capacity state.", "Server-side applies the cached Kueue `v0.19.2` release and waits up to 300 seconds for its controller Deployment.", "Marks GPU workers flavor-eligible; applies Topology, ResourceFlavor, ClusterQueue, and LocalQueue; asserts links, hierarchy, controller availability, and `Active=True`."],
  changes: "Installs Kueue CRDs/controller into `kueue-system`, labels four worker Nodes, and creates queue/TAS API objects. It may update existing objects but does not duplicate them.",
  success: "Ends with `CHECKPOINT 2 VERIFIED — Kueue topology-aware admission ready` and `CHECKPOINT 2 — Kueue + TAS ready`.",
  meaning: "The admission plane can now reserve a complete PodSet in a topology domain. kube-scheduler remains responsible for final Node binding.",
  recovery: "Rerun `make checkpoint-2`. If the controller is unavailable, inspect `kubectl get pods -n kueue-system` and `kubectl describe deployment kueue-controller-manager -n kueue-system`. A missing cache requires `make prepare`."
});

markdown(`## 8 — Read the four-object contract from source

> **Presentation mapping — Live slides 16–20:** Topology is slide 17, ResourceFlavor is slide 18, ClusterQueue/LocalQueue are slide 19, and verification is slide 20.

| Object | Responsibility |
|---|---|
| \`Topology\` | Orders labels from coarse domain to hostname |
| \`ResourceFlavor\` | Selects eligible nodes and attaches the topology |
| \`ClusterQueue\` | Owns quota for the resource/flavor combination |
| \`LocalQueue\` | Namespace-scoped submission endpoint |

Read the versioned manifests first; then compare them with the live API state.`);
guidedBash(`for file in kueue-config/topology.yaml kueue-config/resource-flavor.yaml kueue-config/cluster-queue.yaml kueue-config/local-queue.yaml; do printf '\n===== %s =====\n' "$file"; sed -n '1,220p' "$file"; done`, {
  title: "Read the four Kueue configuration objects",
  mode: "LIVE CONFIGURATION WALKTHROUGH · READ-ONLY",
  simple: "These four files teach Kueue the location hierarchy, which Nodes may provide our GPU type, how much GPU quota exists, and which queue the `training` namespace uses. The cell displays them without changing the cluster.",
  objective: "Follow the four-object reference chain from topology vocabulary to the namespace submission endpoint.",
  invokes: ["A Bash loop that prints the four reviewed YAML files in dependency order."],
  actions: ["Shows `Topology.spec.levels` as block → leaf → hostname.", "Shows ResourceFlavor node eligibility and topology reference.", "Shows ClusterQueue nominal quota for the fake GPU resource/flavor.", "Shows namespace-scoped LocalQueue pointing to the ClusterQueue."],
  changes: "None; these files were applied by Checkpoint 2, but this cell only reads them.",
  success: "Four clearly separated manifests print in the order Topology, ResourceFlavor, ClusterQueue, LocalQueue.",
  meaning: "No single object is 'the topology scheduler.' Their references form the admission contract.",
  recovery: "If an API field is unfamiliar, compare the file with the live object in the next cells. If files are absent, rerun the directory guard."
});

guidedBash(`make verify-lab2
kubectl get topology,resourceflavor,clusterqueue
kubectl get localqueue -n training`, {
  title: "Confirm that Kueue and its queues are ready",
  mode: "LIVE EVIDENCE · READ-ONLY",
  objective: "Verify controller acceptance and show the cluster-scoped versus namespace-scoped Kueue objects.",
  invokes: ["`scripts/verify-lab2.sh` plus `kubectl get` for the four object kinds."],
  actions: ["Asserts controller availability, exact Topology level order, ResourceFlavor selector/link, ClusterQueue `Active=True`, and LocalQueue target.", "Lists the live resources after the assertions."],
  changes: "None.",
  success: "Ends with `CHECKPOINT 2 VERIFIED`; `gpu-training` is Active and `training/gpu-queue` targets it.",
  meaning: "Existence is weaker than readiness. The verifier checks semantic links and conditions, not only object names.",
  recovery: "Rerun `make checkpoint-2`. Use the following status-inspection cell to locate an inactive queue or rejected configuration."
});

guidedBash(`kubectl get clusterqueue gpu-training -o yaml | sed -n '/status:/,$p'
kubectl get localqueue gpu-queue -n training -o yaml | sed -n '/status:/,$p'`, {
  title: "Read what the Kueue controllers accepted",
  mode: "GUIDED STATUS INSPECTION · READ-ONLY",
  objective: "Learn to inspect reconciled status and reasons instead of assuming an accepted spec.",
  invokes: ["`kubectl get ... -o yaml` piped through `sed` from the `status:` key onward."],
  actions: ["Prints controller-populated conditions, admitted/reserved usage, flavors, and reason/message fields while omitting the already-reviewed specs."],
  changes: "None.",
  success: "ClusterQueue and LocalQueue conditions report `Active: True`; usage should be zero immediately after the clean checkpoint.",
  meaning: "Spec is requested state; status is the controller's observed result. Reason/message are the first diagnostic surface for inactive queues.",
  recovery: "If `Active=False`, read `reason` and `message`, verify referenced ResourceFlavor/ClusterQueue objects, then rerun `make checkpoint-2`."
});

markdown(`---
# Phase 3 — Require, break, and relax locality

> **Presentation mapping — Live slides 21–28:** require one leaf, prove an impossible request waits, allow preferred fallback, and restore a clean TAS-ready state.

This phase changes one policy dimension while retaining the same basic Job shape. The three outcomes are:

1. **Required + feasible:** admit inside one leaf.
2. **Required + impossible:** wait and create zero trainer Pods.
3. **Preferred + impossible at leaf:** widen to block and run across leaves.`);

markdown(`## 9 — Required topology: inspect the annotation

> **Presentation mapping — Live slides 22–24:** inspect the required annotation, run the feasible case, then compare Kueue's assignment with the scheduler's Node bindings.

The queue label puts the Job under Kueue. The PodTemplate annotation asks TAS to find one leaf that can fit the complete PodSet.`);
guidedBash(`grep -n -E 'queue-name|required-topology|parallelism|completions|workshop.example.com/gpu' jobs/training-topology-required.yaml`, {
  title: "Read the strict same-leaf request",
  mode: "LIVE MANIFEST FOCUS · READ-ONLY",
  simple: "This file defines a two-worker training Job that is allowed to start only when both workers fit under the same leaf switch. The command prints just the important lines rather than the entire YAML.",
  objective: "Reduce a full Job manifest to the five fields that establish queueing, group size, resource demand, and strict leaf locality.",
  invokes: ["`grep -n -E` against `jobs/training-topology-required.yaml`."],
  actions: ["Prints matching lines with source line numbers: queue label, required-topology annotation, parallelism/completions, and fake-GPU key."],
  changes: "None.",
  success: "The output shows queue `gpu-queue`, leaf-level required topology, two replicas, and one fake GPU per Pod.",
  meaning: "Kueue can calculate a two-GPU PodSet and must find one leaf with two available GPUs before admitting it.",
  recovery: "If expected lines are absent, inspect the whole YAML and run `make test`; do not execute a manifest whose contract is unclear."
});

guidedBash(`make lab3-required`, {
  title: "Start a feasible two-trainer same-leaf Job",
  mode: "LIVE LAB 3A · MUTATING",
  objective: "Prove that strict leaf locality admits when one leaf can fit the entire two-replica PodSet.",
  invokes: ["`scripts/reset-workloads.sh`.", "`kubectl apply -f jobs/training-topology-required.yaml`.", "`scripts/verify-lab3.sh --expect admitted --job training-topology-aware --same-leaf`."],
  actions: ["Clears prior exercises, submits the Job, resolves its generated Workload by ownerReference, waits for `Admitted`, prints the topology assignment, waits for trainer readiness, and asserts one unique leaf."],
  changes: "Creates one Job, a Kueue Workload, and two trainer Pods; reserves two fake GPUs inside one selected leaf.",
  success: "Prints `Admitted=True`, a topology assignment, two node→leaf mappings with the same leaf, and `Lab 3 expectation satisfied`.",
  meaning: "Kueue admitted the group into a domain; kube-scheduler then bound individual Pods to eligible Nodes in that domain.",
  recovery: "Run `make checkpoint-2`, then retry. If Pending, inspect Workload conditions and confirm both fake GPUs in at least one leaf are free."
});

guidedBash(`kubectl get workloads -n training
kubectl get workloads -n training -o yaml | sed -n '/topologyAssignment/,+18p'
kubectl get pods -n training -l job-name=training-topology-aware -o wide
kubectl get nodes -L workshop.example.com/leaf`, {
  title: "Prove Kueue's assignment and the final Pod placement agree",
  mode: "LIVE TWO-LAYER PROOF · READ-ONLY",
  objective: "Correlate Kueue's admitted topology intent with kube-scheduler's actual Pod bindings.",
  invokes: ["`kubectl` reads for Workload summaries, `topologyAssignment`, trainer Pods, and Node leaf labels."],
  actions: ["Shows Workload admission state.", "Extracts persisted assignment domains/counts.", "Shows Pod node names and maps those Nodes to leaves."],
  changes: "None.",
  success: "The Workload is admitted; assigned domain/count cover two replicas; both Pods are Ready on one leaf.",
  meaning: "Admission intent and actual placement agree. If only one layer were checked, controller or scheduler drift could remain invisible.",
  recovery: "Use `kubectl describe workload -n training <name>` and `kubectl describe pod -n training <name>`, then restore with `make checkpoint-2`."
});

markdown(`**Expected evidence:**

- Workload condition \`Admitted=True\`;
- a persisted \`topologyAssignment\` at leaf level;
- both trainer Pods bound to nodes carrying the same leaf label.

This is domain-aware admission followed by ordinary scheduler binding. Kueue is not a second kube-scheduler.`);

markdown(`## 10 — Required topology: deliberately make it impossible

> **Presentation mapping — Live slide 25:** run this case immediately after explaining that neither two-GPU leaf can hold three replicas.

Each leaf contains only two fake GPUs. This Job requests three replicas and requires one leaf. The correct outcome is waiting—not silently violating locality and not starting a partial training group.`);
guidedBash(`grep -n -E 'required-topology|parallelism|completions|workshop.example.com/gpu' jobs/training-impossible.yaml
make lab3-impossible`, {
  title: "Submit a three-trainer Job that cannot fit in one leaf",
  mode: "LIVE LAB 3B · MUTATING · EXPECTED WAIT",
  simple: "The YAML asks for three fake GPUs in one leaf, but each leaf has only two. The first command shows that request; the second submits it and proves that no trainer Pod starts.",
  objective: "Prove that an infeasible strict topology contract fails closed before partial GPU allocation.",
  invokes: ["A focused manifest inspection, then `scripts/reset-workloads.sh`, `kubectl apply`, and `verify-lab3.sh --expect pending`."],
  actions: ["Confirms three one-GPU replicas require one leaf although each leaf owns only two GPUs.", "Submits the Job, waits for an explicit negative admission/quota condition, and asserts zero trainer Pods exist."],
  changes: "Replaces the prior exercise with a suspended Job and pending Kueue Workload. It should allocate zero fake GPUs.",
  success: "Prints `required topology held the impossible workload before GPU allocation`; no trainer Pod is created.",
  meaning: "Pending is the correct preservation of a required service contract, not necessarily a malfunction.",
  recovery: "If trainer Pods exist, stop and run `make checkpoint-2`; if the verifier times out, inspect Workload conditions and Kueue controller logs."
});

guidedBash(`kubectl get workloads -n training
kubectl get workloads -n training -o yaml | sed -n '/conditions:/,+22p'
kubectl get pods -n training -l job-name=training-impossible`, {
  title: "Prove that strict locality created zero trainer Pods",
  mode: "LIVE POLICY EVIDENCE · READ-ONLY",
  objective: "Distinguish policy-preserving Pending from a scheduler failure.",
  invokes: ["Workload summary and condition reads plus a Pod query for the impossible Job."],
  actions: ["Prints admission/quota condition reason and message.", "Queries trainer Pods using the Job label."],
  changes: "None.",
  success: "The Workload is not admitted/reserved and the final Pod query returns no rows.",
  meaning: "Kueue evaluated the complete PodSet and withheld admission; kube-scheduler never received partial trainer Pods to bind.",
  recovery: "If no Workload exists, verify the queue label and controller. If Pods exist, restore Checkpoint 2 before continuing."
});

markdown(`## 11 — Preferred topology: widen the admissible domain

> **Presentation mapping — Live slides 26–28:** explain the business promise, show the one-word manifest change, run preferred fallback, and finish with Checkpoint 3.

The preferred case requests the same three replicas. Only the annotation key changes. TAS attempts leaf locality first and may widen to the enclosing block.`);
guidedBash(`diff -u jobs/training-impossible.yaml jobs/training-topology-preferred.yaml || true`, {
  title: "Compare required locality with preferred locality",
  mode: "LIVE POLICY DIFF · READ-ONLY",
  simple: "This compares the waiting Job with the fallback Job so you can see that the important change is `required` becoming `preferred`.",
  objective: "Isolate the exact policy change from a hard locality promise to a soft preference.",
  invokes: ["Unified `diff`; `|| true` keeps Jupyter from treating expected differences as a failed cell."],
  actions: ["Compares the strict and preferred Job manifests line by line."],
  changes: "None.",
  success: "The meaningful change is the topology annotation from `required` to `preferred` (names/labels may also differ to keep experiments distinct).",
  meaning: "The resource demand remains impossible at leaf scope; only permission to widen changes.",
  recovery: "If resource counts differ, inspect both complete files before presenting—the comparison would no longer isolate policy."
});

guidedBash(`make lab3-preferred
kubectl get workloads -n training -o yaml | sed -n '/topologyAssignment/,+18p'
kubectl get pods -n training -l job-name=training-preferred -o wide
kubectl get nodes -L workshop.example.com/leaf`, {
  title: "Allow the three-trainer Job to widen across both leaves",
  mode: "LIVE LAB 3C · MUTATING",
  objective: "Show preferred locality widening from an infeasible two-GPU leaf to the four-GPU enclosing block.",
  invokes: ["`make lab3-preferred` followed by Workload, Pod, and Node evidence queries."],
  actions: ["Clears prior workloads, submits the three-replica preferred Job, waits for admission/readiness, and asserts trainers span at least two leaves.", "Prints the persisted topology assignment and actual bindings."],
  changes: "Creates a Job, Workload, and three trainer Pods consuming three of four fake GPUs across the block.",
  success: "The Workload is admitted, the assignment widens, and Ready Pods appear across at least two leaf labels.",
  meaning: "Preferred topology is a business trade-off: start with a wider domain when strict locality cannot be satisfied.",
  recovery: "Run `make checkpoint-2` and retry. If the Job waits unexpectedly, inspect free allocatable capacity and Workload condition messages."
});

markdown(`### Required versus preferred is a business contract

\`\`\`text
completion time = queue delay + execution time
\`\`\`

Suppose one leaf can fit the job in three minutes, while a cross-leaf placement can start now but trains 35% more slowly. The right choice depends on deadline, expected duration, fragmentation, priority, and cost—not on a universal “always pack” rule.

Use **required** when violating the boundary is unacceptable. Use **preferred** when the cost of waiting may exceed the performance penalty.`);

guidedBash(`make checkpoint-3`, {
  title: "Remove the exercises but keep Kueue ready",
  mode: "REQUIRED LIVE RESET · MUTATING",
  objective: "Keep Kueue/TAS installed while removing every exercise workload before the production-reference sections.",
  invokes: ["`scripts/checkpoint.sh 3`, which deliberately composes Checkpoints 1 and 2 before its final reset."],
  actions: ["Revalidates/reconciles cluster topology, fake GPU capacity, Kueue installation, eligibility labels, and all four Kueue objects.", "Deletes lab Jobs/Pods and waits for resource release."],
  changes: "May reapply known configuration and deletes only workshop workloads; the clean Kueue/TAS control plane remains.",
  success: "Outputs all three checkpoint banners, ending with `CHECKPOINT 3 — clean TAS-ready state restored`.",
  meaning: "This is the strongest recovery boundary: known infrastructure, known admission configuration, zero lab workload demand.",
  recovery: "Rerun it. If it fails before Checkpoint 2, diagnose the earlier named checkpoint rather than continuing."
});

markdown(`---
# Phase 4 — Do not collapse four different topology mechanisms

> **Presentation mapping — Live slides 29–31:** this is a guided explanation section. No additional live workload is required.

| Mechanism | Question it answers | Scope |
|---|---|---|
| Kueue TAS | Which domain can fit the whole PodSet? | Cluster admission |
| Gang scheduling | Can the required members start as a group? | Workload start semantics |
| Kueue Cohort | Which ClusterQueues may borrow quota? | Queue economics |
| Topology Manager | Can CPU, memory and devices align on this node? | kubelet / NUMA |

All-or-nothing start and locality often matter together, but they are not synonyms. A Cohort is quota sharing—not gang scheduling.`);

markdown(`## 12 — Why partial placement is dangerous

> **Presentation mapping — Live slides 29–30:** use the partial-start example to separate gang semantics, Kueue Workload admission, TAS, and Cohort quota sharing.

Synchronous training may show several Running Pods while doing no useful training because the missing ranks prevent rendezvous or collective progress. That is why the evidence must include:

- required membership and admitted PodSet size;
- topology assignment;
- actual Pod node/leaf labels;
- application progress, not only Pod phase.

Elastic training is different: starting at a smaller membership is safe only if the application explicitly supports the corresponding batch, optimizer, checkpoint, and rendezvous semantics.`);

markdown(`## 13 — Node-local NUMA alignment

> **Presentation mapping — Live slide 31:** this fragment is illustrative and is not applied to the kind cluster.

After cluster placement, kubelet Topology Manager coordinates device, CPU, and memory hints on each node. Common policies include \`none\`, \`best-effort\`, \`restricted\`, and \`single-numa-node\`.

\`\`\`yaml
# Illustrative kubelet fragment—not applied to the kind lab.
topologyManagerPolicy: single-numa-node
topologyManagerScope: pod
cpuManagerPolicy: static
\`\`\`

TAS cannot guarantee NUMA-local GPU/NIC placement. Topology Manager cannot choose a rack or leaf. A production platform needs both layers.`);

markdown(`---
# Phase 5 — Treat topology as production data

> **Presentation mapping — Live slides 32–33:** connect authoritative ownership to the sync controller's reconciliation and drift behavior.

The label pipeline is a reconciliation system, not a one-time script:

\`\`\`text
LLDP + fabric manager + DCIM + GPU/device inventory
                         ↓ normalize
              versioned topology contract
                         ↓ validate
              labels / device metadata / health
                         ↓ reconcile
             Kueue, policy, metrics, operations
\`\`\`

Every published fact needs an owner, provenance, freshness, conflict policy, and controlled mutation path.`);

markdown(`## 14 — Schema failure exercise

> **Presentation mapping — Live slides 32–33:** this optional exercise demonstrates why topology data is validated before publication.

This cell mutates an in-memory copy of the sample inventory. It does not change the repository. The expected error proves that malformed topology is rejected before labels reach Kubernetes.`);
guidedCode(`from copy import deepcopy
import json
from pathlib import Path
import jsonschema

root = Path(".")
schema = json.loads((root / "topology-pipeline/inventory.schema.json").read_text())
inventory = json.loads((root / "topology-pipeline/sample-inventory.json").read_text())

broken = deepcopy(inventory)
broken["nodes"][0]["leaf"] = "INVALID LEAF WITH SPACES"

try:
    jsonschema.Draft202012Validator(schema).validate(broken)
    raise AssertionError("broken inventory unexpectedly passed validation")
except jsonschema.ValidationError as error:
    print("EXPECTED REJECTION:", error.message)`, {
  title: "Break one inventory value and watch validation reject it",
  mode: "OPTIONAL EXERCISE · IN-MEMORY ONLY",
  objective: "Experience a failed data-contract validation without editing the source inventory or touching Kubernetes.",
  invokes: ["Python standard library plus the installed `jsonschema` package.", "The checked-in inventory and JSON Schema files."],
  actions: ["Loads valid source data, deep-copies it, replaces one leaf value with spaces/uppercase characters, and validates the broken copy against Draft 2020-12 JSON Schema.", "Treats rejection as the expected outcome."],
  changes: "Only a Python object in kernel memory. No file or Kubernetes object is modified.",
  success: "Prints `EXPECTED REJECTION:` followed by the label-pattern validation message.",
  meaning: "Malformed physical facts are rejected before publication. This schema check complements the renderer's semantic checks such as duplicates and provenance.",
  recovery: "If `jsonschema` is missing, install the repository's documented Python requirements before the event. If the broken record passes, stop: the schema contract has regressed."
});

markdown(`### Production reconciliation rules

1. Merge authoritative sources with explicit field ownership and precedence.
2. Validate completeness, label syntax, uniqueness, and graph consistency.
3. Publish only a coherent version; never guess through conflicting sources.
4. Report freshness, unmapped nodes, drift, and publish errors.
5. Cordon and drain before changing a running node’s physical-domain identity.
6. Retain last-known-good data only under an explicit staleness policy.

A scheduler can make a perfectly correct decision against incorrect labels. That silent failure mode is why the data contract matters as much as the algorithm.`);

markdown(`---
# Phase 6 — Validate topology intent before allocating GPUs

> **Presentation mapping — Live slide 34:** explain CEL for object-local rules and a webhook for external policy. The code exercises are optional if the room is on schedule.

Admission policy rejects malformed intent; it must not choose Nodes or replace Kueue.

- Use **CEL** for fast, object-local invariants.
- Use an external webhook only for richer organizational state or external entitlement.
- Keep slow or fragile DCIM calls off the Kubernetes write path when possible.`);

markdown(`## 15 — Inspect the CEL policy

> **Presentation cue — Live slide 34:** show the policy file only if time permits; the required hands-on path already ended at Checkpoint 3.

The policy is deliberately scoped to labeled namespaces and Jobs explicitly marked as distributed training. It requires a queue, exactly one required/preferred annotation, and an approved level.`);
guidedBash(`sed -n '1,260p' webhook/validating-admission-policy.yaml`, {
  title: "Read the API-entry rules for distributed training Jobs",
  mode: "OPTIONAL GUIDED INSPECTION · READ-ONLY",
  simple: "This file is an API-entry checklist. It rejects distributed-training Jobs that forget their Kueue queue, omit topology intent, or request an unapproved topology level.",
  objective: "Understand which topology-intent mistakes can be rejected locally with CEL before GPUs are considered.",
  invokes: ["`sed` against `webhook/validating-admission-policy.yaml`."],
  actions: ["Prints the ValidatingAdmissionPolicy match scope, CEL expressions/messages, and its binding.", "Exposes rules requiring a queue, exactly one topology mode, and an approved level for labeled distributed Jobs."],
  changes: "None; this cell only reads the manifest.",
  success: "You can identify scope, validation expressions, failure messages, and binding actions.",
  meaning: "CEL validates object-local intent at API admission. It does not discover fabric state, reserve Kueue quota, or choose Nodes.",
  recovery: "If the cluster rejects this API kind later, verify the Kubernetes version and feature support; the file inspection itself remains useful."
});

guidedBash(`make admission-policy
kubectl apply --dry-run=server -f jobs/training-unaware.yaml || true`, {
  title: "Install the CEL policy and test an invalid Job",
  mode: "OPTIONAL POLICY DEMO · MUTATES POLICY, NOT WORKLOAD",
  objective: "Install the scoped CEL guardrail and prove that malformed distributed-training intent is rejected before persistence.",
  invokes: ["`make admission-policy` applies the policy and binding.", "`kubectl apply --dry-run=server` sends the unaware Job through API admission; `|| true` preserves notebook flow because denial is expected."],
  actions: ["Creates or updates cluster-scoped admission policy objects.", "Exercises real API defaulting and validation without creating the Job."],
  changes: "The CEL policy/binding remain installed. The invalid Job is not stored because this is server-side dry-run.",
  success: "The policy applies, then the API returns a denial explaining the missing queue/topology contract.",
  meaning: "A rejected dry-run is the green result. The shell's zero exit is forced only so Jupyter does not mark the expected rejection as an execution failure.",
  recovery: "If the Job is accepted, inspect policy binding and namespace/workload labels. If the API kind is unsupported, skip this optional lab and retain the manifest as reference."
});

guidedBash(`kubectl apply --dry-run=server -f jobs/training-topology-required.yaml`, {
  title: "Confirm that a correctly declared Job passes admission",
  mode: "OPTIONAL POSITIVE POLICY TEST · READ-ONLY WORKLOAD DRY-RUN",
  objective: "Show that the guardrail is selective: it blocks malformed intent without blocking the valid required-topology Job.",
  invokes: ["`kubectl apply --dry-run=server` for the reviewed strict-locality Job."],
  actions: ["Sends the object through API schema, admission policy, defaulting, and validation, then discards it."],
  changes: "No Job is persisted; the previously installed admission policy remains.",
  success: "The API prints `job.batch/training-topology-aware configured (server dry run)` or equivalent, with no denial.",
  meaning: "Negative and positive tests together prove policy selectivity. A policy that rejects everything is not a useful guardrail.",
  recovery: "Read the admission message, compare the queue label and exactly-one topology annotation with the CEL expressions, then rerun."
});

markdown(`## 16 — Inspect and test the richer Go policy core

> **Presentation cue — optional extension to Live slide 34:** this corresponds to master slide 52 and is take-home reference material, not a required live demo.

The Go package demonstrates a rule that is easy to get wrong: whole-Job GPU footprint is \`GPU per Pod × parallelism\`. The package is policy logic only; a production webhook still needs AdmissionReview handling, TLS, authentication, HA, metrics, and rollout controls.`);
guidedBash(`sed -n '1,260p' webhook/topology_validator.go
if command -v go >/dev/null 2>&1; then go test ./webhook; else echo 'SKIP: Go is not installed; run this test on the instructor machine.'; fi`, {
  title: "Inspect and test the advanced Go policy example",
  mode: "TAKE-HOME DEPTH · READ-ONLY + OPTIONAL LOCAL TEST",
  simple: "This shows a more advanced policy example written in Go, then runs its tests when Go is available. It is reference logic, not a webhook server running in this lab.",
  objective: "Inspect richer policy logic and verify its unit tests without pretending this package is a deployed production webhook.",
  invokes: ["`sed` for the Go policy core; `go test ./webhook` only when Go is installed."],
  actions: ["Shows whole-Job GPU footprint calculation (`per-Pod GPU × parallelism`) and policy validation.", "Runs table-driven unit tests locally, or emits an explicit skip."],
  changes: "No Kubernetes state changes. Go may write compiler/module artifacts to its normal local caches.",
  success: "Source prints and tests report `ok .../webhook`, or the documented `SKIP` appears on an attendee machine without Go.",
  meaning: "The example isolates testable decision logic. AdmissionReview transport, TLS, authentication, high availability, telemetry, and safe rollout remain production responsibilities.",
  recovery: "A skip is acceptable for the 90-minute route. On the instructor machine, run `go test ./webhook -v` to diagnose failures."
});

markdown(`---
# Phase 7 — Prove placement quality with three evidence planes

> **Presentation mapping — Live slides 35–37:** join placement intent, hardware activity, and model progress, then explain the benchmark evidence contract.

| Evidence plane | Examples | What it proves |
|---|---|---|
| Control plane | Workload conditions, topologyAssignment, Pod node, Node labels | Intended and actual placement |
| Hardware/network | DCGM, NVLink/PCIe counters, NIC/fabric telemetry | Device and link activity |
| Application | step time, tokens/s, samples/s, loss, MFU | Useful model progress |

No single plane is sufficient. Stable job/run identifiers and synchronized timestamps are necessary for correlation.`);

markdown(`## 17 — Inspect the DCGM reference rules

> **Presentation mapping — Live slides 35–36:** these files support the observability explanation and are not applied to the fake cluster.

These rules are **not applied** to the fake cluster. They are take-home examples for a real GPU environment. DCGM reports activity; it does not directly report application MFU.`);
guidedBash(`sed -n '1,280p' observability/dcgm-prometheus-rules.yaml
sed -n '1,260p' observability/mfu-notes.md`, {
  title: "Read the real-GPU monitoring examples",
  mode: "TAKE-HOME REFERENCE · READ-ONLY · REAL GPU CLUSTER ONLY",
  simple: "These files show what you would monitor on real GPU hardware: one contains Prometheus rules for GPU activity, and the other explains how useful model work is calculated. They are not installed in the laptop lab.",
  objective: "Connect placement evidence to hardware activity and useful model progress without fabricating metrics in the fake lab.",
  invokes: ["`sed` against example Prometheus rules and the MFU calculation notes."],
  actions: ["Prints DCGM-derived alert/recording-rule examples.", "Prints the inputs, assumptions, and limitations of application-derived Model FLOP Utilization."],
  changes: "None; the rules are deliberately not applied to kind because it has no NVIDIA devices or DCGM exporter.",
  success: "You can separate SM/NVLink activity metrics from throughput/MFU and identify stable labels needed to correlate a run with placement.",
  meaning: "DCGM says what hardware is doing; application metrics say whether useful training progresses. Neither alone proves placement quality.",
  recovery: "No live recovery is needed. If adapting to production, validate metric names against your DCGM exporter version before applying any rule."
});

markdown(`### MFU interpretation

\`\`\`text
MFU = achieved useful model FLOPs per second
      ──────────────────────────────────────
      precision-matched theoretical peak FLOPs per second
\`\`\`

Use framework-derived throughput and a model-specific FLOP estimate for the numerator. Match precision and dense/sparse assumptions in the denominator. High SM activity alone can coexist with poor useful progress when ranks wait on communication.`);

markdown(`## 18 — Benchmark evidence, not benchmark theatre

> **Presentation mapping — Live slide 37:** inspect the evidence template; do not present the analytical scenario as measured H100 data.

A defensible comparison holds constant the model, framework, precision, batch, GPU count, software stack, warm-up, sample count, and fabric health. Vary the placement domain and collect at least:

- NCCL algorithm and bus bandwidth;
- step time and tokens/s;
- application-derived MFU;
- topology assignment and actual node/leaf identity;
- queue delay and run duration.`);
guidedBash(`sed -n '1,260p' benchmarks/benchmark-template.md
sed -n '1,80p' benchmarks/results-template.csv`, {
  title: "Read the benchmark procedure and results template",
  mode: "TAKE-HOME BENCHMARK DESIGN · READ-ONLY",
  simple: "The Markdown file is a checklist for running a fair benchmark. The CSV is the empty form where measured results should be recorded.",
  objective: "Review the evidence contract required before claiming a topology-related performance improvement.",
  invokes: ["`sed` against the benchmark protocol and empty measured-results template."],
  actions: ["Shows controlled variables, repetitions, warm-up, placement identity, NCCL/application metrics, and required provenance.", "Shows the CSV columns accepted by the summarizer."],
  changes: "None.",
  success: "The protocol distinguishes measured evidence from analytical teaching data and the CSV has fields for placement, speed, MFU, and source.",
  meaning: "A screenshot of faster Pods is not a benchmark. Comparable runs must hold workload, hardware, and software constant and preserve source metadata.",
  recovery: "If collecting real data, copy the template rather than overwriting it, mark `source=measured`, and retain raw logs alongside the summary."
});

guidedBash(`python3 benchmarks/summarize_results.py benchmarks/scenario-model.csv --allow-analytical`, {
  title: "Calculate the analytical placement comparison",
  mode: "LIVE/REFERENCE CALCULATION · READ-ONLY ANALYTICAL DATA",
  objective: "Demonstrate how placement comparisons are normalized while keeping scenario values clearly separated from measurements.",
  invokes: ["`benchmarks/summarize_results.py` with `scenario-model.csv` and the explicit `--allow-analytical` acknowledgement."],
  actions: ["Validates required columns and positive numeric values.", "Uses the first row as baseline, then calculates relative efficiency, throughput degradation, GPU-hour multiplier, and displays MFU."],
  changes: "None; it reads a CSV and prints a table.",
  success: "A placement comparison table prints with efficiency, degradation, GPU-hour multiplier, and MFU columns.",
  meaning: "These are arithmetic demonstrations, not H100 measurements. Remove the flag and the script intentionally refuses non-measured input.",
  recovery: "If validation fails, fix the named CSV field. Never relabel scenario rows as measured merely to bypass the evidence guard."
});

markdown(`**Interpretation:** the 40–60% degradation range in the session premise is workload-, hardware-, collective-, and topology-dependent. The fake lab cannot validate it. Replace the results template with measured \`nccl-tests\` and training data before making a production claim.`);

markdown(`---
# Phase 8 — Validate, recover, and take the architecture home

> **Presentation mapping — Live slides 38–39:** use the architecture to connect all owners, finish with the five rules, and leave the cluster at Checkpoint 3.

## Failure map

| Failure | Symptom | First response |
|---|---|---|
| Missing host dependency | Preflight failure | Fix before the workshop |
| Missing labels or allocatable GPU | Checkpoint 1 verification fails | \`make checkpoint-1\` |
| Leaked pause Pods | Later Pods remain Pending | \`make lab1-reset\` |
| Kueue controller/config drift | ClusterQueue inactive | \`make checkpoint-2\` |
| Stale Lab 3 workloads | Unexpected quota/topology state | \`make checkpoint-3\` |
| Wrong Kubernetes context | Safety check fails | Switch explicitly to \`kind-topology-lab\` |

The scripts refuse mutations outside the named lab context.`);

markdown(`## 19 — Final offline validation

> **Presentation cue — after Live slide 39:** this is a take-home validation step, not a command to run while the audience is waiting.`);
guidedBash(`make test`, {
  title: "Run the final offline repository checks",
  mode: "TAKE-HOME FINAL CHECK · OFFLINE · READ-ONLY",
  objective: "Confirm that exploration did not leave edited workshop assets in an invalid or inconsistent state.",
  invokes: ["The same static shell/YAML/schema/notebook checks and Python unit tests explained in the pre-event section."],
  actions: ["Revalidates repository artifacts; it does not inspect the live cluster."],
  changes: "None.",
  success: "Static validation and all unit tests pass.",
  meaning: "The checked-in teaching materials remain coherent. Use `make checkpoint-3` separately to validate or recover live cluster state.",
  recovery: "Return to the first reported failing file or test. Generated notebooks must be rebuilt from `scripts/build-notebook.js`, not hand-edited."
});

markdown(`<details>
<summary><strong>Optional instructor integration test</strong></summary>

\`make smoke\` creates and deletes only the kind cluster named \`topology-lab\`, then executes every live lab. Run it before the event on the instructor machine—not during the participant session.

\`\`\`bash
make smoke
\`\`\`
</details>`);

markdown(`## Production-readiness checklist

- [ ] Every topology label has an authoritative owner and freshness SLO.
- [ ] Domain definitions match the actual network failure/performance boundaries.
- [ ] Required and preferred policies are tied to workload classes and deadlines.
- [ ] Admission rejects missing, conflicting, or unauthorized topology intent.
- [ ] Queue quota and physical domain capacity are monitored independently.
- [ ] Node-local CPU, memory, GPU, and NIC alignment is configured and verified.
- [ ] Workload status, Pod placement, fabric telemetry, and application metrics can be correlated.
- [ ] Benchmark claims carry configuration, placement identity, repetitions, and source.
- [ ] Recovery paths are idempotent, bounded, and rehearsed.

> **Placement quality is a resource.**`);

markdown(`## Cleanup

> **Presentation cue — after Live slide 39:** run this only when participants no longer need the reference cluster.

This removes only the kind cluster named \`topology-lab\`. Cached manifests and images remain available for recovery or another workshop run.`);
guidedBash(`make clean`, {
  title: "Delete the workshop cluster when you are finished",
  mode: "OPTIONAL FINAL CLEANUP · DESTRUCTIVE BUT NARROWLY SCOPED",
  objective: "Release the Docker containers and storage owned by the workshop cluster after participants no longer need it.",
  invokes: ["`Makefile` → `scripts/cleanup.sh` → `kind delete cluster --name topology-lab`."],
  actions: ["Deletes only the named kind cluster and its node containers/network."],
  changes: "Removes Kubernetes state inside `topology-lab`. It preserves `.workshop-cache/` and Docker images for faster recreation.",
  success: "Ends with `cluster removed; preflight cache preserved for recovery`; `kind get clusters` no longer lists `topology-lab`.",
  meaning: "The live lab is gone, but `make checkpoint-1` can recreate it offline from cached inputs.",
  recovery: "Deletion cannot restore in-cluster objects. Recreate the known lab state with `make checkpoint-1` or `make checkpoint-2` for Kueue/TAS.",
  caution: "Do not run this before the final demonstrations. The script is intentionally hard-coded to the workshop cluster name."
});

markdown(`## Take-home references in this repository

- \`README.md\` — authoritative live path and recovery contract
- \`nvlink-workshop-tutorial.md\` — full curriculum and technical narrative
- \`topology-pipeline/\` — schema, sample inventory, and production data-contract guidance
- \`webhook/\` — CEL policy and unit-tested Go policy core
- \`observability/\` — DCGM and MFU guidance for real GPU clusters
- \`benchmarks/\` — measured-results template and analytical example
- \`tests/\` — offline validation and destructive named-cluster smoke test

The notebook teaches the path; the repository preserves the complete implementation.`);

const notebook = {
  cells,
  metadata: {
    kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
    language_info: { name: "python", version: "3" },
  },
  nbformat: 4,
  nbformat_minor: 5,
};

const serialized = `${JSON.stringify(notebook, null, 1)}\n`;

// A public clone is self-contained: its canonical notebook lives beside the
// Makefile. Preserve synchronization with an older instructor-bundle copy only
// when that file already exists; never create a file outside the workshop root.
const notebookTargets = [path.join(root, "workshop-walkthrough.ipynb")];
const legacyNotebook = path.join(tutorialRoot, "workshop-walkthrough (1).ipynb");
if (fs.existsSync(legacyNotebook)) notebookTargets.push(legacyNotebook);

for (const target of notebookTargets) {
  fs.writeFileSync(target, serialized);
  console.log(`wrote ${target}`);
}
