import asyncio
import json
import httpx
import pytest
from backend import speech_audio

AUDIO = b'ID3fake-mpeg-audio'

async def chunks(*parts):
    for part in parts:
        yield part



@pytest.fixture
def eleven(monkeypatch, tmp_path):
    monkeypatch.setenv('LUMA_CACHE_DIR', str(tmp_path))
    calls = []

    def install(handler, key='test-key'):
        def recorded(request):
            calls.append(request)
            return handler(request)
        if key:
            monkeypatch.setenv('ELEVENLABS_API_KEY', key)
        monkeypatch.setattr(speech_audio, 'TRANSPORT', httpx.MockTransport(recorded))
        return calls
    return install


def ok(request):
    return httpx.Response(200, content=AUDIO, headers={'content-type': 'audio/mpeg'})


def run(text='Cross Queen Street West.'):
    return asyncio.run(speech_audio.synthesize(text))


def test_cache_miss_calls_elevenlabs_and_writes_the_file(eleven, tmp_path):
    calls = eleven(ok)
    assert run() == AUDIO
    assert len(calls) == 1
    request = calls[0]
    assert request.headers['xi-api-key'] == 'test-key'
    assert request.url.path.endswith('/stream') and request.url.params['output_format'] == 'mp3_44100_64'
    assert json.loads(request.content) == {'text': 'Cross Queen Street West.', 'model_id': 'eleven_flash_v2_5'}
    files = list((tmp_path / 'speech-cache').glob('*.mp3'))
    assert len(files) == 1 and files[0].read_bytes() == AUDIO
    assert not list((tmp_path / 'speech-cache').glob('*.building'))


def test_cache_hit_skips_the_network(eleven):
    calls = eleven(ok)
    run()
    assert run() == AUDIO
    assert len(calls) == 1


def test_cache_key_includes_voice_and_model(eleven, monkeypatch):
    calls = eleven(ok)
    run()
    monkeypatch.setenv('ELEVENLABS_VOICE_ID', 'another-voice')
    run()
    assert len(calls) == 2


@pytest.mark.parametrize('handler', [
    lambda request: httpx.Response(401, json={'detail': 'invalid key'}),
    lambda request: httpx.Response(200, json={'detail': 'not audio'}),
])
def test_api_failure_returns_none_and_caches_nothing(eleven, tmp_path, handler):
    eleven(handler)
    assert run() is None
    assert not list(tmp_path.glob('speech-cache/*.mp3'))


def test_timeout_returns_none(eleven):
    def slow(request):
        raise httpx.ReadTimeout('slow', request=request)
    eleven(slow)
    assert run() is None


def test_missing_key_makes_no_network_call(eleven, monkeypatch):
    def fail(request):
        raise AssertionError('network must not be used without a key')
    eleven(fail, key=None)
    monkeypatch.delenv('ELEVENLABS_API_KEY', raising=False)
    assert run() is None


def test_stream_yields_chunks_and_caches_only_complete_audio(eleven, tmp_path):
    eleven(lambda request: httpx.Response(200, content=chunks(b'ID3', b'part-two'), headers={'content-type': 'audio/mpeg'}))

    async def collect():
        stream = await speech_audio.synthesize_stream('Streaming.')
        return [chunk async for chunk in stream]
    assert b''.join(asyncio.run(collect())) == b'ID3part-two'
    assert [f.read_bytes() for f in (tmp_path / 'speech-cache').glob('*.mp3')] == [b'ID3part-two']


def test_abandoned_stream_is_not_cached(eleven, tmp_path):
    eleven(lambda request: httpx.Response(200, content=chunks(b'ID3', b'rest'), headers={'content-type': 'audio/mpeg'}))

    async def first_chunk_only():
        stream = await speech_audio.synthesize_stream('Interrupted.')
        chunk = await stream.__anext__()
        await stream.aclose()
        return chunk
    assert asyncio.run(first_chunk_only()) == b'ID3'
    assert not list(tmp_path.glob('speech-cache/*.mp3'))
