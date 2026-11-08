"""Server-side speech configuration. Keys are read from the environment and never sent to the browser."""
import hashlib
import os
from .runtime import ROOT, is_vercel

# gemini-2.5-flash is no longer offered to new API keys.
DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
# Flash is ElevenLabs' lowest-latency model; turbo is slower to start speaking.
DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5'
# ElevenLabs premade voice "George", available to every account.
DEFAULT_ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'


ENV_PATH = ROOT / '.env'
EDITABLE_KEYS = ('GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID')


def load_local_env(path=None):
    """Fill unset variables from a local .env file. Vercel injects its own Environment Variables."""
    path = path or ENV_PATH
    if is_vercel() or not path.is_file():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _get(name, default=''):
    return (os.environ.get(name) or '').strip() or default


def gemini_api_key():
    return _get('GEMINI_API_KEY')


def gemini_model():
    return _get('GEMINI_MODEL', DEFAULT_GEMINI_MODEL)


def elevenlabs_api_key():
    return _get('ELEVENLABS_API_KEY')


def elevenlabs_voice_id():
    return _get('ELEVENLABS_VOICE_ID', DEFAULT_ELEVENLABS_VOICE_ID)


def elevenlabs_model_id():
    return _get('ELEVENLABS_MODEL_ID', DEFAULT_ELEVENLABS_MODEL_ID)


def voice_version():
    """Changes with the voice or model, so browsers never replay audio cached for a previous voice."""
    return hashlib.sha256(f'{elevenlabs_voice_id()}\0{elevenlabs_model_id()}'.encode()).hexdigest()[:12]


def speech_configured():
    return bool(gemini_api_key() and elevenlabs_api_key())


def save_local_env(values):
    """Write keys into the local .env file, keeping its other lines, and apply them immediately."""
    values = {k: v for k, v in values.items() if k in EDITABLE_KEYS}
    lines = ENV_PATH.read_text(encoding='utf-8').splitlines() if ENV_PATH.is_file() else []
    remaining = dict(values)
    for i, line in enumerate(lines):
        name = line.split('=', 1)[0].strip()
        if '=' in line and not line.lstrip().startswith('#') and name in remaining:
            lines[i] = f'{name}={remaining.pop(name)}'
    lines += [f'{name}={value}' for name, value in remaining.items()]
    temporary = ENV_PATH.with_suffix('.building')
    temporary.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    temporary.replace(ENV_PATH)
    for name, value in values.items():
        if value:
            os.environ[name] = value
        else:
            os.environ.pop(name, None)


load_local_env()
