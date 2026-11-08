# Luma loader, landing hero, and Luma-first voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the supplied Luma loader on every wait, show the supplied mobile and desktop landing heroes, and make Luma voice the only voice users choose or test, with the device voice used only when Luma cannot speak.

**Architecture:** One `LumaLoader` component owns the three-circle animation and its accessible label. `Hero` keeps the current dialog behaviour and is restyled to the two supplied layouts with a CSS breakpoint. `speak()` always tries ElevenLabs first unless screen-reader mode is on; `speechSynthesis` runs only after that attempt fails. The experimental opt-in and the device-voice test button are removed.

**Tech Stack:** React 19, TypeScript, Vite, existing `web/src/app.css` and `web/src/hero.css`, Playwright (`web/tests`), no new dependencies.

## Global Constraints

- Do not implement until this plan is chosen. This document is the only change in the planning commit.
- API keys stay server-side. Do not read or commit `.env`.
- The on-screen notice is still the deterministic instruction, set synchronously, before any audio request.
- Screen-reader mode never plays Luma audio and never plays the device voice.
- Device `speechSynthesis` is the last resort: only after `playAiSpeech` resolves `"failed"` for that same turn.
- A saved `luma-ai-voice=false` must not keep the device voice as the primary voice.
- Loader motion stops under `prefers-reduced-motion: reduce`. The still mark and the label remain.
- Hero motion (bubbles, typing, wave, entrance) stops under reduced motion. Copy stays visible.
- Keep the route-planning sentence that the first journey can take longer while the network loads.
- Copy says "Luma voice", never "AI voice" or "Try AI voice (experimental)", in the UI.
- Do not add a component library. Match the existing CSS custom properties (`--primary`, `--accent`, `--mint`, `--ink`, `--surface`).

---

### Task 1: Luma loader component

**Files:**
- Create: `web/src/LumaLoader.tsx`
- Create: `web/src/loader.css`
- Test: `web/tests/loader.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `export function LumaLoader({ label, size }: { label: string; size?: number })`. Default `size` is `140`. The root element has class `luma-loader`, `role="status"`, and `aria-live="polite"`. The SVG is `aria-hidden`. The label is a `<p class="luma-label">`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "@playwright/test";

test("route planning shows the Luma loader and keeps the slow-network note", async ({
  page,
}) => {
  await page.route("**/api/route", () => new Promise(() => {}));
  await page.addInitScript(() =>
    localStorage.setItem("luma-onboarding-complete", "true"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  await page
    .getByRole("button", { name: "Example journey Try a walk" })
    .click();
  const loader = page.getByRole("status").filter({ hasText: "Finding your way…" });
  await expect(loader).toBeVisible();
  await expect(loader.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByText("The first journey can take longer")).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test web/tests/loader.spec.ts --reporter=line`

Expected: FAIL because the status "Finding your way…" is not in the page. The dev server must be the app on the Playwright `baseURL` (today `http://127.0.0.1:5173`; use the already running Vite port if 5173 is not serving, and revert `playwright.config.ts` afterwards).

- [ ] **Step 3: Add the component**

`web/src/LumaLoader.tsx`:

```tsx
import "./loader.css";

export function LumaLoader({
  label,
  size = 140,
}: {
  label: string;
  size?: number;
}) {
  return (
    <div
      className="luma-loader"
      role="status"
      aria-live="polite"
      style={{ ["--size" as string]: size + "px" }}
    >
      <svg className="luma-mark" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="c-orange" cx="60" cy="42" r="34" fill="#FF8A4C" />
        <circle className="c-blue" cx="40" cy="78" r="34" fill="#5865F2" />
        <circle className="c-mint" cx="80" cy="78" r="34" fill="#2CCBA8" />
      </svg>
      <p className="luma-label">{label}</p>
    </div>
  );
}
```

`web/src/loader.css` is the loader block from the supplied `luma-loader.html`: `.luma-loader`, `.luma-mark`, the three circle animations `luma-o`, `luma-b`, `luma-m` at 1.8s, `.luma-label`, and the reduced-motion rule that sets `animation: none` on `.luma-mark circle`. Do not add a page background. Add:

