// Separate URLs avoid SVG-fragment caching when switching themes in Safari.
export function logoForTheme(theme: string) {
  const name = ["default", "red-green", "blue-yellow", "contrast"].includes(theme)
    ? theme
    : "default";
  return `/brand/luma-logo-${name}.svg`;
}
