// Each SVG view frames one of the four unchanged logos supplied in the sheet.
export function logoForTheme(theme: string) {
  const name = ["default", "red-green", "blue-yellow", "contrast"].includes(theme)
    ? theme
    : "default";
  return `/brand/luma-theme-logos.svg#${name}`;
}
