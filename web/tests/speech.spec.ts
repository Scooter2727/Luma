import { test, expect, type Page } from "@playwright/test";

type SpeechModule = typeof import("../src/speech");
declare global {
  interface Window {
    speech: SpeechModule;
  }
}

function silentWav(seconds = 0.2, rate = 8000) {
  const samples = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + samples);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + samples, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples, 40);
  b.fill(128, 44);
  return b;
}

async function load(
  page: Page,
  available: boolean,
  synthesize: "404" | "hang" | "audio",
) {
  const calls = { synthesize: 0 };
  await page.route("**/api/speech/status", (r) =>
    r.fulfill({ json: { available } }),
  );
  await page.route("**/api/speech/synthesize?*", async (r) => {
    calls.synthesize++;
    if (synthesize === "404") return r.fulfill({ status: 404, json: {} });
    if (synthesize === "audio")
      return r.fulfill({ body: silentWav(), contentType: "audio/wav" });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await r.fulfill({ body: silentWav(), contentType: "audio/wav" }).catch(() => {});
  });
  await page.goto("/");
  await page.evaluate(async () => {
    window.speech = await import("/web/src/speech.ts" as string);
  });
  return calls;
}

test("a missing synthesis endpoint fails and trips the breaker after two attempts", async ({
  page,
}) => {
  const calls = await load(page, true, "404");
  const results = await page.evaluate(async () => {
    const s = window.speech;
    const out = [await s.playAiSpeech("One.", 1), s.aiSpeechAvailable()];
    out.push(await s.playAiSpeech("Two.", 1), s.aiSpeechAvailable());
    out.push(await s.playAiSpeech("Three.", 1));
    return out;
  });
  expect(results).toEqual(["failed", true, "failed", false, "failed"]);
  expect(calls.synthesize).toBe(2);
});

test("a slow synthesis response times out as failed", async ({ page }) => {
  await load(page, true, "hang");
  const [outcome, elapsed] = await page.evaluate(async () => {
    const t = performance.now();
    return [await window.speech.playAiSpeech("Slow.", 1), performance.now() - t];
  });
  expect(outcome).toBe("failed");
  expect(elapsed).toBeGreaterThan(1300);
  expect(elapsed).toBeLessThan(2500);
});

test("an unconfigured server is never asked to synthesize", async ({ page }) => {
  const calls = await load(page, false, "audio");
  const outcome = await page.evaluate(() =>
    window.speech.playAiSpeech("Hello.", 1),
  );
  expect(outcome).toBe("failed");
  expect(await page.evaluate(() => window.speech.aiSpeechAvailable())).toBe(
    false,
  );
  expect(calls.synthesize).toBe(0);
});

test("audio plays at the speech rate, reuses one element and can be stopped", async ({
  page,
}) => {
  const calls = await load(page, true, "audio");
  const result = await page.evaluate(async () => {
    const s = window.speech;
    const created: HTMLAudioElement[] = [];
    const Original = window.Audio;
    window.Audio = function (...args: []) {
      const a = new Original(...args);
      created.push(a);
      return a;
    } as unknown as typeof Audio;
    const first = await s.playAiSpeech("Played.", 1.5);
    const rate = created[0]?.playbackRate;
    const interrupted = s.playAiSpeech("Played.", 1);
    s.cancelAllSpeech();
    return {
      first,
      rate,
      stopped: await interrupted,
      elements: created.length,
      available: s.aiSpeechAvailable(),
    };
  });
  expect(result).toEqual({
    first: "played",
    rate: 1.5,
    stopped: "stopped",
    elements: 1,
    available: true,
  });
  expect(calls.synthesize).toBeGreaterThanOrEqual(1);
});

test("prefetched audio plays without another request and slow prefetches are kept", async ({
  page,
}) => {
  const calls = await load(page, true, "hang");
  const result = await page.evaluate(async () => {
    const s = window.speech;
    s.prefetchAiSpeech("Next step.");
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const t = performance.now();
    const outcome = await s.playAiSpeech("Next step.", 1);
    return { outcome, elapsed: performance.now() - t };
  });
  expect(result.outcome).toBe("played");
  expect(result.elapsed).toBeLessThan(1000);
  expect(calls.synthesize).toBe(1);
});

test("speaking text that is still prefetching reuses that request", async ({
  page,
}) => {
  const calls = await load(page, true, "audio");
  const outcome = await page.evaluate(async () => {
    const s = window.speech;
    s.prefetchAiSpeech("Soon.");
    return s.playAiSpeech("Soon.", 1);
  });
  expect(outcome).toBe("played");
  expect(calls.synthesize).toBe(1);
});

test("a tap unlocks the shared audio element for later playback", async ({
  page,
}) => {
  await load(page, true, "audio");
  await page.evaluate(() => {
    const s = window.speech;
    const button = document.createElement("button");
    button.textContent = "Unlock";
    button.style.cssText = "position:fixed;inset:0 auto auto 0;z-index:2147483647";
    button.onclick = () => s.unlockAiAudio();
    document.body.prepend(button);
    const Original = window.Audio;
    window.Audio = function () {
      const a = new Original();
      (window as unknown as { shared: HTMLAudioElement }).shared = a;
      return a;
    } as unknown as typeof Audio;
  });
  await page.getByRole("button", { name: "Unlock" }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { shared: HTMLAudioElement }).shared.src,
    ),
  ).toMatch(/^blob:/);
  expect(
    await page.evaluate(() => window.speech.playAiSpeech("After tap.", 1)),
  ).toBe("played");
});

test("AI speech pauses without timing out and resumes the same audio position", async ({ page }) => {
  await load(page, true, "audio");
  await page.route("**/api/speech/synthesize?*", r => r.fulfill({ body: silentWav(4), contentType: "audio/wav" }));
  await page.evaluate(() => {
    const w = window as any, NativeAudio = window.Audio;
    window.Audio = function () { w.shared = new NativeAudio(); return w.shared; } as unknown as typeof Audio;
    w.finished = false;
    w.playResult = window.speech.playAiSpeech("A longer instruction.", 1).then(result => { w.finished = true; return result; });
  });
  await page.waitForFunction(() => (window as any).shared?.currentTime > 0.05);
  const position = await page.evaluate(() => { window.speech.pauseAllSpeech(); return (window as any).shared.currentTime; });
  await page.waitForTimeout(1700);
  expect(await page.evaluate(() => (window as any).finished)).toBe(false);
  expect(await page.evaluate(() => (window as any).shared.currentTime)).toBeCloseTo(position, 1);
  await page.evaluate(() => window.speech.resumeAllSpeech());
  expect(await page.evaluate(() => (window as any).playResult)).toBe("played");
});
