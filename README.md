# Luma

A responsive, accessibility-first Toronto map and journey-planning prototype. React + Vite + TypeScript, MapLibre GL JS, FastAPI, Pydantic and NetworkX. Includes the supplied Luma logo, four selectable themes, local destination search, category icons and filters, source details, walking and scheduled bus journeys, route comparison and spoken step previews.

## Run locally

Requires Node 22+ and Python 3.10+ (3.11+ recommended).

```powershell
npm install --legacy-peer-deps
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend/requirements.txt
```

Run these in two terminals from this folder:

```powershell
.\.venv\Scripts\python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

```powershell
npm run dev
```

Open http://localhost:5173 . To view on a phone on the same Wi-Fi, use the Network URL printed by Vite and allow local network access in the firewall. Ordinary HTTP over a LAN may not permit device geolocation; the preset start works without it. HTTPS is needed for geolocation on most non-localhost devices. The Vite proxy forwards API requests, so the phone only needs port 5173.

## Try it

- Explore the map; zoom in to reveal the existing category icons. Filters can hide individual categories.
- Open Routes. Search both **From** and **To**, use GPS for the start, swap the endpoints, or choose a point on the map. Select a search suggestion to confirm its coordinates; unconfirmed edits disable routing.
- **Walk** defaults to the fastest estimated walking time. Crossing preferences can prioritize listed audible signals, fewer crossings, or mapped tactile paving. A different preferred path is compared with the fastest walk. Preferences are soft penalties and can trade one feature against another. Settings persist on this device.
- Choose a walking speed to change both walking ETAs and which buses can be reached. Changes to confirmed endpoints, mode, or preferences recalculate an existing journey automatically; stale responses are discarded.
- **Bus + walk** finds scheduled TTC bus journeys, including walking access, boarding buffers, waiting, a direct bus or one same-stop transfer, and the final walk. Choose a departure in Toronto local time or leave now. Each result includes route numbers, headsigns, boarding/alighting stops and scheduled times. A walking alternative is also provided when connected.
- Select a result to see its map path, ETA and complete directions. Blue is walking; brown is bus travel; dotted connections mark short unmapped approaches. Read the summary aloud, or use Preview walk / Preview journey for an explicitly labelled step simulation.
- Settings includes four colour palettes, speech speed, larger text and screen-reader announcements. The map background and feature pictograms retain their existing design.

## Routing and data scope

Walking uses the full retained City of Toronto Pednet snapshot. Original connectivity is preserved with coordinates rounded to six decimal places; gaps are never bridged arbitrarily. Endpoints and bus stops are projected onto the nearest source edge, splitting that edge to avoid rounding to a distant intersection. Endpoint approaches are limited to 100 m; stop connections to 60 m. Connections are approximate and labelled unmapped, with their lengths included in travel time. Search covers collected places, stops, intersections and presets; it is not a full address geocoder. Map selection supports other points in Toronto.

The estimated physical cost is distance / chosen walking speed plus a 20-second allowance per complete source crossing. Default speed is 1.2 m/s. Accessibility selection adds preference costs: 120 seconds for a crossing with unknown audible coverage, 60 seconds per crossing when preferring fewer, and 45 seconds for unknown tactile coverage. These penalties influence path choice, not the displayed ETA. Split edges share a crossing's cost rather than multiplying it at every geometry vertex. Time comparisons always use physical estimates.

Audible signals match source PX identifiers first, then an intersection point within 45 m when no PX match exists. Per the prototype assumption, listed signals cover all crossing directions. Tactile proximity is a mapped feature within 8 m of either end of a source crossing. These spatial associations are estimates, not confirmation of individual curb/button coverage; unknown is not treated as confirmed absence. Street names are inferred from nearby City centreline geometry using distance and orientation. Directions include street names, geometry-derived turns, crossing context, and arrival/approach instructions.

Bus planning reads the retained TTC GTFS archive, combining routes, trips, stop_times, shapes, calendar and calendar_dates. Only bus route_type 3 is included. Previous-day times after 24:00, next-day departures, regular pickup/drop-off rules and service exceptions are respected. The timetable currently covers **2026-11-01 through 2026-12-21**; requests outside it fail explicitly. Search looks up to three hours ahead with walks up to 1 km at each end and a 60-second boarding/transfer buffer. One transfer between different bus routes at the same stop is supported. Walking preference costs influence both access and egress. Subway, streetcar, station interiors and transfers requiring a walk between stops are not implemented.

The pedestrian graph builds lazily on the first route request (roughly 20 seconds on the development machine; longer under load), then saves a local cache under `data/out/pedestrian-network-v3.pickle` for faster restarts. Source file or walking implementation changes invalidate it. GTFS is indexed into `data/out/ttc-schedule-v2.sqlite` on the first bus request (roughly 16 additional seconds); subsequent requests reuse it. The index rebuilds when the ZIP is newer. It is generated locally and excluded from Git. Network and cache initialization are locked against concurrent requests.

Accessibility preferences do not guarantee a safe route. Construction, live crossing phases, device faults, exact entrances and curb-level direction coverage remain unknown. Bus times are scheduled, without live vehicle arrivals, cancellations or disruption data. The spoken preview is a simulation; it does not track progress with GPS or announce when it is safe to cross. GPS currently supplies the starting point only. Testing has not established suitability for independent street navigation.

The basemap needs internet. Local search and routing use the checked-in snapshots. Location records marked planned/relocated or missing coordinates are excluded. Browser speech depends on installed voices. No accounts, paid map API or external routing service is required.

## Refreshing routing sources

The added `data/sources/centreline.geojson` contains 51,499 City street features for inferred names. Reproduce it using `.\.venv\Scripts\python -m backend.fetch_street_names`. Source: [Toronto GIS centreline layer](https://gis.toronto.ca/arcgis/rest/services/cot_geospatial/MapServer/2), filtered to FEATURE_CODE < 204000, WGS84. Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-license/).

The TTC ZIP is from [TTC routes and schedules](https://open.toronto.ca/dataset/ttc-routes-and-schedules/). Refresh `data/sources/ttc-gtfs.zip` and regenerate `data/ttc_stops.csv` using `data/sources/extract_gtfs.py` followed by `node data/sources/expand.mjs` together; restart the backend so calendars and graph stops reload. The planner follows the [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/). Snapshot refresh is explicit; the app does not silently download a new feed.

## Checks

```powershell
npm run build
.\.venv\Scripts\python -m pytest backend -q
npm run test:e2e
```

Frontend tests need Playwright Chromium (`npx playwright install chromium`) and both local servers running.

## Attribution

Contains information licensed under the Open Government Licence – Toronto. Tactile snapshot © OpenStreetMap contributors, distributed by EmbedEarth under ODbL 1.0. Source links remain on location details. Basemap: OpenFreeMap / OpenMapTiles, © OpenStreetMap contributors. Custom style in public/maps/simple.json derives from OpenFreeMap Positron. Provider summaries retain links to their publishers. See `data/DATA_GUIDE.md` for collection provenance and assumptions.

## Made by Scott and James for TrentHacks 2026

