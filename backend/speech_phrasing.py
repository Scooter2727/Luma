"""Optional Gemini rephrasing of deterministic route instructions. Never adds facts; any doubt keeps the original."""
import json
import re
import httpx
from . import config

# Called in the background after routes load, never during a walk. A 20-step route takes about 6 s.
TIMEOUT_SECONDS = 10
ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
# Tests replace this with an httpx.MockTransport.
TRANSPORT = None

SYSTEM_PROMPT = """You rewrite pedestrian navigation instructions for a blind or low-vision walker so they sound natural when spoken aloud.
Rules, all mandatory:
- Rephrase only. Keep every fact in the input instruction and add none.
- Never introduce a street name, place name, distance, number, direction, landmark, signal, tactile paving or crossing claim that is not already in that step's instruction.
- Keep every number exactly as digits, and keep left, right, straight and clock directions exactly as given.
- Keep every caution and uncertainty, such as "unknown", "not mapped", "confirm", "check" or "approximately".
- Keep each rewrite about as long as the original, never longer than one and a half times its length.
- Return a JSON array of strings with exactly one rewrite per input step, in the same order."""

DIRECTION_WORDS = {'left', 'right', 'straight', 'slight', 'slightly', 'sharp', 'sharply', 'ahead', 'back', 'around', "o'clock", 'north', 'south', 'east', 'west'}
CLAIM_WORDS = {'audible', 'tactile', 'signal', 'signals', 'locator', 'button', 'beep', 'beeps', 'tone', 'paving', 'crosswalk', 'crossing', 'cross', 'bus', 'stop', 'board', 'transfer'}
CAUTION_WORDS = {'unknown', 'not', 'unmapped', 'confirm', 'check', 'approximately', 'about', 'listed', 'scheduled', 'estimated', 'locate', 'may'}


def _words(text):
    return set(re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower()))


def _numbers(text):
    return sorted(re.findall(r'\d+(?:\.\d+)?', text))


def acceptable(original, candidate, step):
    """True only if a rewrite keeps the original's facts, directions and cautions and adds nothing."""
    if not isinstance(candidate, str) or not candidate.strip():
        return False
    candidate = candidate.strip()
    if len(candidate) > 1.5 * len(original) or len(candidate) < 0.4 * len(original):
        return False
    street = (step.get('street') or '').strip().lower()
    if street and street in original.lower() and street not in candidate.lower():
        return False
    if _numbers(candidate) != _numbers(original):
        return False
    before, after = _words(original), _words(candidate)
    if (after & DIRECTION_WORDS) != (before & DIRECTION_WORDS):
        return False
    if (after & CLAIM_WORDS) - before:
        return False
    if (before & CAUTION_WORDS) - after:
        return False
    return True


def _request_body(steps):
    items = [
        {k: step.get(k) for k in ('text', 'street', 'distance', 'crossing', 'audible', 'tactile') if step.get(k) not in (None, '')}
        for step in steps
    ]
    return {
        'systemInstruction': {'parts': [{'text': SYSTEM_PROMPT}]},
        'contents': [{'role': 'user', 'parts': [{'text': 'Rewrite each step\'s "text". Steps:\n' + json.dumps(items, ensure_ascii=False)}]}],
        'generationConfig': {
            'temperature': 0.2,
            'maxOutputTokens': min(8192, 256 + 96 * len(steps)),
            'responseMimeType': 'application/json',
            'responseSchema': {'type': 'ARRAY', 'items': {'type': 'STRING'}},
            'thinkingConfig': {'thinkingBudget': 0},
        },
    }


async def rephrase_steps(steps: list[dict]) -> list[str]:
    """One Gemini call for the whole route. Returns the original text for any step that fails a check."""
    originals = [str(step.get('text') or '') for step in steps]
    key = config.gemini_api_key()
    if not key or not steps:
        return originals
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=TRANSPORT) as client:
            response = await client.post(
                ENDPOINT.format(model=config.gemini_model()),
                headers={'x-goog-api-key': key, 'Content-Type': 'application/json'},
                json=_request_body(steps),
            )
        response.raise_for_status()
        text = response.json()['candidates'][0]['content']['parts'][0]['text']
        candidates = json.loads(text)
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return originals
    if not isinstance(candidates, list) or len(candidates) != len(steps):
        return originals
    return [
        candidate.strip() if acceptable(original, candidate, step) else original
        for original, candidate, step in zip(originals, candidates, steps)
    ]
