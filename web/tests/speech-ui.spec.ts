import { test, expect, type Page } from "@playwright/test";

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

async function boot(
  page: Page,
  available: boolean,
  synthesize: "audio" | "503" = "audio",
  storage: Record<string, string> = {},
) {
  const texts: string[] = [];
  await page.route("**/api/speech/status", (r) =>
    r.fulfill({ json: { available } }),
  );
  await page.route("**/api/speech/synthesize", (r) => {
    texts.push(r.request().postDataJSON().text);
    return synthesize === "audio"
      ? r.fulfill({ body: silentWav(), contentType: "audio/wav" })
      : r.fulfill({ status: 503, json: { detail: "AI voice could not be generated." } });
  });
  await page.addInitScript((items) => {
    localStorage.setItem("luma-onboarding-complete", "true");
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
  }, storage);
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  return texts;
}
async function openVoiceSettings(page: Page) {
  await page
    .getByRole("navigation", { name: "Main", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
}

test("AI voice stays hidden and is explained when the server is not configured", async ({
  page,
}) => {
  const texts = await boot(page, false);
  await openVoiceSettings(page);
  await expect(page.getByRole("button", { name: "Test voice" })).toBeVisible();
  await expect(page.getByText("Try AI voice (experimental)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Test AI voice" })).toHaveCount(0);
  await expect(page.locator(".voice-engine")).toHaveText("Using device voice");
  await page.getByRole("button", { name: "Back to settings" }).click();
  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(
    page.getByText("AI voice is not available on this deployment"),
  ).toBeVisible();
  expect(texts).toEqual([]);
});

test("opting in to AI voice persists, reports the engine and plays a sample", async ({
  page,
}) => {
  const texts = await boot(page, true);
  await openVoiceSettings(page);
  const toggle = page.getByRole("checkbox", {
    name: /Try AI voice \(experimental\)/,
  });
  await expect(toggle).not.toBeChecked();
  await expect(page.locator(".voice-engine")).toHaveText("Using device voice");
  await toggle.check();
  await expect(page.locator(".voice-engine")).toHaveText("Using AI voice");
  expect(await page.evaluate(() => localStorage.getItem("luma-ai-voice"))).toBe(
    "true",
  );
  await page.getByRole("button", { name: "Test AI voice" }).click();
  await expect.poll(() => texts.length).toBe(1);
  expect(texts[0]).toContain("Queen Street West");
  await page.reload();
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  await openVoiceSettings(page);
  await expect(
    page.getByRole("checkbox", { name: /Try AI voice \(experimental\)/ }),
  ).toBeChecked();
});

test("repeated AI voice failures switch the status to the device voice", async ({
  page,
}) => {
  await boot(page, true, "503", { "luma-ai-voice": "true" });
  await openVoiceSettings(page);
  await expect(page.locator(".voice-engine")).toHaveText("Using AI voice");
  await page.getByRole("button", { name: "Test voice", exact: true }).click();
  await page.getByRole("button", { name: "Test voice", exact: true }).click();
  await expect(page.locator(".voice-engine")).toHaveText(
    "Using device voice. AI voice is unavailable right now.",
  );
  await page.getByRole("button", { name: "Test AI voice" }).click();
  await expect(page.locator(".voice-engine")).toHaveText("Using AI voice");
});

test("screen reader mode hides the AI voice choice", async ({ page }) => {
  await boot(page, true, "audio", { "luma-screenReader": "true" });
  await openVoiceSettings(page);
  await expect(page.getByText("Try AI voice (experimental)")).toHaveCount(0);
  await expect(page.locator(".voice-engine")).toHaveText(
    "Using screen reader announcements",
  );
});

async function previewWalk(page: Page) {
  await page
    .getByRole("button", { name: "Example journey Try a walk" })
    .click();
  await page
    .getByRole("button", { name: "Preview route 1", exact: true })
    .click({ timeout: 65000 });
}
async function recordDeviceSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { deviceSpoken: string[] }).deviceSpoken = spoken;
    speechSynthesis.speak = (u: SpeechSynthesisUtterance) =>
      void spoken.push(u.text);
  });
}

test("route preview speaks rephrased steps and prefetches the next one", async ({
  page,
}) => {
  const rephrased: number[] = [];
  await page.route("**/api/speech/rephrase", (r) => {
    const steps = r.request().postDataJSON().steps as { text: string }[];
    rephrased.push(steps.length);
    return r.fulfill({ json: { texts: steps.map((s) => "Natural. " + s.text), rephrased: steps.map(() => true) } });
  });
  await recordDeviceSpeech(page);
  const texts = await boot(page, true, "audio", { "luma-ai-voice": "true" });
  await previewWalk(page);
  await expect.poll(() => texts.length).toBeGreaterThanOrEqual(2);
  expect(rephrased.length).toBeGreaterThan(0);
  // The current step and the prefetched next step, in either network order.
  expect(texts.slice(0, 2).sort()).toEqual([
    expect.stringMatching(/^Natural\. Head east along Front St W/),
    expect.stringMatching(/^Natural\. Join the mapped pedestrian path/),
  ]);
  await expect(page.locator(".navigation-screen")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { deviceSpoken: string[] }).deviceSpoken,
    ),
  ).toEqual([]);
});

test("AI voice failure during preview falls back to the device voice wording", async ({
  page,
}) => {
  await page.route("**/api/speech/rephrase", (r) => {
    const steps = r.request().postDataJSON().steps as { text: string }[];
    return r.fulfill({ json: { texts: steps.map((s) => "Natural. " + s.text), rephrased: steps.map(() => true) } });
  });
  await recordDeviceSpeech(page);
  await boot(page, true, "503", { "luma-ai-voice": "true" });
  await previewWalk(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { deviceSpoken: string[] }).deviceSpoken,
      ),
    )
    .toEqual([expect.stringMatching(/^Join the mapped pedestrian path/)]);
});
