import "./loader.css";

export function LumaLoader({
  label,
  size = 140,
}: {
  label: string;
  size?: number;
}) {
  return (
    <div
      className="luma-loader"
      role="status"
      aria-live="polite"
      style={{ ["--size" as string]: size + "px" }}
    >
      <svg className="luma-mark" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="c-orange" cx="60" cy="42" r="34" fill="#FF8A4C" />
        <circle className="c-blue" cx="40" cy="78" r="34" fill="#5865F2" />
        <circle className="c-mint" cx="80" cy="78" r="34" fill="#2CCBA8" />
      </svg>
      <p className="luma-label">{label}</p>
    </div>
  );
}
