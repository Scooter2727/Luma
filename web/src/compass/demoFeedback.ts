import type { TargetState } from "./targetDemo";
import { acquirePlaybackSession } from "./audioSession";

export const pulseIntervals = { off: 450, adjust: 1250 };
type PulseState = "off" | "adjust";
export class DemoFeedback {
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private nodes = new Set<OscillatorNode>();
  private mode = "";
  private disposed = false;
  private lastPulse = -Infinity;
  private releaseSession: (() => void) | null = null;
  private onFailure: () => void;
  constructor(onFailure: () => void) {
    this.onFailure = onFailure;
  }
  // Called synchronously by Start demo / Sound on, never by a sensor callback.
  async unlock(): Promise<boolean> {
    try {
      const C =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!C || this.disposed) return false;
      // Safari otherwise treats Web Audio as ambient, including silent mode.
      this.releaseSession ??= acquirePlaybackSession();
      if (this.context && ["closed", "interrupted"].includes(this.context.state)) {
        void this.context.close().catch(() => {});
        this.context = null;
      }
      this.context ??= new C();
      const context = this.context;
      // Prime the output during the tap, before sensor callbacks start beeps.
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
      oscillator.connect(gain);
      gain.connect(context.destination);
      this.nodes.add(oscillator);
      oscillator.onended = () => { this.nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start();
      oscillator.stop(context.currentTime + 0.1);
      this.lastPulse = performance.now();
      let timeout = 0;
      try {
        await Promise.race([
          context.resume(),
          new Promise((_, reject) => { timeout = window.setTimeout(() => reject(new Error("Audio did not start")), 2000); }),
        ]);
      } finally { clearTimeout(timeout); }
      return !this.disposed && this.context.state === "running";
    } catch {
      return false;
    }
  }
  set(state: TargetState, sound: boolean, haptics: boolean) {
    const mode = `${state}:${sound}:${haptics}`;
    if (mode === this.mode || this.disposed) return;
    this.stop();
    this.mode = mode;
    if (state !== "off" && state !== "adjust") return;
    const pulse = () => {
      if (this.disposed || document.hidden || this.mode !== mode) return;
      const elapsed = performance.now() - this.lastPulse;
      if (elapsed < 300) {
        this.timer = window.setTimeout(pulse, 300 - elapsed);
        return;
      }
      this.lastPulse = performance.now();
      if (sound) this.beep(state);
      if (haptics && typeof navigator.vibrate === "function") {
        try {
          navigator.vibrate(state === "off" ? 70 : 40);
        } catch {}
      }
      this.timer = window.setTimeout(pulse, pulseIntervals[state]);
    };
    pulse();
  }
  private beep(state: PulseState) {
    const context = this.context;
    if (!context || context.state !== "running") {
      this.onFailure();
      return;
    }
    try {
      const now = context.currentTime,
        oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = state === "off" ? 740 : 520;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      oscillator.connect(gain);
      gain.connect(context.destination);
      this.nodes.add(oscillator);
      oscillator.onended = () => {
        this.nodes.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(now);
      oscillator.stop(now + 0.1);
    } catch {
      this.onFailure();
    }
  }
  stop() {
    this.mode = "";
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {}
    }
    this.nodes.clear();
    try {
      navigator.vibrate?.(0);
    } catch {}
  }
  release() {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.releaseSession?.();
    this.releaseSession = null;
  }
  dispose() {
    this.release();
    this.disposed = true;
  }
}
