"""Optional ElevenLabs speech synthesis with a disposable on-disk MP3 cache."""
import hashlib
from collections.abc import AsyncIterator
from threading import Lock
from uuid import uuid4
import httpx
from . import config
from .runtime import cache_directory

# Applies to connecting and to each read, so a long stream is not cut off while audio keeps arriving.
TIMEOUT_SECONDS = 3
ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech/{voice}'
# 64 kbps keeps speech clear while halving the bytes to download before playback starts.
OUTPUT_FORMAT = 'mp3_44100_64'
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


async def synthesize_stream(text: str) -> AsyncIterator[bytes] | None:
    """MP3 chunks for text as ElevenLabs produces them, or None if speech is unavailable.

    The status is checked before returning, so callers can still answer 503. Audio is cached only once the
    whole stream has arrived."""
    key = config.elevenlabs_api_key()
    text = text.strip()
    if not key or not text:
        return None
    voice_id, model_id = config.elevenlabs_voice_id(), config.elevenlabs_model_id()
    path = cache_path(text, voice_id, model_id)
    cached = _read(path)
    if cached:
        async def from_cache():
            yield cached
        return from_cache()
    client = httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=TRANSPORT)
    try:
        response = await client.send(client.build_request(
            'POST',
            ENDPOINT.format(voice=voice_id) + '/stream',
            params={'output_format': OUTPUT_FORMAT},
            headers={'xi-api-key': key, 'Accept': 'audio/mpeg'},
            json={'text': text, 'model_id': model_id},
        ), stream=True)
    except httpx.HTTPError:
        await client.aclose()
        return None
    if response.status_code != 200 or not response.headers.get('content-type', '').startswith('audio/'):
        await response.aclose()
        await client.aclose()
        return None

    async def relay():
        chunks = []
        try:
            async for chunk in response.aiter_bytes():
                chunks.append(chunk)
                yield chunk
        except httpx.HTTPError:
            return
        finally:
            await response.aclose()
            await client.aclose()
        if chunks:
            _write(path, b''.join(chunks))
    return relay()


async def synthesize(text: str) -> bytes | None:
    """Complete MP3 bytes for text, from the cache or ElevenLabs. None whenever speech is unavailable."""
    stream = await synthesize_stream(text)
    if stream is None:
        return None
    audio = b''.join([chunk async for chunk in stream])
    return audio or None
