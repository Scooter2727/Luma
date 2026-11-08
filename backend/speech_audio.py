"""Optional ElevenLabs speech synthesis with a disposable on-disk MP3 cache."""
import hashlib
from threading import Lock
from uuid import uuid4
import httpx
from . import config
from .runtime import cache_directory

TIMEOUT_SECONDS = 3
ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech/{voice}'
# Tests replace this with an httpx.MockTransport.
TRANSPORT = None
_cache_lock = Lock()


def cache_path(text, voice_id, model_id):
    digest = hashlib.sha256('\0'.join((text, voice_id, model_id)).encode('utf-8')).hexdigest()
    return cache_directory() / 'speech-cache' / (digest + '.mp3')


def _read(path):
    with _cache_lock:
        try:
            return path.read_bytes() or None
        except OSError:
            return None


def _write(path, audio):
    with _cache_lock:
        # Write under a temporary name so a partial file never becomes a cache hit.
        temp = path.with_name(uuid4().hex + '.building')
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp.write_bytes(audio)
            temp.replace(path)
        except OSError:
            temp.unlink(missing_ok=True)


async def synthesize(text: str) -> bytes | None:
    """MP3 bytes for text, from the cache or ElevenLabs. None whenever speech is unavailable."""
    key = config.elevenlabs_api_key()
    text = text.strip()
    if not key or not text:
        return None
    voice_id, model_id = config.elevenlabs_voice_id(), config.elevenlabs_model_id()
    path = cache_path(text, voice_id, model_id)
    cached = _read(path)
    if cached:
        return cached
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=TRANSPORT) as client:
            response = await client.post(
                ENDPOINT.format(voice=voice_id),
                params={'output_format': 'mp3_44100_128'},
                headers={'xi-api-key': key, 'Accept': 'audio/mpeg'},
                json={'text': text, 'model_id': model_id},
            )
        response.raise_for_status()
    except httpx.HTTPError:
        return None
    audio = response.content
    if not audio or not response.headers.get('content-type', '').startswith('audio/'):
        return None
    _write(path, audio)
    return audio
