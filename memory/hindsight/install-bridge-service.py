#!/usr/bin/python3
"""Register the local Trae inference adapter as a user launch agent."""
from pathlib import Path
import os
import plistlib
import signal
import shutil
import subprocess

root = Path(__file__).resolve().parents[2]
state = Path.home() / '.local/share/paseo-hindsight'
state.mkdir(parents=True, exist_ok=True)
state.chmod(0o700)
shutil.copy2(root / 'memory/hindsight/trae-bridge.py', state / 'trae-bridge.py')
if not (state / 'bridge-config.json').exists():
    raise SystemExit('Run memory/hindsight/configure.py first')
label = 'local.paseo.hindsight-trae'
plist = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
plist.parent.mkdir(parents=True, exist_ok=True)
if plist.exists():
    subprocess.run(['launchctl', 'bootout', 'gui/%d/%s' % (os.getuid(), label)], capture_output=True)
probe = subprocess.run(['/usr/sbin/lsof', '-tiTCP:18889', '-sTCP:LISTEN'], text=True, capture_output=True)
for pid in probe.stdout.split():
    command = subprocess.check_output(['/bin/ps', '-p', pid, '-o', 'command='], text=True)
    if 'hindsight/trae-bridge.py' not in command and 'paseo-hindsight/trae-bridge.py' not in command:
        raise RuntimeError('Port 18889 is occupied by an unrelated process')
    os.kill(int(pid), signal.SIGTERM)
config = {
    'Label': label,
    'ProgramArguments': ['/usr/bin/python3', str(state / 'trae-bridge.py')],
    'WorkingDirectory': str(state),
    'RunAtLoad': True,
    'KeepAlive': True,
    'ThrottleInterval': 10,
    'EnvironmentVariables': {
        'PATH': str(Path.home() / '.local/bin') + ':/opt/homebrew/bin:/usr/bin:/bin',
        'HINDSIGHT_LOCAL_CONFIG': str(state / 'bridge-config.json'),
    },
    'StandardOutPath': str(state / 'bridge.stdout.log'),
    'StandardErrorPath': str(state / 'bridge.stderr.log'),
}
plist.write_bytes(plistlib.dumps(config))
subprocess.run(['launchctl', 'bootstrap', 'gui/%d' % os.getuid(), str(plist)], check=True)
print('Installed', label)
