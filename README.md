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

## Vercel deployment

`vercel.json` defines two services in one project:

| Service | Build context | Entrypoint/output | Public paths | Bindings |
| --- | --- | --- | --- | --- |
| `app` | Repository root | Vite → `dist/` | Everything outside `/api/*` | None |
| `backend` | Repository root | FastAPI `backend.app:app` | `/api/*` only | None |

The backend intentionally uses `root: "."`, rather than `root: "backend"`: it imports the `backend` Python package and reads the sibling `data/` tree. Root `pyproject.toml` supplies its Python 3.12 runtime dependencies and entrypoint. Vercel builds the Vite and Python services independently. Keep the Vercel project Root Directory at the repository root and let the checked-in service settings choose frameworks/build commands.

The more-specific `/api/(.*)` rewrite precedes the frontend catch-all. Vercel passes the original `/api/...` path through, matching the existing FastAPI routes. Browser calls already use relative `/api/...` URLs, so deployed requests share the page's origin and need no hardcoded hostname or frontend URL variable. There are no server-side service-to-service calls to bind: the Vite output is static. A runtime binding would become necessary if a server-side proxy were later added; do not expose a binding URL through `VITE_*` or invent one during a build. See [Services routing](https://vercel.com/docs/services/routing) and [Service bindings](https://vercel.com/docs/services/bindings).

Function settings include the five source files needed for routing and exclude local environments, node modules, generated caches, frontend assets and tests from the Python bundle. `.vercelignore` also excludes local state and environment files from source uploads. No source data is moved or downloaded at request time.

Walking and transit caches use the system temporary directory when Vercel injects `VERCEL=1`; local development still uses `data/out/`. `LUMA_CACHE_DIR` is an optional writable cache directory override, not a service binding. Caches are disposable and rebuild on cold instances, so initial routing/bus requests can be slower. The retained timetable's date range still applies.

**Hosted report saving is intentionally disabled**, as requested. `GET /api/reports/status` advertises availability to the UI. Vercel report POST/read/delete endpoints return 503 before opening SQLite, and the interface disables Save report with an explanation. Local reports continue to persist in SQLite. Do not move report storage into `/tmp` and call it durable: [Vercel does not provide persistent local SQLite storage](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel). A shared persistent database is required before hosted reporting can be enabled.

To test the integrated deployment:

```powershell
npx vercel login
npx vercel link
npx vercel dev --listen 3001
```

Open the printed URL and test `/api/health`, `/api/reports/status`, search, a walking journey, and a scheduled bus journey. `vercel dev` owns the `/api/*` routing. The Vite proxy is disabled under `VERCEL=1`; standalone `npm run dev` retains its local backend proxy, optionally overridden with `LUMA_LOCAL_API_URL`. No manual backend URL is needed on Vercel. Authentication and account linking must be completed by the repository owner; no Vercel project or deployment has been created by these changes.

## Interface and demo flow

The seven supplied HTML designs guide the rebuilt React interface: onboarding, Home, one-route-at-a-time comparison, navigation preview, crossing view, Report, and Settings. Atkinson Hyperlegible, large controls, visible labels, strong borders and the existing Luma palette replace the smaller layout. Desktop retains the existing map alongside the controls. On phones, Home and task screens fill the display; use the map button to open the unchanged map and category filters.

- First visit opens five-step setup: voice guidance, directions style, crossing preferences, display, and confirmation. Skip setup is available. Preferences persist on this device; Settings → Privacy → Repeat setup reopens it.
- Home offers voice entry (where supported), Type, Saved destinations, Where am I, and the last previewed destination. Before a first trip, an example Union Station → Nathan Phillips Square walk is available.
- Routes accepts both **From** and **To**. Use suggestions, GPS for the starting point, swap endpoints, or choose map points. Unconfirmed text disables routing. Save a destination to make it available from Home → Saved.
- Walk defaults to the fastest estimated walking time. Crossing preferences prioritize listed audible signals, fewer crossings, or mapped tactile paving using soft penalties. Choose a walking speed to change ETAs and reachable bus departures.
- Bus + walk uses scheduled TTC journeys with access/egress walking, waiting, and up to one same-stop transfer. Choose a departure in Toronto local time or leave now. Results include route numbers, headsigns and scheduled boarding/alighting times; a walking alternative is included when connected.
- The route chooser presents one real result at a time. Previous/Next switches routes; Read this route speaks the summary. The map button displays its geometry. Blue is walking, brown is bus travel, and dotted connectors are short unmapped approaches. Expand Step-by-step directions for the full itinerary. Edit journey returns to endpoints and preferences. Late responses cannot overwrite an edited journey.
- Preview route opens the large navigation controls. Repeat speaks the current instruction; What’s next announces the next instruction without advancing; Next preview step explicitly advances the simulation. Pause/Play controls automatic preview progression. The preview pauses at crossings, showing the actual street name and listed/unknown feature information. End route returns focus to the preview button.
- Clock instructions describe turns relative to the previous route segment, not the phone’s compass heading. Left/right remains the default. Both combines the instruction styles. Where am I during preview describes the simulated route position; on Home it requests GPS.
- Settings groups Voice, Directions, Crossings, Display, Screen reader and Privacy. Four themes, speech speed and larger text are supported. Feature icon shapes and basemap styling retain their existing design. Attribution is available under Privacy → About & data.

