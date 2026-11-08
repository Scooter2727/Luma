import "./loader.css";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";

export function LumaLoader({
  label,
  size = 140,
  onBack,
}: {
  label: string;
  size?: number;
  onBack: () => void;
}) {
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { backButton.current?.focus(); }, []);
  return (
    <div
      className="luma-loader"
      role="status"
      aria-live="polite"
      style={{ ["--size" as string]: size + "px" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onBack(); }
        if (event.key === "Tab") { event.preventDefault(); backButton.current?.focus(); }
      }}
    >
      <svg className="luma-mark" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="c-orange" cx="60" cy="42" r="34" fill="var(--logo-top)" />
        <circle className="c-blue" cx="40" cy="78" r="34" fill="var(--logo-left)" />
        <circle className="c-mint" cx="80" cy="78" r="34" fill="var(--logo-right)" />
      </svg>
      <p className="luma-label">{label}</p>
      <button ref={backButton} type="button" className="outline-button luma-loader-back" onMouseDown={event => event.preventDefault()} onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> Go back
      </button>
    </div>
  );
}