```css
.luma-loader {
  background: var(--surface, #fff);
  border-radius: 24px;
  padding: calc(var(--size) * 0.12);
}
```

The white surface keeps `mix-blend-mode: screen` from washing the circles out on a tinted panel.

- [ ] **Step 4: Show it while routes are calculated**

In `web/src/JourneyPlanner.tsx`, import `LumaLoader`. Replace the busy heading text `"Finding routes"` with `"Finding your way…"`. Replace the `.planning-status` paragraph with:

```tsx
{p.busy && (
  <div className="planning-status">
    <LumaLoader label="Finding your way…" />
    <p>
      Calculating paths and directions. The first journey can take longer
      while the network loads.
    </p>
  </div>
)}
```

The explanatory `<p>` is not a second live region. Only `LumaLoader` has `role="status"`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test web/tests/loader.spec.ts --reporter=line`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/LumaLoader.tsx web/src/loader.css web/src/JourneyPlanner.tsx web/tests/loader.spec.ts
git commit -m "Show the Luma loader while routes are calculated."
```

---

### Task 2: Use the loader for every other wait

**Files:**
- Modify: `web/src/PlacePicker.tsx`
- Modify: `web/src/ReportView.tsx`
- Modify: `web/src/SpeechKeys.tsx`
- Modify: `web/src/App.tsx` (the `data-loaded` panel only)
- Test: `web/tests/loader.spec.ts`

**Interfaces:**
- Consumes: `LumaLoader` from Task 1
- Produces: no new exports. Inline loaders use `size={36}` except the places search icon, which uses `size={28}`.

- [ ] **Step 1: Extend the failing test**

Append to `web/tests/loader.spec.ts`:

```ts
test("searching for a place shows a small Luma loader", async ({ page }) => {
  await page.route("**/api/search?*", () => new Promise(() => {}));
  await page.addInitScript(() =>
    localStorage.setItem("luma-onboarding-complete", "true"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Try Luma", exact: true }).click();
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByLabel("Destination").fill("Queen");
  const loader = page.getByRole("status").filter({ hasText: "Searching places…" });
  await expect(loader).toBeVisible();
  await expect(loader).toHaveClass(/luma-loader/);
});
```

`PlacePicker` fetches `/api/search?q=`. `HomeView` passes `label="Destination"`, so the input's accessible name is Destination.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test web/tests/loader.spec.ts --reporter=line`

Expected: the new test FAIL because the search control still renders a Lucide `LoaderCircle`.

- [ ] **Step 3: Replace each wait**

`PlacePicker.tsx`: remove the `LoaderCircle` import. When `busy` is true, render `<LumaLoader label="Searching places…" size={28} />` in place of the icon. Add CSS in `loader.css`:

```css
.picker .luma-loader {
  padding: 0;
  background: transparent;
}
.picker .luma-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
```

Use the existing picker class if it is not `.picker`. The label stays available to assistive tech and does not wrap the search field.

`ReportView.tsx`: above the location button, when `locating` is true, render `<LumaLoader label="Finding location…" size={72} />`. Above the save button, when `busy` is true, render `<LumaLoader label="Saving report…" size={72} />`. Keep the button labels as they are.

`SpeechKeys.tsx`: when `busy` is `"saving"` or `"checking"`, render `<LumaLoader label={busy === "saving" ? "Saving keys…" : "Checking keys…"} size={72} />` inside `.key-card`, before the result text.

`App.tsx`: the controls panel already has `data-loaded={loaded}`. When `!loaded && !onboarding`, render `<LumaLoader label="Opening Luma…" />` as the first child of `#panel`. Remove it once `loaded` is true. Do not block the map.

- [ ] **Step 4: Run the loader tests**

