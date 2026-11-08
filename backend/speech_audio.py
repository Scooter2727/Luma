"""Optional ElevenLabs speech synthesis with a disposable on-disk MP3 cache."""
import hashlib
from collections.abc import AsyncIterator
from threading import Lock
from uuid import uuid4
import httpx
from . import config
from .runtime import cache_directory

# Applies to connecting and to each read, so a long stream is not cut off while audio keeps arriving.
TIMEOUT_SECONDS = httpx.Timeout(15, connect=5)
ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech/{voice}'
# 64 kbps keeps speech clear while halving the bytes to download before playback starts.
OUTPUT_FORMAT = 'mp3_44100_64'
# Tests replace this with an httpx.MockTransport.
TRANSPORT = None
_cache_lock = Lock()
_last_error = None


def last_error():
    return _last_error


def failure(code):
    global _last_error
    messages = {
        'credentials': 'ElevenLabs rejected its API key or permissions.',
        'quota': 'ElevenLabs speech credits or request limits have been reached.',
        'voice': 'The configured ElevenLabs voice or model is unavailable.',
        'timeout': 'ElevenLabs took too long to respond. Try again.',
        'network': 'ElevenLabs could not be reached. Try again.',
        'unavailable': 'ElevenLabs could not generate speech. Try again.',
        'stream': 'ElevenLabs audio was interrupted. Try again.',
    }
    _last_error = dict(code=code, message=messages[code])


def success():
    global _last_error
    _last_error = None


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
        success()
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
    except httpx.HTTPError as exc:
        failure('timeout' if isinstance(exc, httpx.TimeoutException) else 'network')
        await client.aclose()
        return None
    if response.status_code != 200 or not response.headers.get('content-type', '').startswith('audio/'):
        provider_code = ''
        try:
            import json
            body = json.loads(await response.aread())
            detail = body.get('detail')
            if isinstance(detail, dict):provider_code = detail.get('status', '')
        except (httpx.HTTPError, ValueError, AttributeError):
            pass
        failure('quota' if provider_code in ('quota_exceeded','insufficient_credits','payment_issue','too_many_concurrent_requests') or response.status_code == 429
                else 'credentials' if response.status_code in (401,403)
                else 'voice' if response.status_code in (400,404,422)
                else 'unavailable')
        await response.aclose()
        await client.aclose()
        return None

    async def relay():
        chunks = []
        try:
            async for chunk in response.aiter_bytes():
                if chunk:success()
                chunks.append(chunk)
                yield chunk
        except httpx.HTTPError:
            failure('stream')
            # A failed transfer must not look like a completed, cacheable MP3.
            raise
        finally:
            await response.aclose()
            await client.aclose()
        if any(chunks):
            _write(path, b''.join(chunks))
        else:
            failure('unavailable')
    return relay()


async def synthesize(text: str) -> bytes | None:
    """Complete MP3 bytes for text, from the cache or ElevenLabs. None whenever speech is unavailable."""
    stream = await synthesize_stream(text)
    if stream is None:
        return None
    audio = b''.join([chunk async for chunk in stream])
    return audio or None
