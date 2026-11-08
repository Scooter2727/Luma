import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { angleDifference, normalize } from "./orientationEngine";

export function followHeading(
  current: number,
  target: number,
  elapsedMs: number,
) {
  return normalize(
    current +
      angleDifference(target, current) *
        (1 - Math.exp(-Math.max(0, elapsedMs) / 65)),
  );
}
export function useCompassDial(
  face: RefObject<HTMLDivElement | null>,
  source: () => { heading: number | null },
) {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    const element = face.current;
    if (!element) return;
    const rotor = element.querySelector<SVGGElement>(".compass-rotor");
    const labels = [
      ...element.querySelectorAll<SVGTextElement>(".compass-cardinal"),
    ].map((node) => ({
      node,
      x: node.getAttribute("x"),
      y: node.getAttribute("y"),
    }));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let request = 0,
      current: number | null = null,
      lastTime: number | null = null,
      lastText = -Infinity,
      lastAngle: number | null = null,
      published: number | null = null;
    const frame = (time: number) => {
      const target = source().heading;
      if (target === null) {
        current = null;
        if (published !== null) {
          setHeading(null);
          published = null;
        }
      } else {
        current =
          current === null ||
          lastTime === null ||
          time - lastTime > 250 ||
          reduced.matches
            ? target
            : followHeading(current, target, time - lastTime);
        if (time - lastText >= 90) {
          const rounded = Math.round(current) % 360;
          if (rounded !== published) {
            setHeading(rounded);
            published = rounded;
          }
          lastText = time;
        }
      }
      const angle = current ?? 0;
      if (
        lastAngle === null ||
        Math.abs(angleDifference(angle, lastAngle)) > 0.001
      ) {
        rotor?.setAttribute("transform", `rotate(${-angle} 160 160)`);
        labels.forEach(({ node, x, y }) =>
          node.setAttribute("transform", `rotate(${angle} ${x} ${y})`),
        );
        lastAngle = angle;
      }
      lastTime = time;
      request = window.requestAnimationFrame(frame);
    };
    request = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(request);
  }, [face, source]);
  return heading;
}
