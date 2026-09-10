# Admission boundary

Use the built-in CEL policy for static, local checks and a webhook only when a decision needs external state.

```text
ValidatingAdmissionPolicy → queue/topology fields, allowed values, mutual exclusion
Webhook                   → tenant policy, DCIM/fabric lookup, change windows
Kueue                     → capacity-aware topology assignment
kube-scheduler            → node binding
```

`topology_validator.go` is the pure policy core for the webhook path. It computes the whole Job footprint (`GPU per Pod × parallelism`), requires queue and fallback intent, validates allowed levels, and applies a stricter block-local rule to large jobs.

Run its unit tests with `go test ./webhook`.
