import pytest
from backend import config


@pytest.fixture(autouse=True)
def no_speech_keys(monkeypatch, tmp_path):
    """Tests never call Gemini or ElevenLabs or touch the developer's .env, even when it holds real keys."""
    monkeypatch.setenv('LUMA_EXTERNAL_DATA','0')
    for name in ('GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'GEMINI_MODEL', 'ELEVENLABS_MODEL_ID'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(config, 'ENV_PATH', tmp_path / '.env')
