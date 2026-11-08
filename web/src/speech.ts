export type AiSpeechOutcome = "played" | "failed" | "stopped";

// Fall back to the device voice if AI speech has not started by then.
const START_TIMEOUT_MS = 1500;
// Prefetches run in the background, so they can wait for slower syntheses.
const PREFETCH_TIMEOUT_MS = 10000;
const FAILURE_LIMIT = 2;
const CACHE_LIMIT = 24;

let status: boolean | null = null;
let statusRequest: Promise<boolean> | null = null;
let failures = 0;
let generation = 0;
let element: HTMLAudioElement | null = null;
let objectUrl = "";
let unlocked = false;
let silence = "";
let finish: ((outcome: AiSpeechOutcome) => void) | null = null;
const blobs = new Map<string, Blob>();
const pending = new Map<string, Promise<Blob | null>>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}
export function onAiSpeechChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function loadSpeechStatus(): Promise<boolean> {
  if (status !== null) return Promise.resolve(status);
  statusRequest ??= fetch("/api/speech/status")
    .then((r) => (r.ok ? r.json() : { available: false }))
    .then((d: { available?: boolean }) => d.available === true)
    .catch(() => false)
    .then((available) => {
      status = available;
      notify();
      return available;
    });
  return statusRequest;
}
/** False until the server confirms AI voice, and for the rest of the session after repeated failures. */
export function aiSpeechAvailable() {
  return status === true && failures < FAILURE_LIMIT;
}
/** Ask the server again, for example after keys were saved, and clear past failures. */
export function refreshSpeechStatus(): Promise<boolean> {
  status = null;
  statusRequest = null;
  failures = 0;
  blobs.clear();
  return loadSpeechStatus();
}
/** Clear the failure count, for example when the user explicitly tests AI voice again. */
export function resetAiSpeechSession() {
  failures = 0;
  notify();
}
function recordFailure() {
  failures++;
  if (failures === FAILURE_LIMIT) notify();
}
function recordSuccess() {
  if (failures) {
    failures = 0;
    notify();
  }
}
function remember(text: string, blob: Blob) {
  blobs.delete(text);
  blobs.set(text, blob);
  while (blobs.size > CACHE_LIMIT) blobs.delete(blobs.keys().next().value!);
}
const synthesisUrl = (text: string) =>
  "/api/speech/synthesize?text=" + encodeURIComponent(text);
async function download(text: string) {
  try {
    const r = await fetch(synthesisUrl(text), {
      signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS),
    });
    if (!r.ok || !r.headers.get("content-type")?.startsWith("audio/"))
      return null;
    const blob = await r.blob();
    if (!blob.size) return null;
    remember(text, blob);
    return blob;
  } catch {
    return null;
  }
}
function audioElement() {
  element ??= new Audio();
  return element;
}
function release() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = "";
}
function silentClip() {
  if (silence) return silence;
  const samples = 800,
    view = new DataView(new ArrayBuffer(44 + samples));
  const ascii = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128);
  silence = URL.createObjectURL(new Blob([view], { type: "audio/wav" }));
  return silence;
}
/**
 * iOS Safari only lets an audio element play outside a tap once it has been played from a tap.
 * Call this from tap handlers; it is a no-op once unlocked or outside a user gesture.
 */
export function unlockAiAudio() {
  const activation = (
    navigator as Navigator & { userActivation?: { isActive: boolean } }
  ).userActivation;
  if (unlocked || finish || activation?.isActive === false) return;
  unlocked = true;
  const audio = audioElement();
  audio.src = silentClip();
  audio.play().catch((e: DOMException) => {
    // Interrupting the silent clip with real speech still leaves the element unlocked.
    if (e.name === "NotAllowedError") unlocked = false;
  });
}
/** Stop AI audio immediately. Any pending playAiSpeech call resolves "stopped". */
export function stopAiSpeech() {
  generation++;
  const done = finish;
  finish = null;
  if (element) {
    element.onended = element.onerror = element.onplaying = null;
    element.pause();
    element.removeAttribute("src");
  }
  release();
  done?.("stopped");
}
export function cancelAllSpeech() {
  stopAiSpeech();
  globalThis.speechSynthesis?.cancel();
}
/** Download audio for text that is likely to be spoken next, so it can start instantly. */
export function prefetchAiSpeech(text: string) {
  if (status === false || blobs.has(text) || pending.has(text)) return;
  const request = loadSpeechStatus()
    .then(() => (aiSpeechAvailable() ? download(text) : null))
    .finally(() => pending.delete(text));
  pending.set(text, request);
}
/** Wait briefly for an in-flight prefetch rather than synthesizing the same text twice. */
function awaitPrefetch(text: string) {
  const request = pending.get(text);
  if (!request) return Promise.resolve(blobs.get(text) ?? null);
  return Promise.race([
    request,
    new Promise<null>((r) => setTimeout(() => r(null), START_TIMEOUT_MS)),
  ]);
}
/**
 * Play downloaded audio instantly, or stream it so speech starts with the first bytes.
 * Resolves "failed" if speech has not started within START_TIMEOUT_MS.
 */
export async function playAiSpeech(
  text: string,
  rate: number,
): Promise<AiSpeechOutcome> {
  stopAiSpeech();
  const id = generation;
  if (!(await loadSpeechStatus()) || !aiSpeechAvailable()) return "failed";
  const waited = pending.has(text);
  const blob = await awaitPrefetch(text);
  if (id !== generation) return "stopped";
  if (waited && !blob) {
    recordFailure();
    return "failed";
  }
  const audio = audioElement();
  if (blob) remember(text, blob);
  release();
  if (blob) objectUrl = URL.createObjectURL(blob);
  return new Promise<AiSpeechOutcome>((resolve) => {
    const timer = setTimeout(() => finish?.("failed"), START_TIMEOUT_MS);
    finish = (outcome) => {
      clearTimeout(timer);
      finish = null;
      audio.onended = audio.onerror = audio.onplaying = null;
      if (outcome === "failed") {
        recordFailure();
        audio.pause();
        audio.removeAttribute("src");
      }
      release();
      resolve(outcome);
    };
    audio.onplaying = () => {
      clearTimeout(timer);
      recordSuccess();
    };
    audio.onended = () => finish?.("played");
    audio.onerror = () => finish?.("failed");
    audio.src = objectUrl || synthesisUrl(text);
    audio.defaultPlaybackRate = audio.playbackRate = rate;
    audio.play().catch(() => {
      if (id === generation) finish?.("failed");
    });
  });
}
