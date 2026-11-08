"""Local-only endpoints for entering AI voice keys from Settings.

Keys are written to the gitignored .env file and are never returned to the browser, only a masked hint.
Deployed (Vercel) instances and requests from other machines get 404; there, keys are Environment Variables.
"""
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from . import config
from .runtime import is_vercel

router = APIRouter(prefix='/api/speech/keys')
TIMEOUT_SECONDS = 8
# Tests replace this with an httpx.MockTransport.
TRANSPORT = None
LOOPBACK = {'127.0.0.1', '::1', 'localhost', 'testclient'}


def require_local(request: Request):
    if is_vercel() or (request.client and request.client.host) not in LOOPBACK:
        raise HTTPException(404, 'Not Found')


def hint(value):
    return '…' + value[-4:] if len(value) > 8 else 'saved'


def summary():
    gemini, eleven = config.gemini_api_key(), config.elevenlabs_api_key()
    return {
        'available': config.speech_configured(),
        'gemini': {'saved': bool(gemini), 'hint': hint(gemini) if gemini else ''},
        'elevenlabs': {'saved': bool(eleven), 'hint': hint(eleven) if eleven else ''},
        'voice_id': config.elevenlabs_voice_id(),
        'default_voice_id': config.DEFAULT_ELEVENLABS_VOICE_ID,
    }


class KeysUpdate(BaseModel):
    """Blank or missing fields keep the saved value."""
    gemini_api_key: str = Field('', max_length=300)
    elevenlabs_api_key: str = Field('', max_length=300)
    elevenlabs_voice_id: str = Field('', max_length=100)
    clear: list[str] = Field(default_factory=list, max_length=3)

    @field_validator('gemini_api_key', 'elevenlabs_api_key', 'elevenlabs_voice_id')
    @classmethod
    def single_line(cls, value):
        value = value.strip().strip('"').strip("'")
        if any(c.isspace() for c in value):
            raise ValueError('Keys cannot contain spaces or line breaks.')
        return value


@router.get('')
def get_keys(request: Request):
    require_local(request)
    return summary()


@router.put('')
def save_keys(req: KeysUpdate, request: Request):
    require_local(request)
    values = {'GEMINI_API_KEY': req.gemini_api_key, 'ELEVENLABS_API_KEY': req.elevenlabs_api_key,
              'ELEVENLABS_VOICE_ID': req.elevenlabs_voice_id}
    changes = {k: v for k, v in values.items() if v}
    changes.update({k: '' for k in req.clear if k in config.EDITABLE_KEYS})
    if changes:
        config.save_local_env(changes)
    return summary()


def _message(response, fallback):
    try:
        detail = response.json()
    except ValueError:
        return fallback
    if isinstance(detail, dict):
        detail = detail.get('detail') or detail.get('error') or detail
    if isinstance(detail, dict):
        return detail.get('message') or fallback
    return str(detail) if detail else fallback


async def check_gemini(client):
    key = config.gemini_api_key()
    if not key:
        return {'ok': False, 'message': 'No Gemini key saved.'}
    try:
        r = await client.get(f'https://generativelanguage.googleapis.com/v1beta/models/{config.gemini_model()}',
                             headers={'x-goog-api-key': key})
    except httpx.HTTPError:
        return {'ok': False, 'message': 'Could not reach Google Gemini.'}
    if r.status_code == 200:
        return {'ok': True, 'message': f'Gemini key works with {config.gemini_model()}.'}
    return {'ok': False, 'message': _message(r, f'Gemini rejected the key (HTTP {r.status_code}).')}


async def check_elevenlabs(client):
    key = config.elevenlabs_api_key()
    if not key:
        return {'ok': False, 'message': 'No ElevenLabs key saved.'}
    try:
        r = await client.post(f'https://api.elevenlabs.io/v1/text-to-speech/{config.elevenlabs_voice_id()}',
                              params={'output_format': 'mp3_22050_32'},
                              headers={'xi-api-key': key, 'Accept': 'audio/mpeg'},
                              json={'text': 'OK', 'model_id': config.elevenlabs_model_id()})
    except httpx.HTTPError:
        return {'ok': False, 'message': 'Could not reach ElevenLabs.'}
    if r.status_code == 200:
        return {'ok': True, 'message': 'ElevenLabs key and voice work.'}
    message = _message(r, f'ElevenLabs rejected the request (HTTP {r.status_code}).')
    if not key.startswith('sk_') and 'sk_' not in message:
        message += ' ElevenLabs API keys start with sk_; the key ID will not work.'
    return {'ok': False, 'message': message}


@router.post('/check')
async def check_keys(request: Request):
    """Make one tiny request to each service with the saved keys."""
    require_local(request)
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=TRANSPORT) as client:
        return {'gemini': await check_gemini(client), 'elevenlabs': await check_elevenlabs(client)}
