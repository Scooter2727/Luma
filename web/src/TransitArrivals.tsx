import { useEffect, useState } from "react";
import { request } from "./model";
import type { Coord, Route } from "./model";

type Arrival = {
  trip: string;
  route_id: string;
  route: string;
  mode: string;
  direction_id: string;
  headsign: string;
  minutes: number;
  arrival_time: string;
  timing: "real-time" | "scheduled";
  delay_seconds?: number | null;
};
type Stop = { id: string; name: string; arrivals: Arrival[] };
export function transitName(mode: string | undefined, route: string) {
  if (mode === "streetcar" && ["5", "6"].includes(route))
    return `Light rail Line ${route}`;
  return mode === "subway"
    ? `Subway Line ${route}`
    : `${mode === "streetcar" ? "Streetcar" : "Bus"} ${route}`;
}

export default function TransitArrivals({
  legs,
  coordinates,
  departure,
  compact = false,
}: {
  legs?: Route["bus_legs"];
  coordinates?: Coord;
  departure?: string;
  compact?: boolean;
}) {
  const params = new URLSearchParams();
  for (const id of new Set(
    legs?.map((l) => l.from_stop).filter((s): s is string => !!s),
  ))
    params.append("stop_id", id);
  if (coordinates) {
    params.set("longitude", String(coordinates[0]));
    params.set("latitude", String(coordinates[1]));
  }
  if (departure && new Date(departure).getTime() > Date.now() + 7200000)
    params.set("at", departure);
  const key = params.toString();
  const [result, setResult] = useState<{
    key: string;
    stops: Stop[];
    failed: boolean;
  }>();
  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let pending: AbortController | null = null;
    async function refresh() {
      if (document.hidden || pending) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const data = await request<{ stops: Stop[] }>(
          "/api/transit/arrivals?" + key,
          { signal: controller.signal },
        );
        if (!disposed) setResult({ key, stops: data.stops, failed: false });
      } catch {
        if (!disposed && !controller.signal.aborted)
          setResult({ key, stops: [], failed: true });
      } finally {
        if (pending === controller) pending = null;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      pending?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [key]);
  if (!key) return null;
  const current = result?.key === key ? result : undefined;
  return (
    <section className={"transit-arrivals" + (compact ? " compact" : "")} aria-label="Upcoming TTC arrivals">
      {!current ? (
        <p>Checking arrivals…</p>
      ) : current.failed ? (
        <p>Arrival times unavailable</p>
      ) : current.stops.length === 0 ? (
        <p>No matching TTC stop found</p>
      ) : (
        current.stops.map((stop) => {
          const relevant = legs?.filter((l) => l.from_stop === stop.id);
          const arrivals = stop.arrivals.filter(
            (a) =>
              !relevant?.length ||
              relevant.some(
                (l) =>
                  l.route_id === a.route_id &&
                  (l.direction_id == null || l.direction_id === a.direction_id),
              ),
          );
          return (
            <div key={stop.id}>
              {(!compact || current.stops.length > 1) && <h2>{stop.name}</h2>}
              {arrivals.length ? (
                <ul>
                  {arrivals.slice(0, 3).map((a) => (
                    <li key={a.trip + a.arrival_time}>
                      <span>
                        <strong>{transitName(a.mode, a.route)}</strong>
                        <span>{a.headsign}</span>
                      </span>
                      <span className="arrival-time">
                        <strong>
                          {a.minutes === 0 ? "Due" : `${a.minutes} min`}
                        </strong>
                        <span>
                          {a.timing === "real-time" ? "Live" : "Scheduled"}
                        </span>
                        {a.timing === "real-time" && (a.delay_seconds ?? 0) >= 60 && <span>{Math.ceil(a.delay_seconds! / 60)} min late</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No upcoming departures in the next 3 hours</p>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
