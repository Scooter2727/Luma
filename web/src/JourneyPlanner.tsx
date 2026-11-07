import {
  ArrowLeft,
  ArrowRight,
  Map as MapIcon,
  MapPin,
  LocateFixed,
  Footprints,
  Bus,
  SlidersHorizontal,
  Star,
  Volume2,
  Grid2X2,
  ChevronLeft,
  ChevronRight,
  Play,
} from "lucide-react";
import { CrosswalkIcon } from "./Icons";
import PlacePicker from "./PlacePicker";
import { CrossingChoices } from "./Preferences";
import type { PreferenceProps } from "./Preferences";
import type { Place, Route } from "./model";
import { timeLabel } from "./model";
type PlannerProps = PreferenceProps & {
  start: Place;
  end: Place;
  setStart: (p: Place) => void;
  setEnd: (p: Place) => void;
  startValid: boolean;
  endValid: boolean;
  setStartValid: (v: boolean) => void;
  setEndValid: (v: boolean) => void;
  mode: "walk" | "bus";
  setMode: (m: "walk" | "bus") => void;
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
  const date = (v: string) =>
    v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6, 8);
  return (
    <>
      <header className="page-header">
        <h1 tabIndex={-1}>Plan a journey</h1>
        <button
          className="icon-button"
          aria-label="Show map"
          onClick={() => p.map()}
        >
          <MapIcon />
        </button>
      </header>
      <div className="journey-fields">
        <PlacePicker
          label="From"
          value={p.start}
          onChange={(x) => {
            p.setStart(x);
            p.setStartValid(true);
          }}
          onValidityChange={p.setStartValid}
        />
        <div className="endpoint-tools">
          <button onClick={p.locate}>
            <LocateFixed size={20} />
            Use my location
          </button>
          <button onClick={() => p.map("start")}>
            <MapPin size={20} />
            Choose start on map
          </button>
        </div>
        <PlacePicker
          label="To"
          value={p.end}
          onChange={(x) => {
            p.setEnd(x);
            p.setEndValid(true);
          }}
          onValidityChange={p.setEndValid}
        />
        <div className="endpoint-tools">
          <button
            onClick={() => {
              p.setStart(p.end);
              p.setEnd(p.start);
              p.setStartValid(true);
              p.setEndValid(true);
            }}
          >
            Swap start and destination
          </button>
          <button onClick={() => p.map("end")}>
            <MapPin size={20} />
            Choose end on map
          </button>
        </div>
      </div>
      <div className="travel-modes" role="group" aria-label="Travel mode">
        <button
          aria-pressed={p.mode === "walk"}
          onClick={() => p.setMode("walk")}
        >
          <Footprints />
          Walk
        </button>
        <button
          aria-pressed={p.mode === "bus"}
          onClick={() => p.setMode("bus")}
        >
          <Bus />
          Bus + walk
        </button>
      </div>
      {p.mode === "bus" && (
        <div className="departure-picker">
          <label className="select-label">
            Leave at (Toronto time)
            <input
              type="datetime-local"
              value={p.departure}
              onChange={(e) => p.setDeparture(e.target.value)}
            />
          </label>
          <button className="text-action" onClick={() => p.setDeparture("")}>
            {p.departure ? "Leave now" : "Leaving now"}
          </button>
          <p className="helper">
            Scheduled TTC times.{" "}
            {p.timetable && (
              <>
                Feed: {date(p.timetable.service_start)} to{" "}
                {date(p.timetable.service_end)}.{" "}
              </>
            )}
            Up to one same-stop transfer.
          </p>
        </div>
      )}
      <details className="preferences-details">
        <summary>
          <SlidersHorizontal />
          Crossing preferences
        </summary>
        <CrossingChoices {...p} />
      </details>
      <p className="helper">
        {p.prefs.audible || p.prefs.fewer || p.prefs.tactile
          ? "Accessibility preferences are on. Routes may take longer."
          : "Fastest route by default."}
      </p>
      <button
        className="dark-button"
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
        <Star />
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
            ? "Finding routes"
            : r
              ? "Route " + (p.index + 1) + " of " + p.routes.length
              : "No route found"}
        </h1>
        <button
          className="icon-button"
          aria-label="Show route on map"
          onClick={p.map}
        >
          <MapIcon />
        </button>
      </header>
      {p.busy && (
        <p className="planning-status" role="status">
          Calculating paths and directions. The first journey can take longer
          while the network loads.
        </p>
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
              {r.timing === "scheduled" ? "Scheduled" : "Estimated"} arrival{" "}
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
              <span>Audible signal listed at {r.audible}</span>
            </li>
            <li className={r.tactile < r.crossings ? "unknown" : ""}>
              <Grid2X2 size={38} />
              <span>
                {r.tactile < r.crossings
                  ? "Tactile unknown at " + (r.crossings - r.tactile)
                  : "Tactile mapped at " + r.tactile}
              </span>
            </li>
          </ul>
          {r.mode === "bus" && (
            <div className="bus-details">
              <Bus />
              <strong>Bus {r.bus_legs?.map((l) => l.route).join(" → ")}</strong>
              <p>
                {r.walking_minutes} min walking · {r.waiting_minutes} min
                waiting · {r.riding_minutes} min riding
              </p>
              <p>
                {r.transfers} transfer{r.transfers === 1 ? "" : "s"}
              </p>
            </div>
          )}
          <div className="route-pager">
            <button
              className="outline-button"
              disabled={p.index === 0}
              aria-label="Previous route"
              onClick={() => p.setIndex(p.index - 1)}
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
                    " crossings. Audible signals listed at " +
                    r.audible +
                    ". " +
                    r.explanation,
                )
              }
            >
              <Volume2 size={38} />
            </button>
            <button
              className="outline-button"
              disabled={p.index === p.routes.length - 1}
              aria-label="Next route"
              onClick={() => p.setIndex(p.index + 1)}
            >
              <ChevronRight size={38} />
            </button>
          </div>
          <button
            id="preview-route"
            className="dark-button start-route"
            onClick={p.preview}
          >
            <Play size={34} />
            Preview route {p.index + 1}
          </button>
          <details className="itinerary">
            <summary>Step-by-step directions · {r.steps.length} steps</summary>
            <p className="route-explanation">{r.explanation}</p>
            <ol>
              {r.steps.map((s, i) => (
                <li key={i}>
                  <strong>{s.title}</strong>
                  <p>
                    {s.text.startsWith(s.title + ". ")
                      ? s.text.slice(s.title.length + 2)
                      : s.text}
                  </p>
                  {s.scheduled_time && (
                    <time>{timeLabel(s.scheduled_time)} · scheduled</time>
                  )}
                </li>
              ))}
            </ol>
          </details>
          <p className="helper">
            Listed audible signals are assumed to cover all directions in this
            prototype. Crossing conditions and signal phases are not monitored
            live.
          </p>
        </>
      )}
    </>
  );
}
