import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import type { Route } from "../model";
import { saved } from "../model";
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
  const {
    result,
    compassHeading,
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
    haptics: saved("compass-haptics", true),
    voice: saved("compass-voice", true) && !screenReader,
    config: defaults,
    speak,
  });
  useEffect(() => {
    void requestCompass(entry.permission);
    backButton.current?.focus();
  }, [entry]);
  const heading =
    compassHeading === null ? null : Math.round(compassHeading) % 360;
  const direction =
    heading === null ? "" : directions[Math.round(heading / 45) % 8];
  const accessibleText =
    heading === null
      ? "Compass heading unavailable. " + (compassReason || result.reason)
      : `Compass. ${heading} degrees ${direction}. ${northReference === "true" ? "True north" : "Magnetic north"}.${compassWarning ? " Approximate reading. " + compassWarning : ""}`;
  return createPortal(
    <section
      className="compass-fullscreen"
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
          backButton.current?.focus();
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
      <div className="compass-center">
        <div
          className="compass-face"
          role="img"
          aria-label={accessibleText}
          data-heading={heading ?? "unknown"}
        >
          <svg viewBox="0 0 320 320" aria-hidden="true" focusable="false">
            <circle cx="160" cy="160" r="151" className="compass-rim" />
            <g transform={`rotate(${-(compassHeading ?? 0)} 160 160)`}>
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
                  transform={`rotate(${compassHeading ?? 0} ${x} ${y})`}
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
          {heading === null
            ? compassReason
              ? sensorMessage(compassReason)
              : "Waiting for compass"
            : compassWarning
              ? sensorMessage(compassWarning)
              : result.state === "UNCERTAIN"
                ? northReference === "true"
                  ? "True north"
                  : "Magnetic north"
                : labels[result.state]}
          <span className="sr-only">
            . {compassReason || compassWarning || result.reason}
            {!hapticsAvailable ? " Vibration unavailable in this browser." : ""}
          </span>
        </p>
      </div>
    </section>,
    document.body,
  );
}
