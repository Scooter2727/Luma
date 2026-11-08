"""Server-side speech configuration. Keys are read from the environment and never sent to the browser."""
import os
from .runtime import ROOT, is_vercel

# gemini-2.5-flash is no longer offered to new API keys.
DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
# Flash is ElevenLabs' lowest-latency model; turbo is slower to start speaking.
DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5'
# ElevenLabs premade voice "George", available to every account.
DEFAULT_ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'


def load_local_env(path=ROOT / '.env'):
    """Fill unset variables from a local .env file. Vercel injects its own Environment Variables."""
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


def speech_configured():
    return bool(gemini_api_key() and elevenlabs_api_key())


load_local_env()
