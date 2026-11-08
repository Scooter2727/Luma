import pytest


@pytest.fixture(autouse=True)
def no_speech_keys(monkeypatch):
    """Tests never call Gemini or ElevenLabs, even when a developer's .env holds real keys."""
    for name in ('GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'GEMINI_MODEL', 'ELEVENLABS_MODEL_ID'):
        monkeypatch.delenv(name, raising=False)
