import asyncio
import json
import httpx
import pytest
from backend import speech_phrasing

STEPS = [
    dict(text='Continue along Bay Street for 120 metres.', street='Bay Street', distance=120, crossing=False),
    dict(text='Cross Queen Street West at Bay Street. Audible signal information is unknown; check the signal before crossing.', street='Queen Street West', distance=20, crossing=True, audible=None),
    dict(text='Arrive near Nathan Phillips Square. Confirm the entrance and final approach.', distance=0, crossing=False),
]


def gemini_reply(payload, status=200):
    body = {'candidates': [{'content': {'parts': [{'text': payload if isinstance(payload, str) else json.dumps(payload)}]}}]}
    return httpx.Response(status, json=body)


@pytest.fixture
def gemini(monkeypatch):
    calls = []

    def install(handler):
        def recorded(request):
            calls.append(request)
            return handler(request)
        monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
        monkeypatch.setattr(speech_phrasing, 'TRANSPORT', httpx.MockTransport(recorded))
        return calls
    return install


def run(steps=STEPS):
    return asyncio.run(speech_phrasing.rephrase_steps(steps))


def test_happy_path_uses_one_call_and_keeps_safe_rewrites(gemini):
    rewrites = [
        'Keep going along Bay Street for 120 metres.',
        'Cross Queen Street West at Bay Street. Audible signal information is unknown, so check the signal before crossing.',
        'Arrive near Nathan Phillips Square, then confirm the entrance and final approach.',
    ]
    calls = gemini(lambda request: gemini_reply(rewrites))
    assert run() == rewrites
    assert len(calls) == 1
    request = calls[0]
    assert request.headers['x-goog-api-key'] == 'test-key'
    assert 'gemini-3.8-flash:generateContent' in str(request.url)
    body = json.loads(request.content)
    assert body['generationConfig']['temperature'] == 0.2
    assert 'Never introduce a street name' in body['systemInstruction']['parts'][0]['text']


def test_malformed_json_returns_every_original(gemini):
    gemini(lambda request: gemini_reply('not json ['))
    assert run() == [s['text'] for s in STEPS]


def test_wrong_length_array_returns_every_original(gemini):
    gemini(lambda request: gemini_reply(['Only one rewrite.']))
    assert run() == [s['text'] for s in STEPS]


def test_api_error_and_timeout_return_every_original(gemini):
    gemini(lambda request: httpx.Response(500, json={'error': 'boom'}))
    assert run() == [s['text'] for s in STEPS]

    def timeout(request):
        raise httpx.ReadTimeout('slow', request=request)
    gemini(timeout)
    assert run() == [s['text'] for s in STEPS]


def test_dropped_street_name_falls_back_for_that_step_only(gemini):
    gemini(lambda request: gemini_reply([
        'Keep walking straight for 120 metres.',
        'Cross Queen Street West at Bay Street. Audible signal information is unknown, so check the signal before crossing.',
        'Arrive near Nathan Phillips Square, then confirm the entrance and final approach.',
    ]))
    result = run()
    assert result[0] == STEPS[0]['text']
    assert result[1].endswith('so check the signal before crossing.')


@pytest.mark.parametrize('rewrite', [
    'Continue along Bay Street for 150 metres.',
    'Turn left and continue along Bay Street for 120 metres.',
    'Continue along Bay Street for 120 metres to the audible signal.',
    'Continue along Bay Street for 120 metres. ' * 3,
])
def test_invented_facts_and_long_rewrites_fall_back(gemini, rewrite):
    gemini(lambda request: gemini_reply([rewrite, STEPS[1]['text'], STEPS[2]['text']]))
    assert run()[0] == STEPS[0]['text']


def test_dropped_uncertainty_falls_back(gemini):
    gemini(lambda request: gemini_reply([
        STEPS[0]['text'],
        'Cross Queen Street West at Bay Street with the audible signal; check before crossing.',
        STEPS[2]['text'],
    ]))
    assert run()[1] == STEPS[1]['text']


def test_missing_key_makes_no_network_call(monkeypatch):
    def fail(request):
        raise AssertionError('network must not be used without a key')
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    monkeypatch.setattr(speech_phrasing, 'TRANSPORT', httpx.MockTransport(fail))
    assert run() == [s['text'] for s in STEPS]


def test_rewrites_cannot_change_an_intercardinal_heading():
    step = dict(text='Head northeast along King St. Continue 40 metres.', street='King St', distance=40)
    assert not speech_phrasing.acceptable(step['text'], 'Go east along King St for 40 metres.', step)
    assert speech_phrasing.acceptable(step['text'], 'Walk northeast on King St for 40 metres.', step)