Run: `npx playwright test web/tests/loader.spec.ts --reporter=line`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/PlacePicker.tsx web/src/ReportView.tsx web/src/SpeechKeys.tsx web/src/App.tsx web/src/loader.css web/tests/loader.spec.ts
git commit -m "Use the Luma loader for search, reports, keys and startup."
```

---

### Task 3: Luma voice is the voice; the device voice is the last resort

**Files:**
- Modify: `web/src/App.tsx` (`speak`, prefetch effect, `startPreview`, preference persistence)
- Modify: `web/src/model.ts` (remove `aiVoice` from `Preferences`)
- Modify: `web/src/Preferences.tsx` (`VoiceEngineStatus`; delete `AiVoiceChoice`)
- Modify: `web/src/SpeechKeys.tsx` (the success sentence)
- Test: `web/tests/speech-ui.spec.ts`

**Interfaces:**
- Consumes: `playAiSpeech`, `aiSpeechAvailable`, `unlockAiAudio`, `stopAiSpeech` from `web/src/speech.ts`. Do not change `speech.ts`.
- Produces: `speak(text, aiText?)` tries Luma for every caller unless `prefs.screenReader` is true. `prefs.aiVoice` no longer exists.

- [ ] **Step 1: Replace the opt-in tests**

In `web/tests/speech-ui.spec.ts`, replace the test named `AI voice stays hidden and is explained when the server is not configured` with:

```ts
test("Luma voice is the voice, with the device voice only as a fallback", async ({
  page,
}) => {
  await boot(page, false);
  await openVoiceSettings(page);
  await expect(page.getByText("Try AI voice (experimental)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Test voice", exact: true })).toHaveCount(0);
  await expect(page.locator(".voice-engine")).toHaveText(
    "Using device voice. Luma voice is unavailable right now.",
  );
});
```

Replace `opting in to AI voice persists, reports the engine and plays a sample` with a test that does not click a checkbox. Boot with `available: true` and storage `{ "luma-ai-voice": "false" }`. Open Voice settings. Expect `.voice-engine` to be `Using Luma voice`. Click `Test Luma voice`. Expect one synthesize request whose text is the sample instruction, and expect no `speechSynthesis` call. The existing `recordDeviceSpeech` helper records device calls.

Replace `repeated AI voice failures switch the status to the device voice` so it clicks `Test Luma voice` twice against a 503 synthesize route, then expects `Using device voice. Luma voice is unavailable right now.` A third click calls `reset` via the existing Test Luma voice path and expects `Using Luma voice` again when the route is changed to audio. Keep the circuit-breaker behaviour already implemented in `speech.ts`.

Replace `screen reader mode hides the AI voice choice` so it expects no `Test Luma voice` button and the status `Using screen reader announcements`.

Delete every `getByRole("checkbox", { name: /Try AI voice/ })` assertion. The key-panel test must not look for that checkbox. Change its success copy expectation to `Both keys work. Press Test Luma voice.`

- [ ] **Step 2: Run the speech UI tests to verify they fail**

Run: `npx playwright test web/tests/speech-ui.spec.ts --reporter=line`

Expected: FAIL on the missing "Test Luma voice" button and on the old "Try AI voice" copy.

- [ ] **Step 3: Make speak() Luma-first**

In `web/src/App.tsx`, delete `aiVoice` from the initial preferences object and from the `localStorage` persistence object (`"ai-voice"`). Delete `if (values.aiVoice) unlockAiAudio();`.

Replace `speak` with:

```tsx
function speak(text: string, aiText = text) {
  setNotice(text);
  const turn = ++speechTurn.current;
  if (prefs.screenReader) return;
  unlockAiAudio();
  window.speechSynthesis?.cancel();
  void playAiSpeech(aiText, prefs.rate).then((outcome) => {
    if (outcome === "failed" && turn === speechTurn.current)
      deviceSpeak(text);
  });
}
```

`playAiSpeech` already returns `"failed"` when the server is not configured or the breaker is open, so this is the last-resort path.

In the prefetch effect, replace the `prefs.aiVoice` guard with `if (prefs.screenReader || !aiVoiceReady || !route) return;`. Remove `prefs.aiVoice` from the dependency array.

In `startPreview`, call `unlockAiAudio()` whenever `!prefs.screenReader`.

In `rephraseRoute`'s caller, request rephrasing whenever `!prefs.screenReader` instead of `prefs.aiVoice`.

In `web/src/model.ts`, delete `aiVoice: boolean` from `Preferences`.

- [ ] **Step 4: Remove the experimental section and rename the status**

Delete `AiVoiceChoice` from `web/src/Preferences.tsx` and both call sites (onboarding step 2 and Settings → Voice).

Replace `VoiceEngineStatus` text with:

```tsx
const text = prefs.screenReader
  ? "Using screen reader announcements"
  : speechAvailable && aiVoiceReady
    ? "Using Luma voice"
    : "Using device voice. Luma voice is unavailable right now.";
