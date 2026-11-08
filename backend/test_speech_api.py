import httpx
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend import speech_audio

client = TestClient(app)


def configure(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'gemini-test')
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'eleven-test')


def test_status_reflects_configuration(monkeypatch):
    assert client.get('/api/speech/status').json() == {'available': False}
    monkeypatch.setenv('GEMINI_API_KEY', 'gemini-test')
    assert client.get('/api/speech/status').json() == {'available': False}
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'eleven-test')
    assert client.get('/api/speech/status').json() == {'available': True}


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
