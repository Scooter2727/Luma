import { angleDifference, normalize } from "./orientationEngine";

export type TargetState = "waiting" | "off" | "adjust" | "on";
export type TargetSnapshot = {
  target: number;
  state: TargetState;
  difference: number | null;
  heldMs: number;
  round: number;
  advanced: boolean;
};
export const targetLabels = {
  waiting: "Waiting for compass",
  off: "Off target",
  adjust: "Small adjustment",
  on: "On track",
};
export function randomTarget(heading: number | null, random = Math.random) {
  return normalize(
    Math.round(
      heading === null ? random() * 360 : heading + 60 + random() * 240,
    ),
  );
}

// This is a stationary pointing game, independent of any pedestrian route/GPS.
export class TargetDemo {
  private target: number;
  private alignedAt: number | null = null;
  private lastTick: number | null = null;
  private round = 1;
  private state: TargetState = "waiting";
  constructor(
    heading: number | null,
    private random = Math.random,
  ) {
    this.target = randomTarget(heading, random);
  }
  update(heading: number | null, now: number, paused = false): TargetSnapshot {
    if (
      this.lastTick !== null &&
      (now - this.lastTick > 600 || now < this.lastTick)
    )
      this.alignedAt = null;
    this.lastTick = now;
    const valid = !paused && heading !== null && Number.isFinite(heading);
    const difference = valid ? angleDifference(heading!, this.target) : null;
    const error = difference === null ? Infinity : Math.abs(difference);
    const state: TargetState = !valid
      ? "waiting"
      : error <= (this.state === "on" ? 19 : 15)
        ? "on"
        : error <= (this.state === "adjust" ? 40 : 35)
          ? "adjust"
          : "off";
    this.state = state;
    if (state === "on") this.alignedAt ??= now;
    else this.alignedAt = null;
    const heldMs =
      this.alignedAt === null
        ? 0
        : Math.min(3000, Math.max(0, now - this.alignedAt));
    if (heldMs >= 3000) {
      this.target = randomTarget(heading!, this.random);
      this.alignedAt = null;
      this.round++;
      this.state = "off";
      return {
        target: this.target,
        state: "off",
        difference: angleDifference(heading!, this.target),
        heldMs: 0,
        round: this.round,
        advanced: true,
      };
    }
    return {
      target: this.target,
      state,
      difference,
      heldMs,
      round: this.round,
      advanced: false,
    };
  }
}