```

Privacy paragraph, when speech is configured:

```tsx
"Luma voice speaks route instructions. Instruction text, including street and destination names, is sent through this prototype’s server to Google Gemini for wording and to ElevenLabs for speech. GPS coordinates are not sent. If Luma voice cannot start, this device’s voice speaks instead."
```

When speech is not configured:

```tsx
"Luma voice is not available on this deployment because it has not been configured. This device’s voice is used instead."
```

In `web/src/SpeechKeys.tsx`, change the success line to `Both keys work. Press Test Luma voice.`

- [ ] **Step 5: Run the speech UI tests**

Run: `npx playwright test web/tests/speech-ui.spec.ts web/tests/speech.spec.ts --reporter=line`

Expected: the module tests in `speech.spec.ts` still PASS. The UI tests PASS after Step 1's assertions match this task. If a test still clicks `Test voice`, that failure belongs to Task 4; do not reintroduce the device-voice button to make it pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/model.ts web/src/Preferences.tsx web/src/SpeechKeys.tsx web/tests/speech-ui.spec.ts
git commit -m "Use Luma voice for every announcement and drop the experimental opt-in."
```

---

### Task 4: One test button, and it tests Luma voice

**Files:**
- Modify: `web/src/Preferences.tsx` (`SpeedCard`, onboarding steps 2 and 3)
- Modify: `web/src/App.tsx` (`testAiVoice` fallback copy only)
- Test: `web/tests/speech-ui.spec.ts` (the test from Task 3 that clicks `Test Luma voice`)

**Interfaces:**
- Consumes: `testAiVoice(text: string)` already on `PreferenceProps`
- Produces: one button, accessible name `Test Luma voice`, in SpeedCard and on onboarding step 2. It is hidden when `prefs.screenReader` is true. Onboarding step 3 keeps a directions sample, also spoken through `testAiVoice`, named `Test Luma voice`.

- [ ] **Step 1: Confirm the failing assertion already exists**

The Task 3 test expects a button named `Test Luma voice` and zero buttons named `Test voice`. If Task 3 was committed with that test still failing, this task makes it pass. Do not add a second test.

- [ ] **Step 2: Run it**

Run: `npx playwright test web/tests/speech-ui.spec.ts -g "Luma voice is the voice" --reporter=line`

Expected: FAIL until the button exists.

- [ ] **Step 3: Replace both test buttons**

In `SpeedCard`, delete the button whose text is `Test voice`. Keep a single button:

```tsx
{!prefs.screenReader && testAiVoice && (
  <button
    className="voice-test"
    onClick={() => testAiVoice(SAMPLE_INSTRUCTION)}
  >
    <Volume2 size={30} />
    Test Luma voice
  </button>
)}
```

Remove the `Sparkles` import if nothing else uses it. `speak` can stay on the props type because other screens use it.

Onboarding step 2's `Test voice` button becomes `Test Luma voice` and calls `props.testAiVoice?.(SAMPLE_INSTRUCTION)` instead of `speak(...)`. Hide it when `prefs.screenReader` is true.

Onboarding step 3's button also says `Test Luma voice` and calls `testAiVoice` with the same direction sample string it uses today (cardinal, clock, or left-right). That sample is a voice check of the chosen direction style, still through Luma.

In `testAiVoice`, change the fallback notice prefix from `"AI voice is unavailable right now. "` to `"Luma voice is unavailable right now. "`.

- [ ] **Step 4: Run the speech UI tests**

