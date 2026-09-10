# Physical topology data contract

This reference pipeline makes the organizational part of topology-aware scheduling concrete. Infrastructure systems remain authoritative; Kubernetes receives normalized, reviewable labels.

| Data | Source of truth | Kubernetes consumer |
|---|---|---|
| Node → rack | DCIM / NetBox | Node label |
| Node → leaf/block | LLDP + fabric manager | Kueue `Topology` levels |
| NIC identity/speed | fabric manager | admission and diagnostics |
| GPU SKU/device health | GPU Operator / DRA driver | `ResourceFlavor` / `ResourceSlice` |
| NUMA locality | kubelet/device layer | Topology Manager |
| Placement policy | ML platform team | Kueue + admission policy |

Validate and render the sample contract:

```bash
python3 scripts/render-topology.py --check
python3 scripts/render-topology.py --format table
python3 scripts/render-topology.py --format commands
```

Production controllers should also provide freshness, provenance, monotonic revision numbers, and a safe rollout path. A stale mapping is more dangerous than a missing mapping because it creates confident, incorrect placement.
