#!/usr/bin/python3
"""Create private local configuration, without starting services or collection."""
import json
from pathlib import Path
import secrets
import shutil

state = Path.home() / '.local/share/paseo-hindsight'
state.mkdir(parents=True, exist_ok=True)
state.chmod(0o700)
config = state / 'bridge-config.json'
if not config.exists():
    cli = shutil.which('traecli')
    if not cli:
        raise SystemExit('Install and sign in to traecli first')
    config.write_text(json.dumps({'cli': cli, 'model': 'GPT-5.5', 'port': 18889, 'timeout': 180, 'key': secrets.token_urlsafe(32)}, indent=2))
    config.chmod(0o600)
settings = json.loads(config.read_text())
env = state / 'service.env'
if not env.exists():
    env.write_text('\n'.join([
        'HINDSIGHT_API_LLM_PROVIDER=openai',
        'HINDSIGHT_API_LLM_MODEL=' + settings['model'],
        'HINDSIGHT_API_LLM_BASE_URL=http://host.docker.internal:18889/v1',
        'HINDSIGHT_API_LLM_API_KEY=' + settings['key'],
        'HINDSIGHT_API_LLM_TIMEOUT=180',
        'HINDSIGHT_API_REFLECT_LLM_TIMEOUT=180',
        'HINDSIGHT_API_LLM_MAX_CONCURRENT=1',
        'HINDSIGHT_API_WORKER_ID=paseo-mac-local',
        'HINDSIGHT_API_MODEL_INIT_TIMEOUT=900',
        'HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
        'HINDSIGHT_API_RERANKER_PROVIDER=rrf',
        'HINDSIGHT_API_MCP_ENABLED_TOOLS=retain,sync_retain,recall,reflect',
        'HF_HUB_DISABLE_TELEMETRY=1',
    ]) + '\n')
    env.chmod(0o600)
print('Private configuration ready:', state)
