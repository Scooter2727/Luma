import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Map as MapIcon,
  Footprints,
  Bus,
  SlidersHorizontal,
  Star,
  Volume2,
  Grid2X2,
  ChevronLeft,
  ChevronRight,
  Play,
  CalendarClock,
} from "lucide-react";
import { CrosswalkIcon } from "./Icons";
import PlacePicker from "./PlacePicker";
import { CrossingChoices } from "./Preferences";
import type { PreferenceProps } from "./Preferences";
import type { Place, Route, ConstructionData } from "./model";
import { timeLabel } from "./model";
import { logoForTheme } from "./brand";
import { LumaLoader } from "./LumaLoader";
import TransitArrivals, { transitName } from "./TransitArrivals";
type PlannerProps = PreferenceProps & {
  start: Place;
  end: Place;
  setStart: (p: Place) => void;
  setEnd: (p: Place) => void;
  startValid: boolean;
  endValid: boolean;
  setStartValid: (v: boolean) => void;
  setEndValid: (v: boolean) => void;
  mode: "walk" | "transit";
  setMode: (m: "walk" | "transit") => void;
  departure: string;
  setDeparture: (s: string) => void;
  timetable: { service_start: string; service_end: string } | null;
  locate: () => void;
  map: (target?: "start" | "end") => void;
  plan: () => void;
  isSaved: boolean;
  toggleSaved: () => void;
};
export function JourneyPlanner(p: PlannerProps) {
  const [scheduling, setScheduling] = useState(!!p.departure);
  const departureDate = new Date(p.departure);
  const departureLabel = Number.isNaN(departureDate.getTime())
    ? "Choose date and time"
    : departureDate.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <header className="page-header">
        <img src={logoForTheme(p.prefs.theme)} alt="" />
        <h1 tabIndex={-1}>Plan a journey</h1>
        <button
          className="icon-button"
          aria-label="Show map"
          onClick={() => p.map()}
        >
          <MapIcon size={27} />
        </button>
      </header>
      <div className="travel-modes" role="group" aria-label="Travel mode">
        <button aria-pressed={p.mode === "walk"} onClick={() => p.setMode("walk")}>
          <Footprints />
          Walk
        </button>
        <button aria-pressed={p.mode === "transit"} onClick={() => p.setMode("transit")}>
          <Bus />
          Transit
        </button>
      </div>
      <div className="journey-fields">
        <PlacePicker
          label="From"
          labelAction={
            <div className="endpoint-tools">
              <button className="schedule-toggle" aria-expanded={scheduling} aria-controls="departure-time" onClick={() => {
                if (scheduling) { p.setDeparture(""); setScheduling(false); }
                else setScheduling(true);
              }}>
                <CalendarClock size={20} />
                {scheduling ? "Leave now" : "Schedule"}
              </button>
            </div>
          }
          value={p.start}
          onChange={(x) => {
            p.setStart(x);
            p.setStartValid(true);
          }}
          onValidityChange={p.setStartValid}
        />
        {scheduling && (
          <div className="departure-picker" id="departure-time">
            <div className="select-label">
              <label htmlFor="journey-departure">Leave at (Toronto time)</label>
              <span className="departure-input">
                <span className="departure-display" aria-hidden="true">{departureLabel}</span>
                <input id="journey-departure" type="datetime-local" value={p.departure} onChange={e => p.setDeparture(e.target.value)} />
              </span>
            </div>
          </div>
        )}
        <PlacePicker
          label="To"
          value={p.end}
          onChange={(x) => {
            p.setEnd(x);
            p.setEndValid(true);
          }}
          onValidityChange={p.setEndValid}
        />
      </div>
      <details className="preferences-details">
        <summary>
          <SlidersHorizontal />
          Crossing preferences
        </summary>
        <CrossingChoices {...p} />
      </details>
      <button
        className="outline-button find-routes"
        disabled={!p.startValid || !p.endValid}
        onClick={p.plan}
      >
        Find routes
        <ArrowRight />
      </button>
      <button
        className="outline-button save-place"
        aria-pressed={p.isSaved}
        disabled={!p.endValid}
        onClick={p.toggleSaved}
      >
        <Star className={p.isSaved ? "saved-star" : undefined} aria-hidden="true" />
        {p.isSaved ? "Destination saved" : "Save destination"}
      </button>
      {(!p.startValid || !p.endValid) && (
        <p className="helper" role="status">
          Select a suggested place or choose a map point to confirm both
          locations.
        </p>
      )}
    </>
  );
}
type ChoiceProps = {
  construction?: ConstructionData | null;
  routes: Route[];
  index: number;
  setIndex: (i: number) => void;
  busy: boolean;
  edit: () => void;
  map: () => void;
  speak: (text: string) => void;
  preview: () => void;
};
export function RouteChoices(p: ChoiceProps) {
  const r = p.routes[p.index];
  return (
    <>
      <header className="page-header">
        <button
          className="back-button"
          aria-label="Edit journey"
          onClick={p.edit}
        >
          <ArrowLeft />
        </button>
        <h1 tabIndex={-1}>
          {p.busy
            ? "Finding your way…"
            : r
              ? "Route " + (p.index + 1) + " of " + p.routes.length
              : "No route found"}
        </h1>
        <button
          className="icon-button"
          aria-label="Show route on map"
          onClick={p.map}
        >
          <MapIcon size={27} />
        </button>
      </header>
      {p.busy && (
        <div className="planning-status">
          <LumaLoader label="Finding your way…" onBack={p.edit} />
          <p>
            Calculating paths and directions. The first journey can take longer
            while the network loads.
          </p>
        </div>
      )}
      {r && (
        <>
          <section className="route-hero" aria-label={r.name}>
            <span>{r.name}</span>
            <p>
              {r.minutes}
              <small> min</small>
            </p>
            <div>
              {r.transit_stale ? "Previous estimated" : r.timing === "scheduled" ? "Scheduled" : r.timing === "real-time" ? "Live estimated" : r.timing === "mixed" ? "Live + scheduled" : "Estimated"} arrival{" "}
              {timeLabel(r.arrival_time)}
            </div>
          </section>
          <ul className="route-facts">
            <li>
              <CrosswalkIcon size={38} />
              <span>
                {r.crossings} crossing{r.crossings === 1 ? "" : "s"}
              </span>
            </li>
            <li>
              <Volume2 size={38} />
              <span>{r.audible} audible crossing{r.audible === 1 ? "" : "s"}</span>
            </li>
            {r.tactile >= r.crossings && (
              <li>
                <Grid2X2 size={38} />
                <span>Tactile mapped at {r.tactile}</span>
              </li>
            )}
          </ul>
          {(r.mode === "bus" || r.mode === "transit") && (
            <div className="bus-details">
              <Bus />
              <strong>{r.bus_legs?.map((l) => transitName(l.mode, l.route)).join(" → ")}</strong>
              <p>
                {r.walking_minutes} min walking · {r.waiting_minutes} min
                waiting · {r.riding_minutes} min riding
              </p>
              <p>
                {r.transfers} transfer{r.transfers === 1 ? "" : "s"}
              </p>
              {r.bus_legs?.map((l, i) => <p key={i}><strong>{transitName(l.mode, l.route)}</strong><br />{l.from_name} → {l.to_name}</p>)}
            </div>
          )}
          {(p.construction?.available ?? r.construction_available) === false
            ? <p className="helper">Construction data unavailable</p>
            : (p.construction?.complete ?? r.construction_complete) === false
              ? <p className="helper">Some construction data is unavailable</p>
              : (p.construction?.stale ?? r.construction_stale) && <p className="helper">Construction data is temporarily using the last update</p>}
          <div className="route-pager">
            <button
              className="outline-button"
              disabled={p.routes.length < 2}
              aria-label="Previous route"
              onClick={() => p.setIndex((p.index - 1 + p.routes.length) % p.routes.length)}
            >
              <ChevronLeft size={38} />
            </button>
            <button
              className="outline-button"
              aria-label="Read this route"
              onClick={() =>
                p.speak(
                  r.name +
                    ". " +
                    r.minutes +
                    " minutes. " +
                    r.crossings +
                    " crossings. " +
                    r.audible +
                    (r.audible === 1 ? " audible crossing. " : " audible crossings. ") +
                    r.explanation,
                )
              }
            >
              <Volume2 size={38} />
            </button>
            <button
              className="outline-button"
              disabled={p.routes.length < 2}
              aria-label="Next route"
              onClick={() => p.setIndex((p.index + 1) % p.routes.length)}
            >
              <ChevronRight size={38} />
            </button>
          </div>
          <button
            id="preview-route"
            className="outline-button start-route"
            aria-label={`Preview route ${p.index + 1}`}
            onClick={p.preview}
          >
            <Play size={40} fill="currentColor" aria-hidden="true" />
          </button>
          {(r.mode === "transit" || r.mode === "bus") && <TransitArrivals legs={r.bus_legs} departure={r.departure_time} />}
        </>
      )}
    </>
  );
}
