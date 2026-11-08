import httpx
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend import speech_audio

client = TestClient(app)

async def chunks(*parts):
    for part in parts:
        yield part



def configure(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'gemini-test')
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'eleven-test')


def test_status_reflects_configuration(monkeypatch):
    assert client.get('/api/speech/status').json()['available'] is False
    monkeypatch.setenv('GEMINI_API_KEY', 'gemini-test')
    assert client.get('/api/speech/status').json()['available'] is False
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'eleven-test')
    assert client.get('/api/speech/status').json()['available'] is True


def test_elevenlabs_works_without_a_gemini_key(monkeypatch, tmp_path):
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'eleven-test')
    monkeypatch.setenv('LUMA_CACHE_DIR', str(tmp_path))
    monkeypatch.setattr(speech_audio, 'TRANSPORT', httpx.MockTransport(
        lambda request: httpx.Response(200, content=b'ID3audio', headers={'content-type':'audio/mpeg'})))
    status=client.get('/api/speech/status')
    assert status.json()['available'] is True
    assert status.json()['rephrasing_available'] is False
    assert status.headers['cache-control']=='no-store'
    assert client.post('/api/speech/synthesize',json={'text':'Hello.'}).content==b'ID3audio'


def test_provider_error_is_reported_without_secrets(monkeypatch,tmp_path):
    configure(monkeypatch)
    monkeypatch.setenv('LUMA_CACHE_DIR',str(tmp_path))
    monkeypatch.setattr(speech_audio,'TRANSPORT',httpx.MockTransport(lambda r:httpx.Response(401,json={'detail':{'status':'invalid_api_key','message':'private provider response'}})))
    assert client.post('/api/speech/synthesize',json={'text':'Test.'}).status_code==503
    status=client.get('/api/speech/status').json()
    assert status['error']['code']=='credentials'
    assert 'eleven-test' not in str(status) and 'private provider response' not in str(status)


def test_status_voice_changes_with_the_voice(monkeypatch):
    first = client.get('/api/speech/status').json()['voice']
    monkeypatch.setenv('ELEVENLABS_VOICE_ID', 'another-voice')
    assert client.get('/api/speech/status').json()['voice'] not in ('', first)


def test_synthesize_is_unavailable_without_keys():
    response = client.post('/api/speech/synthesize', json={'text': 'Cross Queen Street West.'})
    assert response.status_code == 503
    assert 'device voice' in response.json()['detail']


def test_synthesize_reports_failure_as_unavailable(monkeypatch, tmp_path):
    configure(monkeypatch)
    monkeypatch.setenv('LUMA_CACHE_DIR', str(tmp_path))
    monkeypatch.setattr(speech_audio, 'TRANSPORT', httpx.MockTransport(lambda request: httpx.Response(500)))
    response = client.post('/api/speech/synthesize', json={'text': 'Cross Queen Street West.'})
    assert response.status_code == 503
    assert response.headers['content-type'].startswith('application/json')


def test_synthesize_returns_mpeg_audio(monkeypatch, tmp_path):
    configure(monkeypatch)
    monkeypatch.setenv('LUMA_CACHE_DIR', str(tmp_path))
    monkeypatch.setattr(speech_audio, 'TRANSPORT', httpx.MockTransport(
        lambda request: httpx.Response(200, content=b'ID3audio', headers={'content-type': 'audio/mpeg'})))
    response = client.post('/api/speech/synthesize', json={'text': 'Cross Queen Street West.'})
    assert response.status_code == 200
    assert response.headers['content-type'] == 'audio/mpeg'
    assert response.content == b'ID3audio'


@pytest.mark.parametrize('body', [{'text': ''}, {'text': '   '}, {'text': 'a' * 1001}, {}])
def test_synthesize_rejects_empty_or_oversized_text(monkeypatch, body):
    configure(monkeypatch)
    response = client.post('/api/speech/synthesize', json=body)
    assert response.status_code == 422
    assert response.json()['detail'].startswith('Invalid speech request.')


def test_get_streams_audio_for_the_audio_element(monkeypatch, tmp_path):
    configure(monkeypatch)
    monkeypatch.setenv('LUMA_CACHE_DIR', str(tmp_path))
    monkeypatch.setattr(speech_audio, 'TRANSPORT', httpx.MockTransport(
        lambda request: httpx.Response(200, content=chunks(b'ID3', b'audio'), headers={'content-type': 'audio/mpeg'})))
    response = client.get('/api/speech/synthesize', params={'text': 'Cross Queen Street West.'})
    assert response.status_code == 200
    assert response.headers['content-type'] == 'audio/mpeg'
    assert response.content == b'ID3audio'
    assert client.get('/api/speech/synthesize', params={'text': ' '}).status_code == 422
    assert client.get('/api/speech/synthesize', params={'text': 'a' * 1001}).status_code == 422


def test_get_is_unavailable_without_keys():
    assert client.get('/api/speech/synthesize', params={'text': 'Hello.'}).status_code == 503
