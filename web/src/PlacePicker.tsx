import { useEffect, useId, useRef, useState } from "react";
import { Search, MapPin } from "lucide-react";
import { LumaLoader } from "./LumaLoader";
export type Place = {
  id: string;
  name: string;
  subtitle: string;
  coordinates: [number, number];
};
type Props = {
  query?: string;
  label: string;
  value: Place;
  onChange: (place: Place) => void;
  onValidityChange: (valid: boolean) => void;
};
export default function PlacePicker({
  label,
  value,
  onChange,
  onValidityChange,
  query,
}: Props) {
  const id = useId(),
    root = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(value.name),
    [open, setOpen] = useState(false),
    [results, setResults] = useState<Place[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [index, setIndex] = useState(-1);
  useEffect(() => {
    setText(value.name);
    setOpen(false);
  }, [value]);
  useEffect(() => {
    if (!open) return;
    setBusy(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setError("");
      try {
        const r = await fetch(
          "/api/search?q=" +
            encodeURIComponent(text === value.name ? "" : text),
          { signal: controller.signal },
        );
        if (!r.ok) throw Error();
        const data = await r.json();
        setResults(data);
        setIndex(-1);
      } catch (e) {
        if (!controller.signal.aborted) {
          setResults([]);
          setError("Search is unavailable. Try again or choose on the map.");
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, open, value.name]);
  useEffect(() => {
    if (query) {
      setText(query);
      setOpen(true);
      setResults([]);
      onValidityChange(false);
    }
  }, [query]);
  function choose(p: Place) {
    onChange(p);
    onValidityChange(true);
    setText(p.name);
    setOpen(false);
  }
  return (
    <div
      className="place-picker"
      ref={root}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="picker-input">
        <MapPin size={19} />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={id + "-results"}
          aria-activedescendant={
            open && results[index] ? id + "-option-" + index : undefined
          }
          value={text}
          autoComplete="off"
          placeholder="Search a place or intersection"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setResults([]);
            setIndex(-1);
            setBusy(true);
            onValidityChange(e.target.value === value.name);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setIndex((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => (results.length ? Math.max(0, i - 1) : -1));
            } else if (e.key === "Enter" && open && results[index]) {
              e.preventDefault();
              choose(results[index]);
            }
          }}
        />
        {busy ? (
          <LumaLoader label="Searching places…" size={28} />
        ) : (
          <Search size={17} />
        )}
      </div>
      {open && (
        <div
          className="picker-results"
          id={id + "-results"}
          role="listbox"
          aria-label={label + " suggestions"}
        >
          {results.map((p, i) => (
            <button
              key={p.id}
              id={id + "-option-" + i}
              role="option"
              aria-selected={i === index}
              className={i === index ? "highlighted" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
            >
              <strong>{p.name}</strong>
              <small>{p.subtitle}</small>
            </button>
          ))}
          {!busy && !results.length && (
            <p role="status">
              {error ||
                "No matching places. Try a station name or an intersection."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
