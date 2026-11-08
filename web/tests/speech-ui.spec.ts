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

async function finishOnboarding(page: Page) {
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  const useLuma = page.getByRole("button", { name: "Use Luma", exact: true });
  while (!(await useLuma.isVisible())) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await useLuma.click();
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
  await page.route("**/api/speech/synthesize?*", (r) => {
    texts.push(new URL(r.request().url()).searchParams.get("text") || "");
    return synthesize === "audio"
      ? r.fulfill({ body: silentWav(), contentType: "audio/wav" })
      : r.fulfill({
          status: 503,
          json: { detail: "AI voice could not be generated." },
        });
  });
  await page.addInitScript((items) => {
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
  }, storage);
  await page.goto("/");
  await finishOnboarding(page);
  return texts;
}
async function openVoiceSettings(page: Page) {
  await page
    .getByRole("navigation", { name: "Main", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
}

test("Luma voice is the voice, with the device voice only as a fallback", async ({
  page,
}) => {
  await boot(page, false);
  await openVoiceSettings(page);
  await expect(page.getByRole("heading", { name: "AI voice keys" })).toHaveCount(0);
  await expect(page.getByText("For local testing")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save keys" })).toHaveCount(0);
  await expect(page.getByText("Try AI voice (experimental)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Test voice", exact: true })).toHaveCount(0);
  await expect(page.locator(".voice-engine")).toHaveText(
    "Using device voice. Luma voice is unavailable right now.",
  );
});

test("Luma voice is used by default and plays a sample through the server", async ({
  page,
}) => {
  await recordDeviceSpeech(page);
  const texts = await boot(page, true, "audio", { "luma-ai-voice": "false" });
  await openVoiceSettings(page);
  await expect(page.locator(".voice-engine")).toHaveText("Using Luma voice");
  await page.getByRole("button", { name: "Test Luma voice" }).click();
  await expect.poll(() => texts.length).toBe(1);
  expect(texts[0]).toContain("Queen Street West");
  expect(
    await page.evaluate(
      () => (window as unknown as { deviceSpoken: string[] }).deviceSpoken,
    ),
  ).toEqual([]);
});

test("repeated Luma voice failures switch the status to the device voice", async ({
  page,
}) => {
  await boot(page, true, "503");
  await openVoiceSettings(page);
  await expect(page.locator(".voice-engine")).toHaveText("Using Luma voice");
  await page.getByRole("button", { name: "Test Luma voice", exact: true }).click();
  await page.getByRole("button", { name: "Test Luma voice", exact: true }).click();
  await expect(page.locator(".voice-engine")).toHaveText(
    "Using device voice. Luma voice is unavailable right now.",
  );
  await page.route("**/api/speech/synthesize?*", (r) =>
    r.fulfill({ body: silentWav(), contentType: "audio/wav" }),
  );
  await page.getByRole("button", { name: "Test Luma voice" }).click();
  await expect(page.locator(".voice-engine")).toHaveText("Using Luma voice");
});

test("screen reader mode hides the Luma voice sample", async ({ page }) => {
  await boot(page, true, "audio", { "luma-screenReader": "true" });
  await openVoiceSettings(page);
  await expect(page.getByText("Try AI voice (experimental)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Test Luma voice" })).toHaveCount(0);
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

test("routes prefetch the rephrased first steps so the preview starts without waiting", async ({
  page,
}) => {
  const rephrased: number[] = [];
  await page.route("**/api/speech/rephrase", (r) => {
    const steps = r.request().postDataJSON().steps as { text: string }[];
    rephrased.push(steps.length);
    return r.fulfill({
      json: {
        texts: steps.map((s) => "Natural. " + s.text),
        rephrased: steps.map(() => true),
      },
    });
  });
  await recordDeviceSpeech(page);
  const texts = await boot(page, true, "audio");
  await page
    .getByRole("button", { name: "Example journey Try a walk" })
    .click();
  // The first two steps are fetched while routes are still being compared.
  await expect
    .poll(() => texts.filter((t) => t.startsWith("Natural. ")).length, {
      timeout: 65000,
    })
    .toBeGreaterThanOrEqual(2);
  const beforePreview = texts.length;
  await page
    .getByRole("button", { name: "Preview route 1", exact: true })
    .click();
  await expect(page.locator(".navigation-screen")).toBeVisible();
  await expect(page.locator(".sr-only[role=status]")).not.toBeEmpty();
  expect(rephrased.length).toBeGreaterThan(0);
  // The first two steps were already downloaded, so the preview does not wait on the network.
  const early = texts.slice(0, beforePreview);
  expect(texts.slice(beforePreview).filter((t) => early.includes(t))).toEqual(
    [],
  );
  expect(texts).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^Natural\. Join the mapped pedestrian path/),
      expect.stringMatching(/^Natural\. Head east along Front St W/),
    ]),
  );
  await expect(page.locator(".navigation-screen")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { deviceSpoken: string[] }).deviceSpoken,
    ),
  ).toEqual([]);
});

test("Luma voice failure during preview falls back to the device voice wording", async ({
  page,
}) => {
  await page.route("**/api/speech/rephrase", (r) => {
    const steps = r.request().postDataJSON().steps as { text: string }[];
    return r.fulfill({
      json: {
        texts: steps.map((s) => "Natural. " + s.text),
        rephrased: steps.map(() => true),
      },
    });
  });
  await recordDeviceSpeech(page);
  await boot(page, true, "503");
  await previewWalk(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { deviceSpoken: string[] }).deviceSpoken,
      ),
    )
    .toEqual([expect.stringMatching(/^Join the mapped pedestrian path/)]);
});

