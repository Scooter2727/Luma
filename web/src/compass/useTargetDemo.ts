import { useEffect, useRef, useState } from "react";
import { DemoFeedback } from "./demoFeedback";
import { TargetDemo } from "./targetDemo";
import type { TargetSnapshot } from "./targetDemo";

export function useTargetDemo(
  source: () => { heading: number | null; reliable: boolean },
  haptics: boolean,
) {
  const [demo, setDemo] = useState<TargetSnapshot | null>(null);
  const [sound, setSound] = useState(false),
    [audioError, setAudioError] = useState(false);
  const latest = useRef({ source, haptics, sound });
  latest.current = { source, haptics, sound };
  const game = useRef<TargetDemo | null>(null),
    generation = useRef(0);
  const feedback = useRef<DemoFeedback | null>(null);
  function controller() {
    return (feedback.current ??= new DemoFeedback(() => {
      setSound(false);
      setAudioError(true);
    }));
  }
  function stop() {
    generation.current++;
    game.current = null;
    setDemo(null);
    setSound(false);
    setAudioError(false);
    feedback.current?.stop();
  }
  function start() {
    const epoch = ++generation.current;
    window.speechSynthesis?.cancel();
    const audio = controller().unlock();
    const sample = latest.current.source();
    game.current = new TargetDemo(sample.heading);
    setDemo(
      game.current.update(sample.heading, performance.now(), !sample.reliable),
    );
    void audio.then((ready) => {
      if (epoch === generation.current) {
        setSound(ready);
        setAudioError(!ready);
      }
    });
  }
  function toggleSound() {
    if (sound) {
      // Cancel a scheduled pulse in this tap, before the next tracking tick.
      feedback.current?.stop();
      latest.current.sound = false;
      setSound(false);
      return;
    }
    const epoch = generation.current;
    void controller()
      .unlock()
      .then((ready) => {
        if (epoch === generation.current && game.current) {
          setSound(ready);
          setAudioError(!ready);
        }
      });
  }
  const running = demo !== null;
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      if (!game.current) return;
      const current = latest.current;
      const sample = current.source();
      const next = game.current.update(
        sample.heading,
        performance.now(),
        document.hidden || !sample.reliable,
      );
      setDemo(next);
      controller().set(next.state, current.sound, current.haptics);
    };
    tick();
    const timer = window.setInterval(tick, 100);
    const visibility = () => {
      feedback.current?.stop();
      tick();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      feedback.current?.stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [running]);
  useEffect(
    () => () => {
      generation.current++;
      feedback.current?.dispose();
    },
    [],
  );
  return { demo, sound, audioError, start, stop, toggleSound };
}
