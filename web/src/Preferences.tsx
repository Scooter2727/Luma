import { useEffect, useRef, useState } from "react";
import { useScreenTransition } from "./useScreenTransition";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Compass,
  ChevronsLeftRight,
  Volume2,
  Minus,
  Plus,
  Eye,
  Headphones,
  Lock,
  SlidersHorizontal,
} from "lucide-react";
import { CrosswalkIcon } from "./Icons";
import { logoForTheme } from "./brand";
import type { Preferences } from "./model";
export type PreferenceProps = {
  prefs: Preferences;
  change: (values: Partial<Preferences>) => void;
  speak: (text: string) => void;
};
export const themes = [
  { id: "default", name: "Luma", colors: ["#5865F2", "#FF8A4C", "#2CCBA8"] },
  {
    id: "red-green",
    name: "Red–green friendly",
    colors: ["#0072B2", "#E69F00", "#17212F"],
  },
  {
    id: "blue-yellow",
    name: "Blue–yellow friendly",
    colors: ["#9B3658", "#254653", "#F0F0EB"],
  },
  {
    id: "contrast",
    name: "High contrast",
    colors: ["#000", "#FFF", "#FFD600"],
  },
];
export function DirectionsChoices({
  prefs,
  change,
}: Pick<PreferenceProps, "prefs" | "change">) {
  return (
    <fieldset className="choices">
      <legend className="sr-only">Directions style</legend>
      {(
        [
          {
            id: "clock",
            label: "Clock",
            description: "“Toward 2 o’clock”",
            icon: Clock,
          },
          {
            id: "left-right",
            label: "Left / right",
            description: "“Slightly right”",
            icon: ChevronsLeftRight,
          },
          {
            id: "cardinal",
            label: "Cardinal directions",
            description: "“Head northeast”",
            icon: Compass,
          },
        ] as const
      ).map((c) => (
        <label
          className={"choice " + (prefs.directions === c.id ? "selected" : "")}
          key={c.id}
        >
          <input
            type="radio"
            name="directions-style"
            value={c.id}
            checked={prefs.directions === c.id}
            onChange={() => change({ directions: c.id })}
          />
          <c.icon size={50} />
          <span>
            <strong>{c.label}</strong>
            <small>{c.description}</small>
          </span>
          {prefs.directions === c.id && <Check size={32} />}
        </label>
      ))}
    </fieldset>
  );
}
export function CrossingChoices({
  prefs,
  change,
}: Pick<PreferenceProps, "prefs" | "change">) {
  return (
    <div className="crossing-options">
      {(
        [
          {
            key: "audible",
            label: "Prefer audible crossings",
            detail: "Prioritize intersections with listed audible signals.",
          },
          {
            key: "fewer",
            label: "Prefer fewer crossings",
            detail: "Allow a longer walk to reduce crossings.",
          },
          {
            key: "tactile",
            label: "Prefer mapped tactile paving",
            detail:
              "Prioritize mapped tactile surfaces near crossing endpoints.",
          },
        ] as const
      ).map((c) => (
        <label className="toggle-card" key={c.key}>
          <span>
            <strong>{c.label}</strong>
            <small>{c.detail}</small>
          </span>
          <input
            type="checkbox"
            checked={prefs[c.key]}
            onChange={(e) => change({ [c.key]: e.target.checked })}
          />
        </label>
      ))}
    </div>
  );
}
export function DisplayChoices({
  prefs,
  change,
}: Pick<PreferenceProps, "prefs" | "change">) {
  return (
    <div className="display-options">
      <div className="theme-grid" role="group" aria-label="Colour theme">
        {themes.map((t) => (
          <button
            key={t.id}
            className={
              "theme-choice " + (prefs.theme === t.id ? "selected" : "")
            }
            aria-pressed={prefs.theme === t.id}
            onClick={() => change({ theme: t.id })}
          >
            <span className="swatches" aria-hidden="true">
              {t.colors.map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            {t.name}
          </button>
        ))}
      </div>
      <label className="toggle-card">
        <span>
          <strong>Larger text</strong>
          <small>Increase text size throughout the interface.</small>
        </span>
        <input
          type="checkbox"
          checked={prefs.large}
          onChange={(e) => change({ large: e.target.checked })}
        />
      </label>
    </div>
  );
}
export function SpeedCard({ prefs, change, speak }: PreferenceProps) {
  return (
    <section className="speed-card" aria-labelledby="speed-heading">
      <h2 id="speed-heading">Speech speed</h2>
      <div className="speed-controls">
        <button
          aria-label="Slower"
          disabled={prefs.rate <= 0.6}
          onClick={() =>
            change({
              rate: Math.max(0.6, Math.round((prefs.rate - 0.1) * 10) / 10),
            })
          }
        >
          <Minus size={38} />
        </button>
        <output aria-live="polite">{prefs.rate.toFixed(1)}×</output>
        <button
          aria-label="Faster"
          disabled={prefs.rate >= 2}
          onClick={() =>
            change({
              rate: Math.min(2, Math.round((prefs.rate + 0.1) * 10) / 10),
            })
          }
        >
          <Plus size={38} />
        </button>
      </div>
      <button
        className="voice-test"
        onClick={() =>
          speak(
            "This is a sample Luma instruction. Turn right onto Queen Street West.",
          )
        }
      >
        <Volume2 size={30} />
        Test voice
      </button>
    </section>
  );
}
export function Onboarding(
  props: PreferenceProps & { done: () => void; active?: boolean },
) {
  const { prefs, change, speak, done, active = true } = props;
  const [step, setStep] = useState(1);
  const body = useRef<HTMLDivElement>(null);
  useScreenTransition(body, step, active);
  useEffect(() => {
    if (active) body.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [step, active]);
  const titles = [
    "Colour and display",
    "Voice guidance",
    "Directions style",
    "Crossing preferences",
    "Ready to use Luma",
  ];
  return (
    <section className="onboarding" aria-label="Set up Luma">
      <header className="setup-header">
        <img src={logoForTheme(prefs.theme)} alt="" />
        <strong>Luma</strong>
      </header>
      <div className="setup-progress" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= step ? "complete" : ""} />
        ))}
      </div>
      <div className="setup-body" ref={body}>
        <h1 tabIndex={-1} key={step}>
          {titles[step - 1]}
        </h1>
        {step === 1 && <DisplayChoices {...props} />}
        {step === 2 && (
          <>
            <p>Choose how to hear directions.</p>
            <fieldset className="choices">
              <legend className="sr-only">Voice guidance</legend>
              {[
                {
                  reader: false,
                  label: "Luma voice",
                  detail: "Read instructions aloud.",
                  icon: Volume2,
                },
                {
                  reader: true,
                  label: "Screen reader",
                  detail: "Use your screen reader’s announcements.",
                  icon: Headphones,
                },
              ].map((c) => (
                <label
                  key={c.label}
                  className={
                    "choice " +
                    (prefs.screenReader === c.reader ? "selected" : "")
                  }
                >
                  <input
                    type="radio"
                    name="voice-guidance"
                    checked={prefs.screenReader === c.reader}
                    onChange={() => change({ screenReader: c.reader })}
                  />
                  <c.icon size={46} />
                  <span>
                    <strong>{c.label}</strong>
                    <small>{c.detail}</small>
                  </span>
                  {prefs.screenReader === c.reader && <Check size={28} />}
                </label>
              ))}
            </fieldset>
          </>
        )}
        {step === 3 && <DirectionsChoices {...props} />}{" "}
        {step === 4 && <CrossingChoices {...props} />}{" "}
        {step === 5 && (
          <div className="setup-summary">
            <svg className="setup-checkmark" width="144" height="144" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 4 4L19 6" pathLength="1" />
            </svg>
          </div>
        )}
        {(step === 2 || step === 3) && (
          <button
            className="outline-button test-setup"
            onClick={() =>
              speak(
                step === 3
                  ? prefs.directions === "cardinal"
                    ? "Head northeast along Queen Street. Continue 50 metres."
                    : prefs.directions === "clock"
                      ? "Toward 2 o’clock. Continue 50 metres."
                      : "Turn slightly right. Continue 50 metres."
                  : "Luma voice guidance. Your next crossing is ahead.",
              )
            }
          >
            <Volume2 size={32} />
            Test voice
          </button>
        )}
        <div className="setup-actions">
          <button
            className="outline-button"
            disabled={step === 1}
            onClick={() => setStep((s) => s - 1)}
          >
            <ArrowLeft />
            Back
          </button>
          <button
            className="dark-button"
            onClick={() => (step === 5 ? done() : setStep((s) => s + 1))}
          >
            {step === 5 ? "Use Luma" : "Next"}
            <ArrowRight />
          </button>
        </div>
      </div>
    </section>
  );
}
export function Settings(
  props: PreferenceProps & {
    repeatSetup: () => void;
    children?: React.ReactNode;
  },
) {
  const [section, setSection] = useState("");
  const content = useRef<HTMLDivElement>(null);
  useScreenTransition(content, section);
  const groups = [
    { id: "voice", label: "Voice", icon: Volume2 },
    { id: "directions", label: "Directions", icon: Clock },
    { id: "crossings", label: "Crossings", icon: CrosswalkIcon },
    { id: "display", label: "Display", icon: Eye },
    { id: "reader", label: "Screen reader", icon: Headphones },
    { id: "privacy", label: "Privacy", icon: Lock },
  ];
  return (
    <div className="settings-content" ref={content}>
      {section ? (
        <header className="page-header">
          <button
            className="back-button"
            aria-label="Back to settings"
            onClick={() => setSection("")}
          >
            <ArrowLeft />
          </button>
          <h1>{groups.find((g) => g.id === section)?.label}</h1>
        </header>
      ) : (
        <header className="page-header">
          <img src={logoForTheme(props.prefs.theme)} alt="" />
          <h1>Settings</h1>
        </header>
      )}
      {!section && (
        <>
          <SpeedCard {...props} />
          <div className="settings-grid">
            {groups.map((g) => (
              <button key={g.id} onClick={() => setSection(g.id)}>
                <g.icon size={38} />
                {g.label}
              </button>
            ))}
          </div>
        </>
      )}
      {section === "voice" && <SpeedCard {...props} />}{" "}
      {section === "directions" && (
        <>
          <DirectionsChoices {...props} />
          <p className="helper">
            Clock directions describe turns relative to the previous route
            segment. They do not measure which way your phone is facing.
          </p>
        </>
      )}
      {section === "crossings" && <CrossingChoices {...props} />}{" "}
      {section === "display" && <DisplayChoices {...props} />}{" "}
      {section === "reader" && (
        <label className="toggle-card">
          <span>
            <strong>Screen reader announcements</strong>
            <small>Use announcements instead of Luma’s spoken voice.</small>
          </span>
          <input
            type="checkbox"
            checked={props.prefs.screenReader}
            onChange={(e) => props.change({ screenReader: e.target.checked })}
          />
        </label>
      )}
      {section === "privacy" && (
        <>
          <h2>Stored information</h2>
          <p>
            Preferences, saved destinations, last trip and report history are
            stored in this browser. Where report saving is available, saved
            reports are also stored on this prototype’s server. Reporting
            availability is shown before saving. Saved reports are unverified
            and are not sent to the City.
          </p>
          <p>
            GPS and microphone access are requested only when you use those
            controls. Browser speech recognition may use your browser provider’s
            speech service.
          </p>
          <button className="outline-button" onClick={props.repeatSetup}>
            <SlidersHorizontal />
            Repeat setup
          </button>
          {props.children}
          <details className="about-data">
            <summary>About &amp; data</summary>
            <p>
              Luma is a navigation prototype. Toronto accessibility information
              comes from the City, TTC, and cited providers. Tactile mapping
              includes OpenStreetMap data distributed by EmbedEarth.
            </p>
            <p>
              Map: <a href="https://openfreemap.org/">OpenFreeMap</a> · ©{" "}
              <a href="https://openmaptiles.org/">OpenMapTiles</a> · ©{" "}
              <a href="https://www.openstreetmap.org/copyright">
                OpenStreetMap contributors
              </a>
              . City data uses the{" "}
              <a href="https://open.toronto.ca/open-data-license/">
                Open Government Licence – Toronto
              </a>
              .
            </p>
          </details>
        </>
      )}
    </div>
  );
}
