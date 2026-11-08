import { useRef, useState } from "react";
import CompassMode from "./compass/CompassMode";
import { requestCompassAccess } from "./compass/sensors";
import {
  ArrowRight,
  Navigation,
  Bus,
  RotateCcw,
  Pause,
  Play,
  Compass,
  ChevronsRight,
  X,
  Flag,
} from "lucide-react";
import type { Coord, Preferences, Route } from "./model";
import { aiInstructionText, instructionText, saved, timeLabel } from "./model";
import { cancelAllSpeech } from "./speech";
type Props = {
  route: Route;
  step: number;
  prefs: Preferences;
  playing: boolean;
  togglePlaying: () => void;
  speak: (text: string, aiText?: string) => void;
  next: () => void;
  end: () => void;
  where: () => void;
  report: () => void;
  notice: string;
  pausePreview: () => void;
  reroute: (coordinates: Coord) => void;
};
export default function NavigationView({
  route,
  step,
  prefs,
  playing,
  togglePlaying,
  speak,
  end,
  report,
  pausePreview,
}: Props) {
  const [compassEntry, setCompassEntry] = useState<{
    permission: Promise<string | null>;
  } | null>(null);
  const compassButton = useRef<HTMLButtonElement>(null);
  const s = route.steps[step],
    upcoming = route.steps[step + 1];
  const text = instructionText(s, route.steps[step - 1], prefs.directions);
  const aiText = aiInstructionText(route, step, prefs.directions);
  const summary =
    prefs.directions === "left-right" ? s.title : text.split(". ")[0];
  const isBus = ["wait", "board", "ride", "alight"].includes(s.kind);
  const distanceLabel = s.scheduled_time
    ? timeLabel(s.scheduled_time) + " scheduled"
    : s.distance > 0
      ? s.distance + " m"
      : s.kind === "arrive"
        ? "Arrival"
        : "Next instruction";
  function openCompass() {
    // iOS motion permission must originate in this tap, not a mount effect.
    const permission = requestCompassAccess();
    pausePreview();
    if (saved("compass-voice", true))
      speak(
        "Compass mode. Stop somewhere safe. Hold your phone flat in portrait, with the top pointing forward.",
      );
    setCompassEntry({ permission });
  }
  function closeCompass() {
    setCompassEntry(null);
    cancelAllSpeech();
    window.requestAnimationFrame(() => compassButton.current?.focus());
  }
  if (compassEntry)
    return (
      <CompassMode
        route={route}
        screenReader={prefs.screenReader}
        speak={speak}
        entry={compassEntry}
        back={closeCompass}
      />
    );
  return (
    <section
      className={"navigation-screen " + (s.crossing ? "crossing-screen" : "")}
      aria-label={s.crossing ? "At the crossing" : "Route preview"}
    >
      <h1 className="sr-only" tabIndex={-1}>
        {s.crossing ? "At the crossing" : "Active navigation preview"}
      </h1>
      {s.crossing ? (
        <>
          <button className="crossing-repeat" onClick={() => speak(text, aiText)}>
            <span className="crossing-heading">
              <span className="crossing-label">CROSSING</span>
              <strong>
                {s.street || s.title.replace(/^Cross /, "").split(" at ")[0]}
              </strong>
            </span>
            <span className="crossing-caution">
              Check traffic and the signal before crossing.
            </span>
            <span className="repeat-label">
              <RotateCcw size={30} />
              Tap anywhere to repeat
            </span>
          </button>
        </>
      ) : (
        <>
          <div className="navigation-instruction">
            {isBus ? (
              <Bus size={56} />
            ) : s.title.toLowerCase().includes("right") ? (
              <ArrowRight size={56} />
            ) : (
              <Navigation size={56} />
            )}
            <span>
              <strong>{distanceLabel}</strong>
              <span className="instruction-summary">{summary}</span>
            </span>
          </div>
          <div
            className="navigation-controls"
            role="group"
            aria-label="Navigation controls"
          >
            <button className="repeat-control" onClick={() => speak(text, aiText)}>
              <RotateCcw size={60} />
              Repeat
            </button>
            <button onClick={togglePlaying}>
              {playing ? <Pause size={60} /> : <Play size={60} />}{" "}
              {playing ? "Pause" : "Play preview"}
            </button>
            <button ref={compassButton} className="where-control" onClick={openCompass}>
              <Compass size={60} />
              <span>Compass</span>
            </button>
            <button
              onClick={() =>
                speak(
                  upcoming
                    ? "Next: " + instructionText(upcoming, s, prefs.directions)
                    : "This is the last instruction. Confirm the destination entrance.",
                )
              }
            >
              <ChevronsRight size={60} />
              <span>
                What’s
                <br />
                next
              </span>
            </button>
          </div>
        </>
      )}
      <footer className="navigation-footer">
        <button className="outline-button end-route" onClick={end}>
          <X size={28} />
          End route
        </button>
        <button
          className="icon-button"
          aria-label="Report a problem"
          onClick={report}
        >
          <Flag size={25} />
        </button>
      </footer>
    </section>
  );
}
