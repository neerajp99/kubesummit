#!/usr/bin/env bash
# Fast, offline quality gate used before shipping workshop materials.
# It performs syntax/schema validation only and never creates a Kubernetes
# cluster. The destructive integration path is isolated in smoke-test.sh.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

# Validate every shell entry point, including scripts normally reached through
# Make targets, so a typo cannot remain hidden until the live session.
find cluster-setup scripts tests -name '*.sh' -print0 | while IFS= read -r -d '' file; do
  bash -n "$file"
done
make -n help >/dev/null
make -n notebook >/dev/null
make -n lab1-demo >/dev/null
make -n checkpoint-2 >/dev/null

# One process validates all structured artifacts to keep the offline gate fast.
python3 - <<'PY'
import json
import subprocess
from pathlib import Path
import yaml
import jsonschema
import nbformat

root = Path('.')
for path in sorted(root.rglob('*.yaml')):
    docs = list(yaml.safe_load_all(path.read_text()))
    assert docs, f'{path}: no YAML documents'
    for doc in docs:
        assert isinstance(doc, dict), f'{path}: empty/non-object YAML document'
        is_kubernetes = bool(doc.get('apiVersion') and doc.get('kind'))
        is_prometheus_rules = isinstance(doc.get('groups'), list)
        assert is_kubernetes or is_prometheus_rules, f'{path}: unknown YAML document shape'

schema = json.loads((root / 'topology-pipeline/inventory.schema.json').read_text())
inventory = json.loads((root / 'topology-pipeline/sample-inventory.json').read_text())
jsonschema.Draft202012Validator(schema).validate(inventory)

# The cloned workshop is self-contained and requires only the notebook beside
# its Makefile. Older instructor bundles carried a second parent-level copy;
# compare it when present, but never require that private layout from attendees.
notebook_paths = [root / 'workshop-walkthrough.ipynb']
legacy_notebook = root.resolve().parent / 'workshop-walkthrough (1).ipynb'
if legacy_notebook.exists():
    assert notebook_paths[0].read_bytes() == legacy_notebook.read_bytes(), 'generated notebook copies differ'
    notebook_paths.append(legacy_notebook)

for path in notebook_paths:
    notebook = nbformat.read(str(path), as_version=4)
    nbformat.validate(notebook)
    assert len(notebook.cells) >= 80, f'{path}: workbook unexpectedly lost tutorial depth'
    all_text = '\n'.join(cell.source for cell in notebook.cells)
    for required_topic in ('AllReduce', 'topologyAssignment', 'Gang scheduling', 'Topology Manager', 'DCGM', 'MFU', 'Production-readiness checklist'):
        assert required_topic in all_text, f'{path}: missing required topic {required_topic}'
    for cell in notebook.cells:
        if cell.cell_type == 'code' and cell.source.startswith('%%bash\n'):
            result = subprocess.run(['bash', '-n'], input=cell.source.split('\n', 1)[1], text=True, capture_output=True)
            assert result.returncode == 0, f'{path}: invalid Bash cell: {result.stderr}'
            if 'go-template=' in cell.source:
                assert '{{"\\n"}}' in cell.source, f'{path}: Go-template newline was expanded while generating the notebook'

print('Static validation passed: shell, Make targets, YAML, topology schema, notebooks')
PY
