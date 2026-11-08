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
  await expect(page.getByRole("button", { name: "Test AI voice" })).toHaveCount(
    0,
  );
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
  const texts = await boot(page, true, "audio", { "luma-ai-voice": "true" });
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

test("AI voice failure during preview falls back to the device voice wording", async ({
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

test("local key panel saves keys without reading them back and reports each service", async ({
  page,
}) => {
  const saved: Record<string, string>[] = [];
  let summary = {
    available: false,
    gemini: { saved: false, hint: "" },
    elevenlabs: { saved: false, hint: "" },
    voice_id: "JBFqnCBsd6RMkjVDRZzb",
    default_voice_id: "JBFqnCBsd6RMkjVDRZzb",
  };
  await page.route("**/api/speech/keys", (r) => {
    if (r.request().method() === "PUT") {
      saved.push(r.request().postDataJSON());
      summary = {
        ...summary,
        available: true,
        gemini: { saved: true, hint: "…1234" },
        elevenlabs: { saved: true, hint: "…5678" },
      };
    }
    return r.fulfill({ json: summary });
  });
  await page.route("**/api/speech/keys/check", (r) =>
    r.fulfill({
      json: {
        gemini: {
          ok: true,
          message: "Gemini key works with gemini-3.8-flash.",
        },
        elevenlabs: { ok: true, message: "ElevenLabs key and voice work." },
      },
    }),
  );
  let available = false;
  await page.route("**/api/speech/status", (r) =>
    r.fulfill({ json: { available } }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("luma-onboarding-complete", "true"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  await openVoiceSettings(page);
  await expect(
    page.getByRole("checkbox", { name: /Try AI voice/ }),
  ).toHaveCount(0);
  const save = page.getByRole("button", { name: "Save keys" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Google Gemini API key").fill("AQ.gemini-1234");
  await page.getByLabel(/ElevenLabs API key/).fill("sk_eleven-5678");
  available = true;
  await save.click();
  await expect(page.getByText("Both keys work.")).toBeVisible();
  expect(saved).toEqual([
    {
      gemini_api_key: "AQ.gemini-1234",
      elevenlabs_api_key: "sk_eleven-5678",
      elevenlabs_voice_id: "",
    },
  ]);
  await expect(page.getByLabel("Google Gemini API key")).toHaveValue("");
  await expect(page.getByLabel("Google Gemini API key")).toHaveAttribute(
    "placeholder",
    "Saved (…1234). Paste to replace.",
  );
  await expect(
    page.getByRole("checkbox", { name: /Try AI voice/ }),
  ).toBeVisible();
});

test("the key panel is hidden when the server does not offer it", async ({
  page,
}) => {
  await page.route("**/api/speech/keys", (r) =>
    r.fulfill({ status: 404, json: { detail: "Not Found" } }),
  );
  await boot(page, false);
  await openVoiceSettings(page);
  await expect(page.getByRole("button", { name: "Save keys" })).toHaveCount(0);
});
