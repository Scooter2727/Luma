import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BellOff,
  Check,
  CircleDot,
  Mic,
  VolumeX,
  MapPin,
  LocateFixed,
  ArrowRight,
  Trash2,
  Grid2X2,
  TrafficCone,
} from "lucide-react";
import PlacePicker from "./PlacePicker";
import { LumaLoader } from "./LumaLoader";
import { logoForTheme } from "./brand";
import type { Place } from "./model";
import { request, saved } from "./model";
export type LocatedPlace = Place & {
  locationSource?: "selected" | "gps" | "route_preview";
  accuracy?: number;
};
export type ReportRecord = {
  id: string;
  issue_type: string;
  location_name: string;
  coordinates: [number, number];
  notes: string;
  location_source: string;
  status: string;
  created_at: string;
  delete_token: string;
};
export const issueTypes = [
  { id: "signal_silent", label: "Signal silent", icon: VolumeX },
  { id: "no_locator_tone", label: "No locator tone", icon: BellOff },
  { id: "button_hard_to_find", label: "Button hard to find", icon: CircleDot },
  { id: "tactile_problem", label: "Tactile paving problem", icon: Grid2X2 },
  { id: "obstruction", label: "Path blocked", icon: TrafficCone },
  { id: "other", label: "Other issue", icon: Mic },
];
type Props = {
  theme: string;
  initialLocation: LocatedPlace;
  back: () => void;
  backLabel: string | null;
  locate: () => Promise<LocatedPlace>;
  dictate: (callback: (text: string) => void) => boolean;
  listening: boolean;
  speak: (text: string) => void;
};
export function ReportHistory() {
  const [reports, setReports] = useState<ReportRecord[]>(() =>
    saved("report-history", []),
  );
  const [error, setError] = useState(""),
    [deleting, setDeleting] = useState("");
  async function remove(r: ReportRecord) {
    setDeleting(r.id);
    setError("");
    try {
      await request<void>("/api/reports/" + r.id, {
        method: "DELETE",
        headers: { "X-Report-Token": r.delete_token },
      });
      const remaining = reports.filter((x) => x.id !== r.id);
      setReports(remaining);
      localStorage.setItem("luma-report-history", JSON.stringify(remaining));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting("");
    }
  }
  return (
    <details className="report-history">
      <summary>Reports saved from this device ({reports.length})</summary>
      {reports.map((r) => (
        <article key={r.id}>
          <strong>
            {issueTypes.find((i) => i.id === r.issue_type)?.label || "Report"}
          </strong>
          <p>{r.location_name}</p>
          <small>
            Unverified · {new Date(r.created_at).toLocaleDateString()}
          </small>
          <button
            className="text-action"
            disabled={!!deleting}
            aria-label={"Delete report " + r.id.slice(0, 8)}
            onClick={() => remove(r)}
          >
            <Trash2 size={20} />
            Delete report
          </button>
        </article>
      ))}
      {!reports.length && <p>No reports saved from this device.</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
export default function ReportView({
  theme,
  initialLocation,
  back,
  backLabel,
  locate,
  dictate,
  listening,
  speak,
}: Props) {
  const [issue, setIssue] = useState(""),
    [location, setLocation] = useState(initialLocation),
    [valid, setValid] = useState(true),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false),
    [locating, setLocating] = useState(false),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState<ReportRecord | null>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const [availability, setAvailability] = useState({
    enabled: false,
    reason: "Checking report availability…",
  });
  useEffect(() => {
    const controller = new AbortController();
    request<{ enabled: boolean; reason: string | null }>(
      "/api/reports/status",
      { signal: controller.signal },
    )
      .then((status) =>
        setAvailability({
          enabled: status.enabled,
          reason: status.reason || "",
        }),
      )
      .catch(() => {
        if (!controller.signal.aborted)
          setAvailability({
            enabled: false,
            reason: "Reporting is unavailable. No report has been saved.",
          });
      });
    return () => controller.abort();
  }, []);
  async function submit() {
    if (!valid || !availability.enabled) return;
    setBusy(true);
    setError("");
    try {
      const r = await request<ReportRecord>("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue_type: issue,
          location_name: location.name,
          coordinates: location.coordinates,
          notes,
          location_source: location.locationSource || "selected",
          accuracy_metres: location.accuracy ?? null,
        }),
      });
      const history = saved<ReportRecord[]>("report-history", []);
      localStorage.setItem(
        "luma-report-history",
        JSON.stringify([r, ...history]),
      );
      setConfirmation(r);
      speak(
        "Report saved in Luma. It is unverified and has not been sent to the City.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function voice() {
    setIssue("other");
    const ok = dictate((text) => {
      setNotes(text);
      notesInput.current?.focus();
    });
    if (!ok) {
      setError("Voice input is unavailable. Type what happened below.");
      setTimeout(() => notesInput.current?.focus(), 0);
    }
  }
  return (
    <section
      className="report-screen"
      aria-label="Report an accessibility issue"
    >
      <header className="page-header">
        {issue && !confirmation ? (
          <button
            className="back-button"
            aria-label="Back to report options"
            onClick={() => {
              setIssue("");
              setError("");
            }}
          >
            <ArrowLeft />
          </button>
        ) : <img src={logoForTheme(theme)} alt="" />}
        <h1>
          {confirmation ? "Report saved" : issue ? "Confirm report" : "Report"}
        </h1>
        {!issue && !confirmation && (
          <span className="location-chip">
            <MapPin size={21} />
            {location.name}
          </span>
        )}
      </header>
      {confirmation ? (
        <>
          <div className="report-confirmation">
            <Check size={64} />
            <h2>
              {issueTypes.find((t) => t.id === confirmation.issue_type)?.label}
            </h2>
            <p>{confirmation.location_name}</p>
            <p>
              Saved in this Luma prototype. This report is unverified and has
              not been sent to the City.
            </p>
            <small>Reference {confirmation.id.slice(0, 8)}</small>
          </div>
          <button
            className="outline-button"
            onClick={() => {
              setIssue("");
              setNotes("");
              setConfirmation(null);
            }}
          >
            Report another issue
          </button>
          <ReportHistory key={confirmation.id} />
        </>
      ) : !issue ? (
        <>
          <button
            className="voice-destination"
            aria-pressed={listening}
            onClick={voice}
          >
            <Mic size={68} />
            {listening ? "Listening…" : "Say what’s wrong"}
          </button>
          <div className="report-quick">
            {issueTypes.slice(0, 3).map((t) => (
              <button key={t.id} onClick={() => setIssue(t.id)}>
                <t.icon size={44} />
                {t.label}
              </button>
            ))}
          </div>
          <details className="more-issues">
            <summary>More issue types</summary>
            {issueTypes.slice(3).map((t) => (
              <button
                className="outline-button"
                key={t.id}
                onClick={() => setIssue(t.id)}
              >
                <t.icon size={32} />
                {t.label}
              </button>
            ))}
          </details>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="select-label">
            Issue
            <select value={issue} onChange={(e) => setIssue(e.target.value)}>
              {issueTypes.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <PlacePicker
            label="Report location"
            value={location}
            onChange={(p) => {
              setLocation({ ...p, locationSource: "selected" });
              setValid(true);
            }}
            onValidityChange={setValid}
          />
          {locating && <LumaLoader label="Finding location…" size={72} />}
          <button
            type="button"
            className="text-action"
            disabled={locating}
            onClick={async () => {
              setLocating(true);
              try {
                setLocation(await locate());
                setValid(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setLocating(false);
              }
            }}
          >
            <LocateFixed size={22} />
            {locating ? "Finding location…" : "Use my location"}
          </button>
          <p className="helper">
            {location.locationSource === "route_preview"
              ? "This is the selected route-preview position, not GPS. Confirm the location before saving."
              : location.locationSource === "gps"
                ? "GPS location. Accuracy approximately " +
                  Math.round(location.accuracy || 0) +
                  " metres."
                : "Confirm where the issue is located."}
          </p>
          <label className="notes-label" htmlFor="report-notes">
            What happened? <span>(optional)</span>
          </label>
          <textarea
            ref={notesInput}
            id="report-notes"
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
          />
          {availability.enabled && (
            <p className="helper">
              Reports are saved in Luma for review. They are not automatically sent to the City or used to change routes.
            </p>
          )}
          {busy && <LumaLoader label="Saving report…" size={72} />}
          <button
            className="dark-button"
            disabled={busy || !valid || !availability.enabled}
            type="submit"
          >
            {busy ? "Saving report…" : "Save report"}
            <ArrowRight />
          </button>
        </form>
      )}
      {error && (
        <p className="error-card" role="alert">
          {error}
        </p>
      )}
      {backLabel && (
        <button className="dark-button back-to-route" onClick={back}>
          <ArrowLeft />
          {backLabel}
        </button>
      )}
    </section>
  );
}