## Reports

Report can be opened from the main navigation, a mapped feature, or the flag in route preview. Preview reporting carries the crossing/intersection and approximate route position into an editable location field; it is explicitly marked as a simulated position. Other reports default to the selected starting point, which must be confirmed or changed. GPS is available as an explicit action.

Select Signal silent, No locator tone, Button hard to find, Tactile paving problem, Path blocked or Other issue. Voice entry fills editable notes when supported; typed entry remains available. Confirm the issue and location, add optional notes, then Save report. A success message is shown only after the server accepts the report. Back to route restores the same preview step.

`POST /api/reports` validates Toronto coordinates, issue types, source and text lengths. Reports persist in ignored `data/out/luma-reports.sqlite`, with a UUID, UTC timestamp and `unverified` status. `GET /api/reports/{id}` retrieves a record by its opaque identifier without exposing the deletion key. A random deletion key is returned only on creation and stored with this browser’s report history. `DELETE /api/reports/{id}` requires that key in `X-Report-Token`. Report history and deletion are available after saving and in Settings → Privacy.

Reports are prototype records: they are not sent to the City, moderated, verified, or automatically used to alter routes. The backend database and browser history survive restarts/reloads. Clearing browser storage removes the local history and deletion keys, not the server records. There are no accounts, ownership recovery or report-list endpoint; public deployment needs an account/moderation and retention design. Avoid personal information in free-text notes. Microphone recognition may use the browser provider’s speech service; app code stores only the submitted text, not recordings.

## Routing and data scope

Walking uses the full retained City of Toronto Pednet snapshot. Original connectivity is preserved with coordinates rounded to six decimal places; gaps are never bridged arbitrarily. Endpoints and bus stops are projected onto the nearest source edge, splitting that edge to avoid rounding to a distant intersection. Endpoint approaches are limited to 100 m; stop connections to 60 m. Connections are approximate and labelled unmapped, with their lengths included in travel time. Search covers collected places, stops, intersections and presets; it is not a full address geocoder. Map selection supports other points in Toronto.

The estimated physical cost is distance / chosen walking speed plus a 20-second allowance per complete source crossing. Default speed is 1.2 m/s. Accessibility selection adds preference costs: 120 seconds for a crossing with unknown audible coverage, 60 seconds per crossing when preferring fewer, and 45 seconds for unknown tactile coverage. These penalties influence path choice, not the displayed ETA. Split edges share a crossing's cost rather than multiplying it at every geometry vertex. Time comparisons always use physical estimates.

Audible signals match source PX identifiers first, then an intersection point within 45 m when no PX match exists. Per the prototype assumption, listed signals cover all crossing directions. Tactile proximity is a mapped feature within 8 m of either end of a source crossing. These spatial associations are estimates, not confirmation of individual curb/button coverage; unknown is not treated as confirmed absence. Street names are inferred from nearby City centreline geometry using distance and orientation. Directions include street names, geometry-derived turns, crossing context, and arrival/approach instructions.

Bus planning reads the retained TTC GTFS archive, combining routes, trips, stop_times, shapes, calendar and calendar_dates. Only bus route_type 3 is included. Previous-day times after 24:00, next-day departures, regular pickup/drop-off rules and service exceptions are respected. The timetable currently covers **2026-11-01 through 2026-12-21**; requests outside it fail explicitly. Search looks up to three hours ahead with walks up to 1 km at each end and a 60-second boarding/transfer buffer. One transfer between different bus routes at the same stop is supported. Walking preference costs influence both access and egress. Subway, streetcar, station interiors and transfers requiring a walk between stops are not implemented.

The pedestrian graph builds lazily on the first route request (roughly 20 seconds on the development machine; longer under load), then saves a local cache under `data/out/pedestrian-network-v3.pickle` for faster restarts. Source file or walking implementation changes invalidate it. GTFS is indexed into `data/out/ttc-schedule-v2.sqlite` on the first bus request (roughly 16 additional seconds); subsequent requests reuse it. The index rebuilds when the ZIP is newer. It is generated locally and excluded from Git. Network and cache initialization are locked against concurrent requests.

Accessibility preferences do not guarantee a safe route. Construction, live crossing phases, device faults, exact entrances and curb-level direction coverage remain unknown. Bus times are scheduled, without live vehicle arrivals, cancellations or disruption data. The spoken preview is a simulation; it does not track progress with GPS or announce when it is safe to cross. GPS can supply a starting point or report location. Testing has not established suitability for independent street navigation.

