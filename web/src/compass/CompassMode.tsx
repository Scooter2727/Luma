import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Play, Square, Volume2, VolumeX } from "lucide-react";
import type { Route } from "../model";
import { saved } from "../model";
import { useTargetDemo } from "./useTargetDemo";
import { targetLabels } from "./targetDemo";
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
  if (reason.includes("accuracy")) return "Compass accuracy is low";
  return "Compass unavailable";
}
export default function CompassMode({
  route,
  entry,
  screenReader,
  speak,
  back,
}: {
  route: Route;
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
  const {
    result,
    readHeading,
    compassReason,
    compassWarning,
    northReference,
    requestCompass,
    hapticsAvailable,
  } = useOrientationTracking({
    route,
    enabled: true,
    pointing: true,
    simulation: live,
    haptics: !demoRunning && saved("compass-haptics", true),
    voice: !demoRunning && saved("compass-voice", true) && !screenReader,
    config: defaults,
    speak,
  });
  const targetGame = useTargetDemo(readHeading, saved("compass-haptics", true));
  const demo = targetGame.demo;
  const demoState = demo?.state ?? "idle";
  const targetX = demo
    ? 160 + 143 * Math.sin((demo.target * Math.PI) / 180)
    : 0;
  const targetY = demo
    ? 160 - 143 * Math.cos((demo.target * Math.PI) / 180)
    : 0;
  const turn =
    demo?.difference !== null &&
    demo?.difference !== undefined &&
    demo.difference > 0
      ? "left"
      : "right";
  const demoStatus = demo
    ? demo.state === "waiting"
      ? compassReason || compassWarning
        ? sensorMessage(compassReason || compassWarning)
        : "Waiting for compass"
      : demo.state === "on"
        ? `On track · Hold ${Math.ceil((3000 - demo.heldMs) / 1000)} s`
        : `${targetLabels[demo.state]} · Turn phone ${turn}`
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
    chrome.content = getComputedStyle(document.documentElement)
      .getPropertyValue("--surface")
      .trim();
    return () => {
      chrome.content = previous;
    };
  }, []);
  const heading = useCompassDial(face, readHeading);
  const direction =
    heading === null ? "" : directions[Math.round(heading / 45) % 8];
  const accessibleText =
    heading === null
      ? "Compass heading unavailable. " + (compassReason || result.reason)
      : `Compass. ${heading} degrees ${direction}. ${northReference === "true" ? "True north" : "Magnetic north"}.${compassWarning ? " Approximate reading. " + compassWarning : ""}`;
  const targetDescription = demo
    ? ` Demo target ${Math.round(demo.target)} degrees. ${demoStatus}.`
    : "";
  return createPortal(
    <section
      ref={modal}
      className="compass-fullscreen"
      data-demo-running={!!demo}
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
                  ["N", 160, 72],
                  ["E", 257, 171],
                  ["S", 160, 270],
                  ["W", 63, 171],
                ] as const
              ).map(([name, x, y]) => (
                <text
                  key={name}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  className={
                    name === "N" ? "compass-cardinal north" : "compass-cardinal"
                  }
                >
                  {name}
                </text>
              ))}
              {heading !== null && (
                <>
                  <path
                    d="M160 88 145 146 160 137 175 146Z"
                    className="compass-needle-north"
                  />
                  <path
                    d="M160 232 145 174 160 183 175 174Z"
                    className="compass-needle-south"
                  />
                </>
              )}
              {demo && (
                <g className="compass-target">
                  <circle cx={targetX} cy={targetY} r="12" />
                  <circle cx={targetX} cy={targetY} r="4" />
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
            <>
              <span className="compass-demo-label">Pointing demo</span>
              {demoStatus}
            </>
          ) : heading === null ? (
            compassReason ? (
              sensorMessage(compassReason)
            ) : (
              "Waiting for compass"
            )
          ) : compassWarning ? (
            sensorMessage(compassWarning)
          ) : result.state === "UNCERTAIN" ? (
            northReference === "true" ? (
              "True north"
            ) : (
              "Magnetic north"
            )
          ) : (
            labels[result.state]
          )}
          <span className="sr-only">
            . {compassReason || compassWarning || (demo ? "" : result.reason)}
            {!hapticsAvailable ? " Vibration unavailable in this browser." : ""}
          </span>
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
          <p role="status">
            {targetGame.audioError
              ? "Tap Sound off to enable audio."
              : !hapticsAvailable
                ? "Beeps only · vibration unavailable"
                : "Vibration on supported devices"}
          </p>
        </div>
      )}
    </section>,
    document.body,
  );
}
