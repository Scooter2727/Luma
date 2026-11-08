import { test, expect } from "@playwright/test";

test("mobile hero matches the white landing layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directions you can hear." })).toBeVisible();
  await expect(page.getByText("Clock-position guidance at the speed you choose.")).toBeVisible();
  await expect(page.getByText("downtown Toronto")).not.toBeVisible();
  await expect(page.getByText("onto Queen St W")).not.toBeVisible();
  const box = await page.getByRole("button", { name: "Try Luma", exact: true }).boundingBox();
  expect(box && box.width).toBeGreaterThan(300);
});

test("desktop hero shows the Toronto line and the caption detail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(
    page.getByText("for blind and low-vision pedestrians in downtown Toronto."),
  ).toBeVisible();
  await expect(page.getByText("onto Queen St W · north side, heading west")).toBeVisible();
});

test("Try Luma opens setup on every load even when onboarding was completed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("luma-onboarding-complete", "true");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Colour and display", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Colour and display", exact: true }),
  ).toBeVisible();
});

test("Ask Luma skips setup and lands on home", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("luma-onboarding-complete", "true");
    class FakeRecognition {
      lang = "";
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {}
      stop() {
        this.onend?.();
      }
    }
    const w = window as unknown as {
      SpeechRecognition?: typeof FakeRecognition;
      webkitSpeechRecognition?: typeof FakeRecognition;
    };
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Ask Luma", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where to?", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Colour and display", exact: true }),
  ).toHaveCount(0);
});

test("Ask Luma opens voice input after setup", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("luma-onboarding-complete", "true");
    class FakeRecognition {
      lang = "";
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {}
      stop() {
        this.onend?.();
      }
    }
    const w = window as unknown as {
      SpeechRecognition?: typeof FakeRecognition;
      webkitSpeechRecognition?: typeof FakeRecognition;
    };
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Ask Luma", exact: true }).click();
  await expect(page.getByRole("button", { name: "Say where to go" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
