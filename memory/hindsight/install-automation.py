#!/usr/bin/python3
"""Print a scoped deployment plan; --enable explicitly installs that plan."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--project-root', required=True)
parser.add_argument('--bank', required=True)
parser.add_argument('--enable', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
project = Path(args.project_root).resolve(strict=True)
state = Path.home() / '.local/share/paseo-hindsight/automation'
destination = state.parent / 'automation-plugin'
plan = {
    'plugin': 'hindsight-project-memory', 'projectRoot': str(project), 'includesSubdirectories': True,
    'bank': args.bank, 'capture': 'future user messages and final assistant replies; no historical backfill',
    'processing': 'local Hindsight database; extraction/consolidation via existing Trae CLI model backend',
    'startupRecall': 'new sessions, at most 3500 characters plus fixed framing',
    'checkpoint': 'local bounded recent-turn checkpoint; no automatic executor switch',
    'stateDirectory': str(state), 'corePatch': False, 'daemonRestart': False,
}
print(json.dumps(plan, ensure_ascii=False, indent=2), flush=True)
if not args.enable:
    raise SystemExit(0)
state.mkdir(parents=True, exist_ok=True)
state.chmod(0o700)
config = state / 'config.json'
if config.exists():
    existing = json.loads(config.read_text())
    expected = {'projects': [{'root': str(project), 'bank': args.bank}]}
    if existing != expected:
        raise SystemExit('Existing project scope differs; review it before changing capture scope.')
else:
    config.write_text(json.dumps({'projects': [{'root': str(project), 'bank': args.bank}]}, ensure_ascii=False, indent=2))
    config.chmod(0o600)
destination.mkdir(exist_ok=True)
for name in ['index.server.ts', 'server/core.mjs', 'paseo-plugin.json']:
    (destination / name).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / 'memory/hindsight/automation-plugin' / name, destination / name)
subprocess.run([shutil.which('paseo') or 'paseo', 'plugin', 'install', str(destination), '--json'], check=True)