The basemap needs internet. Local search and routing use the checked-in snapshots. Location records marked planned/relocated or missing coordinates are excluded. Browser speech depends on installed voices. No accounts, paid map API or external routing service is required.

## Refreshing routing sources

The added `data/sources/centreline.geojson` contains 51,499 City street features for inferred names. Reproduce it using `.\.venv\Scripts\python -m backend.fetch_street_names`. Source: [Toronto GIS centreline layer](https://gis.toronto.ca/arcgis/rest/services/cot_geospatial/MapServer/2), filtered to FEATURE_CODE < 204000, WGS84. Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-license/).

The TTC ZIP is from [TTC routes and schedules](https://open.toronto.ca/dataset/ttc-routes-and-schedules/). Refresh `data/sources/ttc-gtfs.zip` and regenerate `data/ttc_stops.csv` using `data/sources/extract_gtfs.py` followed by `node data/sources/expand.mjs` together; restart the backend so calendars and graph stops reload. The planner follows the [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/). Snapshot refresh is explicit; the app does not silently download a new feed.

## Luma Compass prototype

In a route preview, tap the direction card to enter **Compass mode**. This pauses the timed preview, requests compass permission directly from the tap, and starts Find my direction. The full-screen mode shows a centered N/E/S/W compass, a live degree heading, a short status, and one Back button. Feedback settings and the developer demo remain in the route-preview panel. **Back** releases sensor watches and returns to the same preview step. You can also turn the existing **Luma Compass** panel on for movement feedback. Compass does not advance instructions or read live crossing phases. **Find my direction** asks you to stop somewhere safe and point the top of a flat, portrait phone forward. Movement tracking uses GPS course and displacement, never the direction a pocketed phone points. The existing map styling is unchanged.

The panel has large labelled controls, an explicit text status, screen-reader announcements, optional spoken feedback using the existing speech settings, and optional vibration patterns. It inherits all four themes and large-text settings. Expand **Compass options** to change feedback or test vibration. Browser vibration support varies, including devices that expose the API but do not vibrate; text and voice remain available. iOS Safari does not implement the Vibration API, so the web app cannot play automatic directional haptic patterns there. When the API is missing, Compass displays this limitation upfront and disables the vibration switch and test button. Native iOS integration is required for automatic iPhone haptics; there is no hidden-switch workaround in this app. See [MDN vibration compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate#browser_compatibility). Sensors need HTTPS (or localhost), user permissions, and foreground execution. They are released when the panel is disabled or navigation is left; readings are not stored. Sensor processing stays on the device; choosing Recalculate sends the GPS origin to the existing routing API.

**Try compass demo** works on desktop without sensors or location permission. Under **Developer demo**, adjust movement heading, phone heading, expected route bearing, GPS accuracy, walking speed, and phone-heading reliability. Find my direction uses the simulated phone heading; ordinary tracking uses simulated movement. Demo readings are clearly labelled and never trigger rerouting. Alignment and deviation thresholds are configurable here and are prototype values, not validated safety limits.

The compass face can show magnetic north without GPS; with a reliable location it corrects to true north. Missing or stale compass readings show no numeric heading or needle. GPS and route reliability checks still apply separately to all directional corrections. Safari native webkitCompassHeading values are displayed separately from alignment confidence: a tilted phone, unknown accuracy, or accuracy above 20 degrees may show an approximate dial reading while alignment feedback stays paused. A negative calibration accuracy still hides the unusable heading. Generic absolute-alpha readings still require a flat phone. The minimal screen now distinguishes motion permission, HTTPS, tilt, calibration, and missing-event problems rather than grouping them under Compass unavailable. The orientation engine uses signed angles, circular smoothing, hysteresis, sustained changes, a route-change settling period and alert cooldowns. It matches nearby pedestrian route geometry rather than pointing toward the destination. Imprecise/stale locations, uncertain headings, ambiguous turns, crossing proximity, unmapped connections and transit legs suspend corrections. Movement estimation requires a credible GPS movement baseline of up to 20 seconds with displacement exceeding reported positional uncertainty and plausible walking speed. Stable off-route locations expose **Recalculate from my location**, which invokes the existing planner with the selected preferences; route changes remain reviewable before another preview.

Phone compass readings are converted from magnetic north using the bundled WMM2025 model through [geomagnetism](https://github.com/naturalatlas/geomagnetism); out-of-range model dates suspend phone alignment. See [NOAA’s World Magnetic Model](https://www.ncei.noaa.gov/products/world-magnetic-model), [Apple’s magnetic-heading reference](https://developer.apple.com/documentation/webkitjs/deviceorientationevent/1804777-webkitcompassheading), and [browser orientation permissions](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static). Heading stability is only an estimate: browsers do not consistently expose magnetometer uncertainty. Physical-device and user testing are still required. Alignment never confirms a clear path or permission to cross.

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

