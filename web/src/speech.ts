export type AiSpeechOutcome = "played" | "failed" | "stopped";

const TIMEOUT_MS = 2500;
const FAILURE_LIMIT = 2;
const CACHE_LIMIT = 24;

let status: boolean | null = null;
let statusRequest: Promise<boolean> | null = null;
let failures = 0;
let generation = 0;
let element: HTMLAudioElement | null = null;
let objectUrl = "";
let inflight: AbortController | null = null;
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
async function download(text: string, signal?: AbortSignal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const abort = () => timeout.abort();
  signal?.addEventListener("abort", abort);
  try {
    const r = await fetch("/api/speech/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: timeout.signal,
    });
    if (!r.ok || !r.headers.get("content-type")?.startsWith("audio/"))
      return null;
    const blob = await r.blob();
    if (!blob.size) return null;
    remember(text, blob);
    return blob;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
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
/** Stop AI audio immediately. Any pending playAiSpeech call resolves "stopped". */
export function stopAiSpeech() {
  generation++;
  inflight?.abort();
  inflight = null;
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
export async function playAiSpeech(
  text: string,
  rate: number,
): Promise<AiSpeechOutcome> {
  stopAiSpeech();
  const id = generation;
  if (!(await loadSpeechStatus()) || !aiSpeechAvailable()) return "failed";
  if (id !== generation) return "stopped";
  let blob = blobs.get(text) || null;
  if (!blob) {
    const controller = new AbortController();
    inflight = controller;
    blob = await (pending.get(text) ?? download(text, controller.signal));
    if (id !== generation) return "stopped";
    inflight = null;
  }
  if (!blob) {
    recordFailure();
    return "failed";
  }
  const audio = audioElement();
  release();
  objectUrl = URL.createObjectURL(blob);
  return new Promise<AiSpeechOutcome>((resolve) => {
    finish = (outcome) => {
      finish = null;
      audio.onended = audio.onerror = audio.onplaying = null;
      if (outcome === "failed") recordFailure();
      release();
      resolve(outcome);
    };
    audio.onplaying = recordSuccess;
    audio.onended = () => finish?.("played");
    audio.onerror = () => finish?.("failed");
    audio.src = objectUrl;
    audio.playbackRate = rate;
    audio.play().catch(() => {
      if (id === generation) finish?.("failed");
    });
  });
}