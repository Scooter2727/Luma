import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Play, Square, Volume2, VolumeX } from "lucide-react";
import type { Route } from "../model";
import { saved, request } from "../model";
import { freshFix } from "./orientationEngine";
import { useTargetDemo } from "./useTargetDemo";
import { useCompassDial } from "./useCompassDial";
import { useScreenTransition } from "../useScreenTransition";
import {
  defaults,
  labels,
  useOrientationTracking,
} from "./useOrientationTracking";

const live = {
  enabled: false,
  gpsHeading: 0,
  compassHeading: 0,
  expected: 0,
  accuracy: 5,
  speed: 0,
  reliableCompass: true,
};
const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function sensorMessage(reason: string) {
  if (reason.includes("HTTPS")) return "Open Luma over HTTPS";
  if (reason.includes("permission")) return "Allow Motion and Orientation";
  if (reason.includes("Rotate")) return "Rotate phone to portrait";
  if (reason.includes("Hold the phone")) return "Hold phone flatter";
  if (reason.includes("calibration")) return "Compass needs calibration";
  if (reason.includes("No compass readings"))
    return "Move phone gently to start compass";
  if (reason.includes("accuracy is unavailable"))
    return "Compass accuracy unavailable";
  if (reason.includes("accuracy")) return "";
  return "Compass unavailable";
}
export default function CompassMode({
  route,
  entry,
  screenReader,
  speak,
  back,
}: {
  route?: Route;
  entry: { permission: Promise<string | null> };
  screenReader: boolean;
  speak: (text: string) => void;
  back: () => void;
}) {
  const backButton = useRef<HTMLButtonElement>(null);
  const modal = useRef<HTMLElement>(null);
  const face = useRef<HTMLDivElement>(null);
  useScreenTransition(modal, "compass", true, false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [road, setRoad] = useState<string | null>(null);
  const {
    result,
    readHeading,
    compassReason,
    compassWarning,
    northReference,
    requestCompass,
    hapticsAvailable,
    fix,
  } = useOrientationTracking({
    route,
    enabled: true,
    pointing: true,
    simulation: live,
    haptics: !demoRunning && saved("compass-haptics", true),
    voice: !demoRunning && saved("compass-voice", true) && !screenReader,
    config: defaults,
    speak: (text: string): void => {
      if (text.startsWith("Direction uncertain.")) return;
      speak(text);
    },
  });
  const roadKey = fix && freshFix(fix, Date.now())
    ? `${fix.coordinates[0].toFixed(4)},${fix.coordinates[1].toFixed(4)}`
    : null;
  useEffect(() => {
    setRoad(null);
    if (!roadKey) return;
    const controller = new AbortController();
    const [longitude, latitude] = roadKey.split(",");
    const timer = window.setTimeout(() => {
      request<{ street: string | null }>(
        `/api/current-road?longitude=${longitude}&latitude=${latitude}`,
        { signal: controller.signal },
      ).then((value) => { if (!controller.signal.aborted) setRoad(value.street); })
        .catch(() => {});
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [roadKey]);
  // This stationary game can use the same approximate heading as the dial.
  // Route alignment keeps its stricter tilt/accuracy checks.
  const demoHeading = useCallback(() => {
    const sample = readHeading();
    return { heading: sample.heading, reliable: sample.heading !== null };
  }, [readHeading]);
  const targetGame = useTargetDemo(demoHeading, saved("compass-haptics", true));
  const demo = targetGame.demo;
  const demoState = demo?.state ?? "idle";
  const targetX = demo
    ? 160 + 130 * Math.sin((demo.target * Math.PI) / 180)
    : 0;
  const targetY = demo
    ? 160 - 130 * Math.cos((demo.target * Math.PI) / 180)
    : 0;
  const demoStatus = demo
    ? demo.state === "waiting"
      ? compassReason || compassWarning
        ? sensorMessage(compassReason || compassWarning)
        : ""
      : ""
    : "";
  useEffect(() => {
    void requestCompass(entry.permission);
    backButton.current?.focus();
  }, [entry]);
  useEffect(() => {
    const chrome = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!chrome) return;
    const previous = chrome.content;
    const previousBackground = document.documentElement.style.getPropertyValue("--viewport-background");
    chrome.content = getComputedStyle(document.documentElement)
      .getPropertyValue("--surface")
      .trim();
    document.documentElement.style.setProperty("--viewport-background", chrome.content);
    return () => {
      chrome.content = previous;
      document.documentElement.style.setProperty("--viewport-background", previousBackground);
    };
  }, []);
  const heading = useCompassDial(face, readHeading);
  const direction =
    heading === null ? "" : directions[Math.round(heading / 45) % 8];
  const accessibleText =
    heading === null
      ? "Compass heading unavailable. " + (compassReason || result.reason)
      : `Compass. ${heading} degrees ${direction}. ${northReference === "true" ? "True north." : ""}${compassWarning ? " Approximate reading. " + sensorMessage(compassWarning) : ""}`;
  const targetDescription = demo
    ? ` Demo target ${Math.round(demo.target)} degrees. ${demoStatus}.`
    : "";
  return createPortal(
    <section
      ref={modal}
      className="compass-fullscreen"
      data-demo-running={!!demo}
      data-demo-state={demoState}
      role="dialog"
      aria-modal="true"
      aria-label="Compass mode"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          back();
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const buttons = [
            ...(modal.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) || []),
          ];
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length
          ]?.focus();
        }
      }}
    >
      <h1 className="sr-only">Compass</h1>
      <button
        ref={backButton}
        className="compass-back outline-button"
        onClick={back}
      >
        <ArrowLeft size={28} aria-hidden="true" />
        Back
      </button>
      <button
        className="compass-demo-start outline-button"
        onClick={() => {
          if (demo) {
            targetGame.stop();
            setDemoRunning(false);
          } else {
            setDemoRunning(true);
            targetGame.start();
          }
        }}
      >
        {demo ? (
          <Square size={22} aria-hidden="true" />
        ) : (
          <Play size={22} aria-hidden="true" />
        )}
        {demo ? "Stop demo" : "Start demo"}
      </button>
      <div className="compass-center">
        <div
          ref={face}
          className="compass-face"
          data-demo-state={demoState}
          data-target={demo?.target}
          data-round={demo?.round}
          role="img"
          aria-label={accessibleText + targetDescription}
          data-heading={heading ?? "unknown"}
        >
          <svg viewBox="0 0 320 320" aria-hidden="true" focusable="false">
            <circle cx="160" cy="160" r="151" className="compass-rim" />
            {demo?.state === "on" && (
              <circle
                cx="160"
                cy="160"
                r="158"
                className="compass-hold-ring"
                strokeDasharray={2 * Math.PI * 158}
                strokeDashoffset={2 * Math.PI * 158 * (1 - demo.heldMs / 3000)}
                transform="rotate(-90 160 160)"
              />
            )}
            <g className="compass-rotor">
              {Array.from({ length: 32 }, (_, i) => (
                <line
                  key={i}
                  x1="160"
                  y1="20"
                  x2="160"
                  y2={i % 4 === 0 ? 37 : 28}
                  transform={`rotate(${i * 11.25} 160 160)`}
                  className={
                    i % 4 === 0 ? "compass-tick major" : "compass-tick"
                  }
                />
              ))}
              {(
                [
                  ["N", 160, 74],
                  ["E", 246, 160],
                  ["S", 160, 246],
                  ["W", 74, 160],
                ] as const
              ).map(([name, x, y]) => (
                <text
                  key={name}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={
                    name === "N" ? "compass-cardinal north" : "compass-cardinal"
                  }
                >
                  {name}
                </text>
              ))}
              {demo && (
                <g className="compass-target">
                  <circle className="target-halo" cx={targetX} cy={targetY} r="23" />
                  <circle className="target-disc" cx={targetX} cy={targetY} r="18" />
                  <circle className="target-center" cx={targetX} cy={targetY} r="7" />
                </g>
              )}
            </g>
            <path d="M151 1 169 1 160 14Z" className="compass-phone-marker" />
          </svg>
          <div className="compass-reading" aria-hidden="true">
            <strong>{heading === null ? "—" : `${heading}°`}</strong>
            <span>{direction || "No heading"}</span>
          </div>
        </div>
        <p
          className="compass-face-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {demo ? (
            demoStatus
          ) : heading === null ? (
            compassReason ? (
              sensorMessage(compassReason)
            ) : (
              null
            )
          ) : compassWarning && sensorMessage(compassWarning) ? (
            sensorMessage(compassWarning)
          ) : result.state === "UNCERTAIN" ? (
            northReference === "true" ? (
              "True north"
            ) : (
              null
            )
          ) : (
            labels[result.state]
          )}
          {road && <span className="compass-road">Near {road}</span>}
        </p>
      </div>
      {demo && (
        <div className="compass-demo-audio">
          <button
            className="outline-button"
            aria-pressed={targetGame.sound}
            aria-label={
              targetGame.sound
                ? "Sound on. Mute beeps"
                : "Sound off. Enable beeps"
            }
            onClick={targetGame.toggleSound}
          >
            {targetGame.sound ? (
              <Volume2 size={24} aria-hidden="true" />
            ) : (
              <VolumeX size={24} aria-hidden="true" />
            )}
            {targetGame.sound ? "Sound on" : "Sound off"}
          </button>
          {(targetGame.audioError || hapticsAvailable) && <p role="status">
            {targetGame.audioError
              ? "Tap Sound off to enable audio."
              : "Vibration on supported devices"}
          </p>}
        </div>
      )}
    </section>,
    document.body,
  );
}
