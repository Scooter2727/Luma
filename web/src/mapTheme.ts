import { icons, kinds } from "./model";

export function mapPalette(theme: string) {
  const defaults = kinds.map((k) => k.color);
  const palettes: Record<string, string[]> = {
    "red-green": [
      "#0072B2",
      "#E69F00",
      "#17212F",
      "#0072B2",
      "#E69F00",
      "#17212F",
    ],
    "blue-yellow": [
      "#9B3658",
      "#254653",
      "#F0F0EB",
      "#9B3658",
      "#254653",
      "#F0F0EB",
    ],
    contrast: [
      "#000000",
      "#FFD600",
      "#FFFFFF",
      "#000000",
      "#FFD600",
      "#FFFFFF",
    ],
  };
  const fills = palettes[theme] || defaults;
  const colors = Object.fromEntries(
    kinds.map((kind, i) => [kind.id, fills[i]]),
  );
  const walk =
    theme === "contrast"
      ? "#000000"
      : theme === "red-green"
        ? "#0072B2"
        : theme === "blue-yellow"
          ? "#9B3658"
          : "#5865F2";
  const bus =
    theme === "contrast"
      ? "#FFD600"
      : theme === "red-green"
        ? "#17212F"
        : theme === "blue-yellow"
          ? "#254653"
          : "#b04d16";
  return {
    colors,
    walk,
    bus,
    halo: theme === "contrast" ? "#000000" : "#FFFFFF",
    cluster: theme === "contrast" ? "#FFD600" : walk,
    outline: "#17212F",
  };
}

// Choose contrast for the actual symbol fill, including amber and off-white.
export function symbolInk(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((c) => parseInt(c, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05)
    ? "#000000"
    : "#FFFFFF";
}

export async function mapIconImages(theme: string) {
  const palette = mapPalette(theme);
  return Promise.all(
    [...kinds, { id: "construction" }].map(async (kind) => {
      const fill = kind.id === "construction" ? (theme === "contrast" ? "#FFD600" : theme === "red-green" ? "#E69F00" : theme === "blue-yellow" ? "#F0F0EB" : "#FF8A4C") : palette.colors[kind.id];
      const svg = kind.id === "construction"
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 40 40"><path d="M20 3L38 36H2Z" fill="${fill}" stroke="#17212F" stroke-width="2" stroke-linejoin="round"/><path d="M20 14v10m0 5v1" stroke="${symbolInk(fill)}" stroke-width="3" stroke-linecap="round"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 40 40"><circle cx="20" cy="21" r="18" fill="#17212f" opacity=".12"/><circle cx="20" cy="19" r="17" fill="white" stroke="${palette.outline}" stroke-width="1.2"/><circle cx="20" cy="19" r="14" fill="${fill}"/><g transform="translate(8 7)" fill="none" stroke="${symbolInk(fill)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[kind.id]}</g></svg>`;
      const image = new Image();
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      await image.decode();
      return { id: kind.id, image };
    }),
  );
}
