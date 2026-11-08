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
        <circle className="c-orange" cx="60" cy="42" r="34" fill="var(--logo-top)" />
        <circle className="c-blue" cx="40" cy="78" r="34" fill="var(--logo-left)" />
        <circle className="c-mint" cx="80" cy="78" r="34" fill="var(--logo-right)" />
      </svg>
      <p className="luma-label">{label}</p>
    </div>
  );
}
