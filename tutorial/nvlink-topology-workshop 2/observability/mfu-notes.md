# MFU — reference notes

**MFU is application-derived. DCGM does not hand it to you directly.** This
is the correction that matters most in the observability section — say it
plainly, then show the formula.

```
MFU = achieved useful model FLOPs/sec  ÷  theoretical peak FLOPs/sec
```

## Getting the denominator right

Peak FLOPS is precision-specific. Using the wrong one silently produces a
wrong (usually inflated) MFU. Verified, precision-matched peaks for
**H100 SXM5**:

| Precision | Dense | With structured 2:4 sparsity |
|---|---:|---:|
| FP8  | 1,979 TFLOPS | 3,958 TFLOPS |
| FP16 / BF16 | ~989 TFLOPS | 1,979 TFLOPS |

Budget against the **dense** figure for realistic planning — production
models rarely hit the sparsity number, which assumes the hardware can skip
zero weights in a perfect 2-of-every-4-elements pattern.

## Getting the numerator right

Achieved FLOPs/sec comes from your training framework's own throughput
counters (tokens/sec or samples/sec) combined with a model-specific
FLOPs-per-token estimate. Don't oversimplify this on stage — activation
recomputation, attention-variant details, and architecture specifics all
change the true FLOP count per forward+backward pass. If your framework
(Megatron-LM, torchtitan, etc.) already emits a FLOPs/sec or MFU metric,
use that directly rather than re-deriving it.

## What DCGM actually gives you, and how to use it

DCGM gives hardware **activity ratios**, not application-level progress:

- `DCGM_FI_PROF_SM_ACTIVE` — ratio of cycles an SM has ≥1 warp assigned
- `DCGM_FI_PROF_PIPE_TENSOR_ACTIVE` — ratio of cycles the tensor pipe is active
- `DCGM_FI_PROF_DRAM_ACTIVE` — ratio of cycles the memory interface is active
- `DCGM_FI_PROF_NVLINK_TX_BYTES` / `_RX_BYTES` — NVLink traffic
- `DCGM_FI_PROF_PCIE_TX_BYTES` / `_RX_BYTES` — PCIe traffic

A rough, teachable correlation (see `dcgm-prometheus-rules.yaml`,
`gpu_estimated_tensor_tflops`):

```
estimated achieved TFLOPs ≈ DCGM_FI_PROF_PIPE_TENSOR_ACTIVE × precision-matched peak TFLOPS
```

Use this as a **live correlation signal** — "does hardware activity move
the way MFU says it should" — never as a replacement for computing real
MFU from measured throughput.

## The teaching point, restated

```
DCGM  →  hardware activity
MFU   →  useful model progress
```

You want both. A GPU can show 90%+ SM activity while doing almost no
useful work if it's warp-spinning on a communication barrier — that's
exactly the "Run A vs. Run B" table from the physics section of the talk,
and it's why `DCGM_FI_PROF_SM_ACTIVE` alone (let alone the even coarser
`DCGM_FI_DEV_GPU_UTIL`) is not sufficient to prove effective GPU use.
