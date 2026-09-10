# Benchmark template — fill in with your own cluster's numbers

The table in the curriculum ships with illustrative placeholders. If you
have access to a real GPU cluster before the conference, replace them with
real `nccl-tests` output — it turns this from "a plausible story" into "a
citable result," and it's worth the extra prep time.

## Placement comparison table (fill in the X's)

| Placement | Step time | Tokens/s | MFU | Relative efficiency |
|---|---:|---:|---:|---:|
| Same leaf | X | X | X | 100% (baseline) |
| Same rack, different leaf | X | X | X | X% |
| Cross-rack | X | X | X | X% |

## Collecting the numbers with nccl-tests

```bash
# Build (once, on a machine with the CUDA toolkit + MPI + NCCL installed):
git clone https://github.com/NVIDIA/nccl-tests.git
cd nccl-tests
make MPI=1 MPI_HOME=/usr/lib/x86_64-linux-gnu/openmpi

# Run an AllReduce sweep. Adjust -g (GPUs per process) and the mpirun
# topology to match the placement you're testing.
./build/all_reduce_perf -b 8M -e 8G -f 2 -g 8
```

Collect, for each placement configuration below, at minimum: algorithm
bandwidth, bus bandwidth, and message size at the sizes your real training
job actually uses (don't just read the peak — read the size range your
model's gradient buckets fall into).

**Suggested benchmark dimensions** (mirrors the curriculum's placement
comparisons):

```text
8 GPU,  same node
16 GPU, 2 nodes, same leaf
32 GPU, 4 nodes, same leaf
32 GPU, 4 nodes, cross leaf
```

## Why this matters more than it looks

The "40–60% degradation" headline number in the abstract needs to survive
a question like "where did that number come from" from someone in the
room who runs a real GPU fleet. Pre-recorded real data from your own
cluster answers that question better than a live demo would — a live demo
that fails mid-workshop answers it worse than either.
