import { useEffect, useRef } from "react";
import { acquirePlaybackSession } from "./compass/audioSession";

type Cue = "tap" | "select" | "start" | "stop";
const notes: Record<Cue, number[]> = {
  tap: [440, 660], select: [520, 780], start: [440, 660, 880], stop: [660, 440],
};

class InterfaceSounds {
  private context: AudioContext | null = null;
  private release: (() => void) | null = null;
  private idle = 0;
  private generation = 0;
  private nodes = new Set<OscillatorNode>();
  play(cue: Cue) {
    const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor || document.hidden) return;
    try {
      clearTimeout(this.idle);
      this.context ??= new Constructor();
      this.release ??= acquirePlaybackSession();
      const context = this.context, generation = this.generation;
      const sound = () => {
        if (generation !== this.generation || context.state !== "running") return;
        clearTimeout(this.idle);
        const now = context.currentTime;
        notes[cue].forEach((frequency, index) => {
          const start = now + index * 0.024;
          const oscillator = context.createOscillator(), gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(0.001, start);
          gain.gain.exponentialRampToValueAtTime(0.055, start + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.075);
          oscillator.connect(gain); gain.connect(context.destination);
          this.nodes.add(oscillator);
          oscillator.onended = () => { this.nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(start); oscillator.stop(start + 0.085);
        });
        // Release the iOS playback session promptly after short feedback.
        this.idle = window.setTimeout(() => this.stop(), 300);
      };
      if (context.state === "running") sound();
      else {
        this.idle = window.setTimeout(() => this.stop(), 1500);
        void context.resume().then(sound).catch(() => { if (generation === this.generation) this.stop(); });
      }
    } catch { this.stop(); }
  }
  stop() {
    this.generation++;
    clearTimeout(this.idle);
    this.nodes.forEach(node => { try { node.stop(); } catch {} });
    this.nodes.clear();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.release?.(); this.release = null;
  }
}

export function useInterfaceSounds(enabled: boolean) {
  const currentEnabled = useRef(enabled);
  currentEnabled.current = enabled;
  const controller = useRef<InterfaceSounds | null>(null);
  useEffect(() => { if (!enabled) controller.current?.stop(); }, [enabled]);
  useEffect(() => {
    const sounds = new InterfaceSounds();
    controller.current = sounds;
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>("button,a[href],summary,input,select,[role=button]");
      if (!target || target.closest("[inert]") || target.matches(":disabled,[aria-disabled=true],input[type=hidden]")) return;
      const soundToggle = target.matches("[data-sound-toggle]");
      if (soundToggle && !(target as HTMLInputElement).checked) { sounds.stop(); return; }
      if (!currentEnabled.current && !soundToggle) return;
      const label = target.getAttribute("aria-label") || target.textContent || "";
      const cue: Cue = /pause|stop|end route/i.test(label) ? "stop"
        : /play|start demo|try luma/i.test(label) ? "start"
        : target.matches("input[type=checkbox],input[type=radio],select,[aria-pressed]") || target.closest(".choices,.theme-grid") ? "select" : "tap";
      sounds.play(cue);
    };
    const visibility = () => { if (document.hidden) sounds.stop(); };
    document.addEventListener("click", click, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("visibilitychange", visibility);
      sounds.stop();
      controller.current = null;
    };
  }, []);
}
