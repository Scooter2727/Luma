import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Keyboard,
  Star,
  Compass,
  Clock,
  Route as RouteIcon,
  Map as MapIcon,
} from "lucide-react";
import PlacePicker from "./PlacePicker";
import { logoForTheme } from "./brand";
import type { Place } from "./model";
type Props = {
  theme: string;
  end: Place;
  lastTrip: Place | null;
  example: Place;
  plan: (p: Place) => void;
  map: () => void;
  saved: () => void;
  where: () => void;
  dictate: (fn: (text: string) => void) => boolean;
  listening: boolean;
  speak: (text: string) => void;
  askOnHome?: boolean;
  onAskStarted?: () => void;
};
export default function HomeView(p: Props) {
  const [typing, setTyping] = useState(false),
    [query, setQuery] = useState(""),
    [destination, setDestination] = useState(p.end);
  const askedFromHero = useRef(false);
  function ask() {
    if (
      !p.dictate((text) => {
        setTyping(true);
        setQuery(text);
        p.speak("Choose a destination matching " + text);
      })
    ) {
      setTyping(true);
      p.speak("Voice input is unavailable. Type your destination.");
    }
  }
  useEffect(() => {
    if (!p.askOnHome || askedFromHero.current) return;
    askedFromHero.current = true;
    p.onAskStarted?.();
    ask();
  }, [p.askOnHome]);
  return (
    <>
      <header className="page-header">
        <img src={logoForTheme(p.theme)} alt="" />
        <h1 tabIndex={-1}>Where to?</h1>
        <button
          className="icon-button header-map"
          aria-label="Show map"
          onClick={p.map}
        >
          <MapIcon size={27} />
        </button>
      </header>
      <div className="home-content">
        <button
          className="voice-destination"
          aria-pressed={p.listening}
          aria-label="Say where to go"
          onClick={ask}
        >
          <Mic size={68} />
          {p.listening ? "Listening…" : "Say where to go"}
        </button>
        <div className="home-actions">
          <button className="outline-button" onClick={() => setTyping(!typing)}>
            <Keyboard size={44} />
            Type
          </button>
          <button className="outline-button" onClick={p.saved}>
            <Star size={44} className="saved-star" aria-hidden="true" />
            Saved
          </button>
        </div>
        {typing && (
          <div className="home-search">
            <PlacePicker
              label="Destination"
              value={destination}
              query={query}
              onChange={(x) => {
                setDestination(x);
                p.plan(x);
              }}
              onValidityChange={() => {}}
            />
          </div>
        )}
        <button className="where-button" onClick={p.where}>
          <Compass size={52} />
          Compass
        </button>
        <button
          className="last-trip outline-button"
          onClick={() => p.plan(p.lastTrip || p.example)}
        >
          {p.lastTrip ? <Clock size={40} /> : <RouteIcon size={40} />}
          <span>
            <small>{p.lastTrip ? "Last trip" : "Example journey"}</small>
            <strong>{p.lastTrip?.name || "Try a walk"}</strong>
          </span>
        </button>
      </div>
    </>
  );
}
