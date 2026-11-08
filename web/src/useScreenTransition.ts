import { useLayoutEffect } from "react";
import type { RefObject } from "react";

// Animate the existing surface; keep forms, the map and navigation state mounted.
export function useScreenTransition(
  ref: RefObject<HTMLElement | null>,
  key: string | number,
  enabled = true,
  slide = true,
  contents = false,
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (
      !enabled ||
      !element ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const surfaces = contents
      ? [...element.children].filter((child) => !child.classList.contains("settings-content"))
      : [element];
    const animations = surfaces.map((surface) => surface.animate(
      [
        { opacity: 0.75, transform: slide ? "translateY(5px)" : "none" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 160, easing: "ease-out" },
    ));
    return () => animations.forEach((animation) => animation.cancel());
  }, [ref, key, enabled, slide, contents]);
}
