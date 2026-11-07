# Luma

A responsive, accessibility-first Toronto map and walking-route prototype. React + Vite + TypeScript, MapLibre GL JS, FastAPI, Pydantic and NetworkX. Includes the supplied Luma logo, four selectable themes, local destination search, category icons and filters, accessible location lists, source details, route comparison and spoken simulated walks.

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

- Explore the map; zoom in to reveal individual category icons. Click a marker for its purpose and source.
- All feature categories are enabled by default, including tactile paving, transit stops and libraries. Use filters to hide categories. Zoomed-out clusters show counts; the simplified background keeps street names while removing building and rail detail.
- Search for destinations by name or select a location icon on the map.
- Select Try a walk for Union Station → Nathan Phillips Square, or search for a destination.
- Compare routes, read a summary aloud, and choose Preview walk for a clearly labelled step simulation.
- Settings offers the requested Luma, red–green, blue–yellow and high-contrast palettes, speech speed, larger text and screen-reader announcements.

The interface uses a task-focused layout: Home offers voice search (where browser support permits), a Type action, a suggested destination, and expandable map filters. Settings groups controls into Voice, Crossings, Display, Screen reader, and About & data. On phones, Settings opens as a full-height view. The walking simulation hides planning controls and shows one main instruction, a next-step preview, Repeat/Pause/Where am I/End, and the spoken text. Its Where am I action describes the simulated position, not live GPS. Live street navigation, clock-bearing guidance, onboarding and community reporting remain future work; mockup example values are not used as real route data.

## Scope and limitations

Location features come from `data/WAYFINDER_ALL_LOCATIONS.csv`; planned and relocated entries and records without coordinates are not shown. Pedestrian routing uses original Pednet geometry within downtown bounds: longitude −79.425 to −79.355, latitude 43.632 to 43.680. Paths preserve original network connectivity, rounded to six decimal places. No arbitrary bridges across gaps are added. Network gaps produce an explicit no-route response.

Audible crossings are associated through matching source PX identifiers. As requested, listed signals are assumed operational for every crossing direction in the demo. Cost penalties prefer mapped audible crossings and/or fewer crossings. Missing sound information is not treated as confirmed absence. Tactile features are displayed; they do not yet influence routing. Exact entrances, individual buttons, per-crosswalk direction coverage, turn instructions, live traffic signal phases and reliable outdoor turn-by-turn guidance remain future work. Route steps are crossing previews with a mapped arrival point, not continuous live navigation. Distances from selected points to network endpoints are exposed.

The map uses a locally customized OpenFreeMap Positron vector style with remote OpenStreetMap-derived tiles and needs internet. Search uses collected local names and named demo destinations, not a full address geocoder. Browser speech availability depends on installed voices. If tiles cannot load, list/search remain usable. Theme changes affect the interface; map feature icons retain distinct pictograms and their category colours. No accounts or database required.

## Checks

```powershell
npm run build
.\.venv\Scripts\python -m pytest backend -q
npm run test:e2e
```

Frontend tests need Playwright Chromium (`npx playwright install chromium`) and both local servers running.

## Attribution

Contains information licensed under the Open Government Licence – Toronto. Tactile snapshot © OpenStreetMap contributors, distributed by EmbedEarth under ODbL 1.0. Source links remain on location details. Basemap: OpenFreeMap / OpenMapTiles, © OpenStreetMap contributors. Custom style in public/maps/simple.json derives from OpenFreeMap Positron. Provider summaries retain links to their publishers. See `data/DATA_GUIDE.md` for collection provenance and assumptions.