Run: `npx playwright test web/tests/speech-ui.spec.ts --reporter=line`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/Preferences.tsx web/src/App.tsx web/tests/speech-ui.spec.ts
git commit -m "Test only Luma voice."
```

---

### Task 5: Landing hero matches the mobile and desktop designs

**Files:**
- Modify: `web/src/Hero.tsx`
- Modify: `web/src/hero.css`
- Modify: `web/src/App.tsx` (show the hero on load; Ask Luma starts dictation)
- Modify: `web/src/app.css` (Nunito for the hero wordmark only)
- Test: `web/tests/hero.spec.ts`

**Interfaces:**
- Consumes: `logoForTheme`, `useReducedMotion`
- Produces: `Hero` props `{ theme: string; onTry: () => void; onAsk: () => void }`. `App` starts with `showHero === true`. `onTry` sets `showHero` false. `onAsk` sets `showHero` false and sets `askOnHome` true. `HomeView` gains `askOnHome?: boolean` and `onAskStarted?: () => void`. When `askOnHome` becomes true and onboarding is finished, `HomeView` runs the same click handler as "Say where to go" once, then calls `onAskStarted`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "@playwright/test";

test("mobile hero matches the white landing layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Directions you can hear." })).toBeVisible();
  await expect(page.getByText("Clock-position guidance at the speed you choose.")).toBeVisible();
  await expect(page.getByText("downtown Toronto")).toHaveCount(0);
  await expect(page.getByText("onto Queen St W")).toHaveCount(0);
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

test("Ask Luma opens voice input after setup", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("luma-onboarding-complete", "true"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Ask Luma", exact: true }).click();
  await expect(page.getByRole("button", { name: "Say where to go" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
```

The third test needs `dictate` to return true. If the suite already stubs speech recognition, use that stub. If it does not, stub `webkitSpeechRecognition` in `addInitScript` with a constructor whose `start()` does not throw, matching the existing recognition code in `App.tsx`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test web/tests/hero.spec.ts --reporter=line`

Expected: FAIL. `showHero` is currently `false`, so the heading is not the landing heading.

- [ ] **Step 3: Show the hero and split the two actions**

In `App.tsx`, change `useState(false)` for `showHero` to `useState(true)`. Add `const [askOnHome, setAskOnHome] = useState(false)`.

```tsx
<Hero
  theme={prefs.theme}
  onTry={() => setShowHero(false)}
  onAsk={() => {
    setAskOnHome(true);
    setShowHero(false);
  }}
/>
```

Pass `askOnHome` and `onAskStarted={() => setAskOnHome(false)}` into `HomeView`. In `HomeView`, add:

```tsx
useEffect(() => {
  if (!p.askOnHome) return;
  p.onAskStarted?.();
  // Same body as the "Say where to go" button's onClick.
}, [p.askOnHome]);
```

Extract the current button `onClick` body into `function ask()` and call it from both the button and the effect, so the two cannot drift. Guard the effect with a ref so React strict mode does not start recognition twice.

- [ ] **Step 4: Rebuild the hero markup and CSS from the two HTML files**

`Hero.tsx` structure, top to bottom:

1. Bubble layer. Use the 14 desktop bubbles from `hero-d5-desktop-white-2.html` (positions, sizes, durations, delays, orange/blue/mint classes). On viewports below 720px the extra two smallest bubbles (`left:49%` size 22 and `left:89%` size 24) are `display: none`.
2. Header with the theme logo and the word "Luma".
3. Main. DOM order is the desktop order: copy first, caption second. CSS on narrow screens uses `order` so the caption is visually first, matching `hero-d5-mobile-white.html`.
4. Copy: `h1` "Directions you can hear." Mobile lede: "Clock-position guidance at the speed you choose." Desktop lede adds " — for blind and low-vision pedestrians in downtown Toronto." Render both sentences and show the second span only at `min-width: 720px`.
5. Actions: `Try Luma` calls `onTry`. `Ask Luma` calls `onAsk`. Icons stay the play triangle and the microphone from the HTML.
6. Caption: four wave bars always, plus two more bars with `className="hero-wave-extra"` shown only at `min-width: 720px`. Typed line: `“In 50 m, toward 3 o'clock.”` The subtitle `onto Queen St W · north side, heading west` has `className="hero-caption-sub"` and is hidden below 720px.

`hero.css` must reproduce the supplied measurements:

