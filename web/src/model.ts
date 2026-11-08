import {
  Volume2,
  Grid2X2,
  Bus,
  Library,
  Navigation,
  Accessibility,
} from "lucide-react";
export type Coord = [number, number];
export type Place = {
  id: string;
  name: string;
  subtitle: string;
  coordinates: Coord;
};
export type Feature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Coord };
  properties: Record<string, string>;
};
export type Route = {
  id: string;
  name: string;
  coordinates: Coord[];
  distance: number;
  minutes: number;
  crossings: number;
  audible: number;
  steps: {
    text: string;
    title: string;
    kind: string;
    scheduled_time?: string;
    coordinates: Coord;
    distance: number;
    crossing: boolean;
    bearing?: number;
    street?: string;
    control?: string;
    audible?: boolean | null;
    tactile?: boolean | null;
    ai_text?: string;
  }[];
  ai_directions?: Preferences["directions"];
  snap_distances: number[];
  mode: "walk" | "bus";
  departure_time: string;
  arrival_time: string;
  duration_seconds: number;
  timing: "estimated" | "scheduled";
  explanation: string;
  tactile: number;
  walking_minutes?: number;
  riding_minutes?: number;
  waiting_minutes?: number;
  transfers?: number;
  segments: {
    mode: "walk" | "bus" | "connect";
    coordinates: Coord[];
    route?: string;
  }[];
  bus_legs?: {
    route: string;
    headsign: string;
    from_name: string;
    to_name: string;
    departure_time: string;
    arrival_time: string;
    stops: number;
  }[];
};
export const kinds = [
  {
    id: "signal",
    name: "Audible signals",
    short: "Audible signal",
    color: "#5865F2",
    icon: Volume2,
  },
  {
    id: "tactile",
    name: "Tactile paving",
    short: "Tactile paving",
    color: "#147d67",
    icon: Grid2X2,
  },
  {
    id: "transit",
    name: "Transit stops",
    short: "Transit stop",
    color: "#b04d16",
    icon: Bus,
  },
  {
    id: "library",
    name: "Libraries",
    short: "Library",
    color: "#9255bb",
    icon: Library,
  },
  {
    id: "station",
    name: "Station features",
    short: "Station feature",
    color: "#297da8",
    icon: Navigation,
  },
  {
    id: "place",
    name: "Other support",
    short: "Support location",
    color: "#96506c",
    icon: Accessibility,
  },
];
export const initialStart: Place = {
  id: "union",
  name: "Union Station",
  subtitle: "Front Street West",
  coordinates: [-79.3806, 43.6453],
};
export const initialEnd: Place = {
  id: "city-hall",
  name: "Nathan Phillips Square",
  subtitle: "100 Queen Street West",
  coordinates: [-79.3832, 43.6525],
};
export function saved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem("luma-" + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
export const icons: Record<string, string> = {
  signal: '<path d="M8 10H5v4h3l4 3V7z M15 9q5 3 0 6 M17 6q9 6 0 12"/>',
  tactile:
    '<path d="M7 6h.01M12 6h.01M17 6h.01M7 12h.01M12 12h.01M17 12h.01M7 18h.01M12 18h.01M17 18h.01" stroke-width="3"/>',
  transit:
    '<rect x="5" y="4" width="14" height="15" rx="3"/><path d="M5 11h14M8 19v2M16 19v2M8 15h.01M16 15h.01"/>',
  library: '<path d="M3 5q5-2 9 1 4-3 9-1v14q-5-2-9 1-4-3-9-1zM12 6v14"/>',
  station: '<path d="m12 3 8 17-8-4-8 4z"/>',
  place: '<circle cx="12" cy="8" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/>',
};
export async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const r = await fetch(url, options);
  if (!r.ok) {
    let message = "Unable to connect. Please try again.";
    try {
      message = (await r.json()).detail || message;
    } catch {}
    throw Error(message);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export const WALKING_SPEED = 1.2;
export type Preferences = {
  audible: boolean;
  fewer: boolean;
  tactile: boolean;
  rate: number;
  screenReader: boolean;
  large: boolean;
  theme: string;
  directions: "clock" | "left-right" | "cardinal";
};
export const timeLabel = (time: string) =>
  new Date(time).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  });
export type Step = Route["steps"][number];
export function instructionText(
  step: Step,
  previous: Step | undefined,
  style: Preferences["directions"],
) {
  if (style === "cardinal" && step.kind === "walk" && step.bearing !== undefined) {
    const points = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
    const heading = points[Math.round(((step.bearing % 360 + 360) % 360) / 45) % 8];
    return `Head ${heading} along ${step.street || "the pedestrian path"}. Continue ${step.distance} metres.`;
  }
  if (
    style === "left-right" ||
    step.kind !== "walk" ||
    step.bearing === undefined ||
    previous?.bearing === undefined
  )
    return step.text;
  const delta = (step.bearing - previous.bearing + 360) % 360,
    clock = Math.round(delta / 30) % 12 || 12;
  const phrase = `Toward ${clock} o'clock, along ${step.street || "the pedestrian path"}. Continue ${step.distance} metres.`;
  return phrase;
}
/** Wording for the AI voice. Server ai_text is used only if it was built for the current directions style. */
export function aiInstructionText(
  route: Route,
  index: number,
  style: Preferences["directions"],
) {
  const step = route.steps[index];
  return route.ai_directions === style && step.ai_text
    ? step.ai_text
    : instructionText(step, route.steps[index - 1], style);
}
