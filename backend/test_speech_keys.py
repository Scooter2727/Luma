import json
import httpx
from fastapi.testclient import TestClient
from backend.app import app
from backend import config, speech_keys

client = TestClient(app)


def test_keys_start_unsaved_and_are_never_echoed():
    body = client.get('/api/speech/keys').json()
    assert body['available'] is False
    assert body['gemini'] == {'saved': False, 'hint': ''}
    saved = client.put('/api/speech/keys', json={'gemini_api_key': 'AQ.gemini-secret-1234',
                                                 'elevenlabs_api_key': 'sk_eleven-secret-5678'}).json()
    assert saved['available'] is True
    assert saved['gemini'] == {'saved': True, 'hint': '…1234'}
    assert saved['elevenlabs'] == {'saved': True, 'hint': '…5678'}
    assert 'secret' not in json.dumps(saved)
    assert client.get('/api/speech/status').json() == {'available': True}


def test_saving_keeps_other_env_lines_and_blank_fields(monkeypatch):
    config.ENV_PATH.write_text('# comment\nGEMINI_MODEL=gemini-3.8-flash\nGEMINI_API_KEY=old\n', encoding='utf-8')
    monkeypatch.setenv('GEMINI_API_KEY', 'old')
    client.put('/api/speech/keys', json={'gemini_api_key': '', 'elevenlabs_api_key': ' "sk_new" '})
    text = config.ENV_PATH.read_text(encoding='utf-8')
    assert text == '# comment\nGEMINI_MODEL=gemini-3.8-flash\nGEMINI_API_KEY=old\nELEVENLABS_API_KEY=sk_new\n'
    assert config.elevenlabs_api_key() == 'sk_new'
    client.put('/api/speech/keys', json={'clear': ['GEMINI_API_KEY']})
    assert 'GEMINI_API_KEY=\n' in config.ENV_PATH.read_text(encoding='utf-8')
    assert config.gemini_api_key() == ''


def test_keys_with_spaces_are_rejected():
    response = client.put('/api/speech/keys', json={'gemini_api_key': 'two words'})
    assert response.status_code == 422
    assert not config.ENV_PATH.exists()


def test_keys_are_hidden_on_vercel_and_from_other_machines(monkeypatch):
    monkeypatch.setenv('VERCEL', '1')
    assert client.get('/api/speech/keys').status_code == 404
    assert client.put('/api/speech/keys', json={'gemini_api_key': 'x'}).status_code == 404
    monkeypatch.delenv('VERCEL')
    remote = TestClient(app, client=('192.168.1.20', 50000))
    assert remote.get('/api/speech/keys').status_code == 404
    assert not config.ENV_PATH.exists()


def test_check_reports_each_service(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'AQ.good')
    monkeypatch.setenv('ELEVENLABS_API_KEY', '16dba1ed43')
    def handler(request):
        if 'googleapis' in request.url.host:
            assert request.headers['x-goog-api-key'] == 'AQ.good'
            return httpx.Response(200, json={'name': 'models/gemini-3.8-flash'})
        return httpx.Response(401, json={'detail': {'message': 'API key ID used as API key.'}})
    monkeypatch.setattr(speech_keys, 'TRANSPORT', httpx.MockTransport(handler))
    body = client.post('/api/speech/keys/check').json()
    assert body['gemini'] == {'ok': True, 'message': 'Gemini key works with gemini-3.8-flash.'}
    assert body['elevenlabs']['ok'] is False
    assert body['elevenlabs']['message'].startswith('API key ID used as API key.')
    assert 'start with sk_' in body['elevenlabs']['message']


def test_check_without_keys_makes_no_requests(monkeypatch):
    monkeypatch.setattr(speech_keys, 'TRANSPORT', httpx.MockTransport(lambda r: (_ for _ in ()).throw(AssertionError)))
    body = client.post('/api/speech/keys/check').json()
    assert body == {'gemini': {'ok': False, 'message': 'No Gemini key saved.'},
                    'elevenlabs': {'ok': False, 'message': 'No ElevenLabs key saved.'}}