- Below 720px: hero padding `20px 16px` on the header and `0 16px 20px` on the main; caption `margin-top: 80px`, padding 18px, radius 24px, gap 10px; h1 48px; lede 20px; primary button `min-height: 96px`, full width, mint background, black text, 26px; secondary button `min-height: 80px`, 3px ink border, 22px; buttons stacked with 18px gap; wave height 28px and bar width 6px.
- At 720px and up: header padding `28px 48px`; content grid `repeat(auto-fit, minmax(340px, 1fr))` with 56px gap and `56px 48px 96px` padding; h1 `clamp(52px, 6.4vw, 96px)`; lede 24px, max-width 32rem; buttons in a row, `min-height: 80px`; caption padding 32px, radius 36px, max-width 560px; wave height 44px and bar width 9px; subtitle 20px in `#D6D9E3`.

Bubbles use the existing `@keyframes hero-up`. Below 720px, `bottom: -80px` and travel `-120vh`. At 720px and up, `bottom: -130px` and travel `-130vh`.

Add `family=Nunito:wght@800;900` to the existing Google font import in `web/src/app.css`. The hero wordmark uses `font-family: Nunito, sans-serif; font-weight: 900;` at 28px below 720px and 34px above.

Reduced motion: hide `.hero-bubble`, remove the type clip-path animation, and stop the wave. Framer Motion entrance variants stay disabled when `useReducedMotion()` is true, as they are today.

Focus outline stays `4px solid var(--accent)` with 3px offset, from the supplied `:focus-visible` rule.

- [ ] **Step 5: Run the hero tests and the onboarding test that starts at Try Luma**

Run: `npx playwright test web/tests/hero.spec.ts web/tests/redesign.spec.ts -g "five-step onboarding" --reporter=line`

Expected: PASS. The onboarding test already clicks `Try Luma` before "Colour and display".

- [ ] **Step 6: Commit**

```bash
git add web/src/Hero.tsx web/src/hero.css web/src/App.tsx web/src/HomeView.tsx web/src/app.css web/tests/hero.spec.ts
git commit -m "Match the landing hero to the mobile and desktop designs."
```

---

### Task 6: Docs and a full check

**Files:**
- Modify: `README.md` (the AI voice sentences that say the feature is off until opted in, and the Settings bullet that says "Try AI voice (experimental)")

**Interfaces:**
- Consumes: the behaviour from Tasks 3 and 4
- Produces: README text that matches the UI

- [ ] **Step 1: Update the sentences**

Replace the Settings bullet's "Try AI voice (experimental), off by default" with: Voice guidance is Luma voice or screen reader. Luma voice is used for every spoken instruction. Test Luma voice is the only sample button. The device voice speaks only when Luma voice cannot start.

Replace the AI voice section's opt-in sentence the same way. Keep the Gemini and ElevenLabs facts, the 1.5 second start limit, prefetch, and the iPhone unlock.

- [ ] **Step 2: Run the voice, loader, and hero tests**

Run: `npx playwright test web/tests/loader.spec.ts web/tests/hero.spec.ts web/tests/speech-ui.spec.ts web/tests/speech.spec.ts --reporter=line`

Expected: PASS

Run: `npx tsc -b --noEmit`

Expected: exit 0

Run: `.venv/bin/python -m pytest -q backend`

Expected: the existing tests pass. This plan does not change Python.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document Luma voice as the default and the device voice as the fallback."
```

---

## Self-review

- Spec coverage: loader for route planning, place search, report location, report save, key save/check, and startup are Tasks 1 and 2. Removing Test voice and the experimental section, and making the device voice the last resort, are Tasks 3 and 4. Both heroes are Task 5. Luma voice for every `speak()` caller is Task 3, because navigation, compass, home, and reports all call `speak`.
- Placeholder scan: no TBD, TODO, or "similar to Task N".
- Type consistency: `LumaLoader({ label, size })` is the same in Tasks 1 and 2. `speak(text, aiText?)` stays the call signature. `aiVoice` is removed in Task 3 and is not referenced again. `Test Luma voice` is the only sample button name in Tasks 3 and 4.
