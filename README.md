# Luma

A responsive, accessibility-first Toronto map and journey-planning prototype. React + Vite + TypeScript, MapLibre GL JS, FastAPI, Pydantic and NetworkX. Includes the supplied Luma logo, four selectable themes, local destination search, category icons and filters, source details, construction-aware walking and TTC bus/streetcar/subway journeys, route comparison and spoken step previews.

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

AI voice is optional. To enable it locally, copy `.env.example` to `.env` and fill in the backend-only variables below (the file is gitignored). The backend reads `.env` on startup and never sends these values to the browser. ElevenLabs needs only `ELEVENLABS_API_KEY`; Gemini is optional and only rephrases instructions. Without an ElevenLabs key, Luma uses the device voice.

| Variable | Purpose | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` | Google Gemini key for rewording route instructions | Optional |
| `GEMINI_MODEL` | Gemini model | `gemini-3.8-flash` (`gemini-2.5-flash` is closed to new keys) |
| `ELEVENLABS_API_KEY` | ElevenLabs API key, starting with `sk_` (not the key ID) | Required for AI voice |
| `ELEVENLABS_VOICE_ID` | ElevenLabs voice | Premade "George" voice |
| `ELEVENLABS_MODEL_ID` | ElevenLabs model | `eleven_flash_v2_5` |

Open http://localhost:5173 . To view on a phone on the same Wi-Fi, use the Network URL printed by Vite and allow local network access in the firewall. Ordinary HTTP over a LAN may not permit device geolocation; the preset start works without it. HTTPS is needed for geolocation on most non-localhost devices. The Vite proxy forwards API requests, so the phone only needs port 5173.

## Vercel deployment

`vercel.json` defines two services in one project:

| Service | Build context | Entrypoint/output | Public paths | Bindings |
| --- | --- | --- | --- | --- |
| `app` | Repository root | Vite → `dist/` | Everything outside `/api/*` | None |
| `backend` | Repository root | FastAPI `backend.app:app` | `/api/*` only | None |

The backend intentionally uses `root: "."`, rather than `root: "backend"`: it imports the `backend` Python package and reads the sibling `data/` tree. Root `pyproject.toml` supplies its Python 3.12 runtime dependencies and entrypoint. Vercel builds the Vite and Python services independently. Keep the Vercel project Root Directory at the repository root and let the checked-in service settings choose frameworks/build commands.

The more-specific `/api/(.*)` rewrite precedes the frontend catch-all. Vercel passes the original `/api/...` path through, matching the existing FastAPI routes. Browser calls already use relative `/api/...` URLs, so deployed requests share the page's origin and need no hardcoded hostname or frontend URL variable. There are no server-side service-to-service calls to bind: the Vite output is static. A runtime binding would become necessary if a server-side proxy were later added; do not expose a binding URL through `VITE_*` or invent one during a build. See [Services routing](https://vercel.com/docs/services/routing) and [Service bindings](https://vercel.com/docs/services/bindings).

Function settings explicitly include the six runtime data files needed for routing, including the matching BusTime surface GTFS archive. The remaining data collection exports (about 60 MB), local environments, node modules, generated caches, frontend assets and tests are excluded from the Python bundle. Explicit includes restore the required runtime files after the broad data exclusion. `.vercelignore` also excludes local state and environment files from source uploads. The static GTFS archives are bundled; live City/TTC feeds are fetched and cached by the backend.

Walking and transit caches use the system temporary directory when Vercel injects `VERCEL=1`; local development still uses `data/out/`. `LUMA_CACHE_DIR` is an optional writable cache directory override, not a service binding. Caches are disposable and rebuild on cold instances, so initial routing/transit requests can be slower. The retained timetable's date range still applies.

**Hosted report saving is intentionally disabled**, as requested. `GET /api/reports/status` advertises availability to the UI. Vercel report POST/read/delete endpoints return 503 before opening SQLite, and the interface disables Save report with an explanation. Local reports continue to persist in SQLite. Do not move report storage into `/tmp` and call it durable: [Vercel does not provide persistent local SQLite storage](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel). A shared persistent database is required before hosted reporting can be enabled.

**AI voice keys are Vercel Environment Variables for the `backend` service**, set in the Vercel project dashboard (or with `npx vercel env add`), not in `vercel.json` and never as `VITE_*` variables. `VITE_*` values are compiled into the public frontend bundle. `.env` is excluded from uploads, and the deployed backend does not read it. `GET /api/speech/status` advertises availability to the UI, as reports do. Without `ELEVENLABS_API_KEY`, `/api/speech/synthesize` returns 503. Gemini availability does not gate ElevenLabs audio. Synthesized audio is cached in the same disposable cache directory (`speech-cache/`) and is regenerated on cold instances. The synthesis and rephrase endpoints are unauthenticated proxies to paid APIs, capped at 1,000 characters per text and 80 steps per route; a public deployment needs rate limiting or authentication before keys are added.

To test the integrated deployment:

```powershell
npx vercel login
npx vercel link
npx vercel dev --listen 3001
```

Open the printed URL and test `/api/health`, `/api/reports/status`, search, a walking journey, and a scheduled bus journey. `vercel dev` owns the `/api/*` routing. The Vite proxy is disabled under `VERCEL=1`; standalone `npm run dev` retains its local backend proxy, optionally overridden with `LUMA_LOCAL_API_URL`. No manual backend URL is needed on Vercel. Authentication and account linking must be completed by the repository owner; no Vercel project or deployment has been created by these changes.

## Interface and demo flow

The seven supplied HTML designs guide the rebuilt React interface: onboarding, Home, route comparison, navigation preview, crossing view, Report, and Settings. Atkinson Hyperlegible, large controls, visible labels, strong borders and the existing Luma palette replace the smaller layout. Desktop retains the existing map alongside the controls. On phones, route selection fills the display; its map button opens all route lines on the map. Other task screens also fill the display.

- First visit opens five-step setup: colour and display, voice guidance, directions style, crossing preferences, and confirmation. Skip setup is available. Desktop setup appears over the existing map. Preferences persist on this device; Settings → Privacy → Repeat setup reopens it.
- Home offers voice entry (where supported), Type, Saved destinations, Where am I, and the last previewed destination. Before a first trip, an example Union Station → Nathan Phillips Square walk is available.
- Routes accepts both **From** and **To**. Use suggestions, GPS for the starting point, swap endpoints, or choose map points. Unconfirmed text disables routing. Save a destination to make it available from Home → Saved.
- Walk defaults to the fastest estimated walking time. Crossing preferences prioritize listed audible signals, fewer crossings, or mapped tactile paving using soft penalties. ETAs and reachable bus departures use a fixed walking speed of 1.2 m/s.
- Transit uses TTC bus, streetcar and subway journeys with access/egress walking, waiting, and up to one transfer. Leave now or choose a Toronto departure time. Results show boarding/exit stops and live/scheduled timing; a walking alternative is included when connected.
- The route chooser displays up to three real results together. Tap a map line or use the previous/next arrows to choose a route without another planning request. Route styles stay fixed: the accessibility option is solid, the fastest is rectangular dashes, and the alternative is rounded dots. The selected or hovered route stays in colour and is drawn in front, while the others turn grey. Colours follow the selected theme, and the route panel shows the selected journey’s details. Starting navigation uses the selected result and hides the alternatives. Edit journey returns to endpoints and preferences. Late responses cannot overwrite an edited journey.
- Walking alternatives use bounded A* searches with penalties on already-used edges, retaining the fastest route and any requested preference route first. Only distinct, connected pedestrian paths are returned; shared geometry is never shifted or fabricated. Candidates sharing more than 95% of an existing path or exceeding 1.5 times the baseline walking time plus two minutes are omitted. Searches stop after four attempts or three results, so fewer options can be returned. Distances and ETAs use the actual path rather than the search penalty. Scheduled bus alternatives retain their original GTFS geometry and timing.
- Preview route opens the large navigation controls. Repeat speaks the current instruction; What’s next announces the next instruction without advancing; Next preview step explicitly advances the simulation. Pause/Play controls automatic preview progression. The preview pauses at crossings, showing the actual street name and listed/unknown feature information. End route returns focus to the preview button.
- Clock instructions describe turns relative to the previous route segment, not the phone’s compass heading. Left/right remains the default. Both combines the instruction styles. Where am I during preview describes the simulated route position; on Home it requests GPS.
- Settings groups Voice, Directions, Crossings, Display, Screen reader and Privacy. Four themes, speech speed and larger text are supported. When the server has AI voice configured, Voice settings and setup offer **Try AI voice (experimental)**, off by default, with Test AI voice and a status line saying which voice is in use. Feature icon shapes and basemap styling retain their existing design. Attribution is available under Privacy → About & data.

## Reports

Report can be opened from the main navigation, a mapped feature, or the flag in route preview. Preview reporting carries the crossing/intersection and approximate route position into an editable location field; it is explicitly marked as a simulated position. Other reports default to the selected starting point, which must be confirmed or changed. GPS is available as an explicit action.

Select Signal silent, No locator tone, Button hard to find, Tactile paving problem, Path blocked or Other issue. Voice entry fills editable notes when supported; typed entry remains available. Confirm the issue and location, add optional notes, then Save report. A success message is shown only after the server accepts the report. Back to route restores the same preview step.

`POST /api/reports` validates Toronto coordinates, issue types, source and text lengths. Reports persist in ignored `data/out/luma-reports.sqlite`, with a UUID, UTC timestamp and `unverified` status. `GET /api/reports/{id}` retrieves a record by its opaque identifier without exposing the deletion key. A random deletion key is returned only on creation and stored with this browser’s report history. `DELETE /api/reports/{id}` requires that key in `X-Report-Token`. Report history and deletion are available after saving and in Settings → Privacy.

Reports are prototype records: they are not sent to the City, moderated, verified, or automatically used to alter routes. The backend database and browser history survive restarts/reloads. Clearing browser storage removes the local history and deletion keys, not the server records. There are no accounts, ownership recovery or report-list endpoint; public deployment needs an account/moderation and retention design. Avoid personal information in free-text notes. Microphone recognition may use the browser provider’s speech service; app code stores only the submitted text, not recordings.

## AI voice

AI-generated phrasing and third-party voice synthesis are best-effort. Luma falls back to the device's built-in voice automatically whenever AI voice is off, unconfigured, slow or failing. The deterministic instruction text and clock-position logic are unchanged and remain the source of truth for routing-relevant facts. The on-screen and screen-reader announcement always shows that text, set before any audio request. Screen-reader mode never plays AI audio.

Every route step carries `ai_text`: the instruction in the chosen directions style, built on the server the same way as the browser's `instructionText()`. After routes load with AI voice on, the browser asks `POST /api/speech/rephrase` to reword each route in one Gemini request, in the background. A 20-step route takes about 6 seconds, so route planning never waits for it. Gemini runs at temperature 0.2 under instructions to add no facts. The server then keeps a rewrite only if it preserves the street name, every number, the left/right/clock wording and every caution such as "unknown" or "confirm", adds no signal, tactile or crossing claims, and stays within 1.5 times the original length. Anything else, including errors, timeouts and malformed replies, keeps the original wording.

`/api/speech/synthesize` (`GET ?text=` for the audio element, or `POST` with a JSON body) streams 64 kbps MP3 from ElevenLabs' low-latency Flash model as it is generated, and caches complete clips on disk by text, voice and model. To keep speech prompt:

- While routes are compared, audio for each route's first two steps is downloaded, and downloaded again once background rephrasing changes their wording. During a preview, the next step is downloaded while the current one plays. Downloaded clips start instantly.
- Anything not yet downloaded plays through the audio element as it streams, so speech starts with the first bytes rather than after the whole clip.
- If speech has not started within 10 seconds, the instruction is spoken with the device voice instead. Background downloads may take up to 15 seconds. Two failures pause ElevenLabs attempts for 30 seconds, then retry automatically. Voice status refreshes after 30 seconds; provider errors use safe messages without keys or raw upstream responses.
- Taps that can lead to AI speech (turning it on, Test AI voice, starting a preview) play a silent clip, so iOS Safari later allows instructions that are not triggered by a tap.

Two failures in a row turn AI voice off for the rest of the session; the status line reports it, and Test AI voice tries again. When AI voice is on, instruction text, including street and destination names, is sent to Google and ElevenLabs. GPS coordinates are not sent.

## Routing and data scope

Walking uses the full retained City of Toronto Pednet snapshot. Original connectivity is preserved with coordinates rounded to six decimal places; gaps are never bridged arbitrarily. Endpoints and bus stops are projected onto the nearest source edge, splitting that edge to avoid rounding to a distant intersection. Endpoint approaches are limited to 100 m; stop connections to 60 m. Connections are approximate and labelled unmapped, with their lengths included in travel time. Search covers collected places, stops, intersections and presets; it is not a full address geocoder. Map selection supports other points in Toronto.

The estimated physical cost is distance / walking speed plus a 20-second allowance per complete source crossing. The app uses a constant 1.2 m/s. Accessibility selection adds preference costs: 120 seconds for a crossing with unknown audible coverage, 60 seconds per crossing when preferring fewer, and 45 seconds for unknown tactile coverage. These penalties influence path choice, not the displayed ETA. Split edges share a crossing's cost rather than multiplying it at every geometry vertex. Time comparisons always use physical estimates.

Audible signals match source PX identifiers first, then an intersection point within 45 m when no PX match exists. Per the prototype assumption, listed signals cover all crossing directions. Tactile proximity is a mapped feature within 8 m of either end of a source crossing. These spatial associations are estimates, not confirmation of individual curb/button coverage; unknown is not treated as confirmed absence. Street names are inferred from nearby City centreline geometry using distance and orientation. Directions include street names, geometry-derived turns, crossing context, and arrival/approach instructions.

Transit planning combines the official BusTime surface GTFS with retained scheduled subway data. Calendar exceptions, previous-day times after 24:00, next-day departures, and pickup/drop-off rules are respected. It searches up to three hours ahead with access/egress walks up to 1 km and one same-stop or mapped walking transfer. Static feed coverage is finite; see the live-data section below for matching, caching, limitations, and refresh instructions.

The pedestrian graph and combined TTC stop/time index build lazily, then reuse disposable caches under `data/out/pedestrian-network-v4.pickle` and `data/out/ttc-all-modes-v4.sqlite`. The initial cold build takes longer (about 50 seconds total on the development machine); warm journeys are much faster. Source changes invalidate caches. Cache initialization is locked, and generated files are excluded from Git.

Accessibility preferences do not guarantee a safe route. Construction, live crossing phases, device faults, exact entrances and curb-level direction coverage remain unknown. Bus times are scheduled, without live vehicle arrivals, cancellations or disruption data. The spoken preview is a simulation; it does not track progress with GPS or announce when it is safe to cross. GPS can supply a starting point or report location. Testing has not established suitability for independent street navigation.

The basemap needs internet. Local search and routing use the checked-in snapshots. Location records marked planned/relocated or missing coordinates are excluded. Browser speech depends on installed voices. No accounts, paid map API or external routing service is required.

## Refreshing routing sources

The added `data/sources/centreline.geojson` contains 51,499 City street features for inferred names. Reproduce it using `.\.venv\Scripts\python -m backend.fetch_street_names`. Source: [Toronto GIS centreline layer](https://gis.toronto.ca/arcgis/rest/services/cot_geospatial/MapServer/2), filtered to FEATURE_CODE < 204000, WGS84. Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-license/).

The retained subway timetable comes from [TTC routes and schedules](https://open.toronto.ca/dataset/ttc-routes-and-schedules/); the surface companion comes from [TTC BusTime schedules](https://open.toronto.ca/dataset/surface-routes-and-schedules-for-bustime/). Run `python -m backend.update_transit_data` and restart/redeploy to refresh both. Graph stops come directly from the two archives; `data/ttc_stops.csv` remains map context. Static snapshot updates are explicit; live feed refreshes are automatic.

## Luma Compass prototype

In a route preview, tap the direction card to enter **Compass mode**. This pauses the timed preview, requests compass permission directly from the tap, and starts Find my direction. The full-screen mode shows a centered N/E/S/W compass, a live degree heading, a short status, a Back button and a Start demo button. Feedback settings and the developer demo remain in the route-preview panel. **Back** releases sensor watches and returns to the same preview step. You can also turn the existing **Luma Compass** panel on for movement feedback. Compass does not advance instructions or read live crossing phases. **Find my direction** asks you to stop somewhere safe and point the top of a flat, portrait phone forward. Movement tracking uses GPS course and displacement, never the direction a pocketed phone points. The existing map styling is unchanged.

The panel has large labelled controls, an explicit text status, screen-reader announcements, optional spoken feedback using the existing speech settings, and optional vibration patterns. It inherits all four themes and large-text settings. Expand **Compass options** to change feedback or test vibration. Browser vibration support varies, including devices that expose the API but do not vibrate; text and voice remain available. iOS Safari does not implement the Vibration API, so the web app cannot play automatic directional haptic patterns there. When the API is missing, Compass displays this limitation upfront and disables the vibration switch and test button. Native iOS integration is required for automatic iPhone haptics; there is no hidden-switch workaround in this app. See [MDN vibration compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate#browser_compatibility). Sensors need HTTPS (or localhost), user permissions, and foreground execution. They are released when the panel is disabled or navigation is left; readings are not stored. Sensor processing stays on the device; choosing Recalculate sends the GPS origin to the existing routing API.

**Start demo** in the full-screen compass starts a stationary pointing game using the phone’s actual heading. A random point appears on the compass rim. The default outline is red with fast beeps when more than 35 degrees away, orange with slower beeps for a 15–35 degree adjustment, and green and quiet within 15 degrees. Three continuous aligned seconds select another target at least 60 degrees away. Leaving alignment, missing/unreliable readings, backgrounding, or a long timer gap resets the hold. Colourblind/high-contrast themes substitute their own outline colours; line patterns and text also identify states. This game uses no destination, GPS fix or street-crossing advice.

Start demo creates/resumes Web Audio from the tap for Safari playback. **Sound on/off** controls beeps; **Stop demo**, Back and backgrounding stop pulses. Fast and slow cues run every 450 ms and 1,250 ms, respectively; repeated state changes cannot pulse more often than every 300 ms. Supported vibration browsers also request short pulses using the saved vibration preference. iPhone Safari uses beeps rather than automatic haptics. No hidden switch workaround or native wrapper was added. Audio failure is visible and can be retried by tapping Sound off. The audio context closes when leaving Compass.

**Try compass demo** works on desktop without sensors or location permission. Under **Developer demo**, adjust movement heading, phone heading, expected route bearing, GPS accuracy, simulated movement speed, and phone-heading reliability. This simulated sensor speed does not change routing ETAs. Find my direction uses the simulated phone heading; ordinary tracking uses simulated movement. Demo readings are clearly labelled and never trigger rerouting. Alignment and deviation thresholds are configurable here and are prototype values, not validated safety limits.

The compass face can show magnetic north without GPS; with a reliable location it corrects to true north. Missing or stale compass readings show no numeric heading or needle. GPS and route reliability checks still apply separately to all directional corrections. Safari native webkitCompassHeading values are displayed separately from alignment confidence: a tilted phone, unknown accuracy, or accuracy above 20 degrees may show an approximate dial reading while alignment feedback stays paused. A negative calibration accuracy still hides the unusable heading. Generic absolute-alpha readings still require a flat phone. The minimal screen now distinguishes motion permission, HTTPS, tilt, calibration, and missing-event problems rather than grouping them under Compass unavailable. The orientation engine uses signed angles, circular smoothing, hysteresis, sustained changes, a route-change settling period and alert cooldowns. It matches nearby pedestrian route geometry rather than pointing toward the destination. Imprecise/stale locations, uncertain headings, ambiguous turns, crossing proximity, unmapped connections and transit legs suspend corrections. Movement estimation requires a credible GPS movement baseline of up to 20 seconds with displacement exceeding reported positional uncertainty and plausible walking speed. Stable off-route locations expose **Recalculate from my location**, which invokes the existing planner with the selected preferences; route changes remain reviewable before another preview.

Phone compass readings are converted from magnetic north using the bundled WMM2025 model through [geomagnetism](https://github.com/naturalatlas/geomagnetism); out-of-range model dates suspend phone alignment. See [NOAA’s World Magnetic Model](https://www.ncei.noaa.gov/products/world-magnetic-model), [Apple’s magnetic-heading reference](https://developer.apple.com/documentation/webkitjs/deviceorientationevent/1804777-webkitcompassheading), and [browser orientation permissions](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static). Heading stability is only an estimate: browsers do not consistently expose magnetometer uncertainty. Physical-device and user testing are still required. Alignment never confirms a clear path or permission to cross.

## Checks

```powershell
npm run build
.\.venv\Scripts\python -m pytest backend -q
npm run test:e2e
```

Frontend tests need Playwright Chromium (`npx playwright install chromium`) and both local servers running.

`pytest backend` includes the AI voice tests (`test_speech_phrasing.py`, `test_speech_audio.py`, `test_speech_api.py` and the `ai_text` cases in `test_routing.py`). They mock Gemini and ElevenLabs, and `backend/conftest.py` clears the speech keys, so they never use a real key or the network, even with a filled-in `.env`. `web/tests/speech.spec.ts` and `web/tests/speech-ui.spec.ts` cover the browser fallback, start timeout, circuit breaker, prefetching, iOS audio unlock and Settings toggle against mocked speech endpoints.

## Attribution

Contains information licensed under the Open Government Licence – Toronto. Tactile snapshot © OpenStreetMap contributors, distributed by EmbedEarth under ODbL 1.0. Source links remain on location details. Basemap: OpenFreeMap / OpenMapTiles, © OpenStreetMap contributors. Custom style in public/maps/simple.json derives from OpenFreeMap Positron. Provider summaries retain links to their publishers. See `data/DATA_GUIDE.md` for collection provenance and assumptions.

## Made by Scott and James for TrentHacks 2026


## Construction and live TTC data

The existing NetworkX walking graph, MapLibre renderer, route patterns, palettes, voice, and Compass are retained. **Transit** extends the previous bus planner to buses, streetcars, and scheduled subways, with up to one transfer. ETAs include access/egress walking, expected waiting, riding, mapped transfer walks, and a 60-second boarding buffer. Subway access/exit adds estimated 120/90-second station allowances; platform transfers add 120 seconds. Indoor station pathways are not mapped. The existing 1 km limit applies to each access/egress walk. Transfers use the closure-filtered pedestrian graph, with walks up to 200 m between stops within 100 m of each other.

### Construction

- Requested [ArcGIS layer 5](https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/FeatureServer/5) is fetched alongside the City's [current Version 3 restrictions](https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json). At implementation, layer 5 returned only two older ramp records; Version 3 supplies current road extents.
- Date windows, recurring hours, overnight windows, street names, geometry alignment, and explicitly stated sidewalk side are checked. Only a positively described, currently active pedestrian closure with a resolvable extent and side removes graph edges. Vehicle closures, partial/alternating work, unspecified sidewalk sides, and point-only records remain visible as uncertain/unmapped. The opposite sidewalk stays available.
- Walking alternatives and every transit walking connection use the filtered request graph. The shared base network is never edited. ETAs come from the detour's actual distance and crossing costs.
- Construction triangles and dashed extents appear at street zoom; tapping a triangle opens its title, directions, source, and report actions. Uncertainty remains in routing metadata; unidentified closures do not block paths. The basemap is unchanged. The client checks conditions every minute and recalculates comparisons when the blocking revision changes. Active navigation returns to updated choices if a new confirmed closure intersects its mapped pedestrian segments.
- Version 3 caches for 120 seconds; ArcGIS for 300 seconds. Failed refreshes may use a labelled last-known snapshot for ten additional minutes. If neither feed is available, routes report construction coverage as unavailable.

### TTC predictions and schedules

- Official [trip updates](https://bustime.ttc.ca/gtfsrt/trips) and [vehicle positions](https://bustime.ttc.ca/gtfsrt/vehicles) cache for 30 seconds. Feed/entity timestamps older than 120 seconds are not called live. Vehicle positions provide matched context; they are never extrapolated into invented ETAs.
- `data/sources/ttc-surface-gtfs.zip` is TTC's [BusTime companion surface schedule](https://open.toronto.ca/dataset/surface-routes-and-schedules-for-bustime/). Its trip/stop IDs differ from the older timetable. Surface and subway IDs are namespaced to avoid collisions, including surface shuttle route 1 versus subway Line 1.
- Predictions require exact trip, route, direction (where supplied), service day, and stop/sequence matches. Absolute times and delay propagation are supported; `NO_DATA` ends propagation. Cancelled trips and skipped stops cannot be boarded. Prediction changes affect waiting, transfer feasibility, and total journey time.
- Journey comparisons, boarding-step views, and map-stop details show upcoming arrivals, refreshing every 30 seconds while visible. Transit comparisons refresh in the background without a full-screen loader or changing the selected route role. Switching alternatives does not generate a new route request. No hidden-tab polling, push notifications, or alerts system is added.
- **Live**, **Scheduled**, and mixed journeys are identified separately. Missing, stale, unmatched, or future predictions fall back to schedules. Subway times always remain scheduled. Feed availability does not imply every trip has a prediction.
- `GET /api/conditions`, `GET /api/transit/arrivals?stop_id=surface:123`, and `GET /api/transit/arrivals?longitude=...&latitude=...` provide the data. An optional `at=` sets a Toronto departure time. `/api/routes` accepts `mode: "transit"`; `"bus"` remains an API compatibility alias.

The bundled surface schedule covers November 1 to December 19, 2026; subway schedules extend through December 21. Refresh before restarting the backend/redeploying:

```powershell
.\.venv\Scripts\python -m backend.update_transit_data
```

The updater uses HTTP validators on subsequent runs and validates archives before atomic replacement. No Google-generated routing content is used: Google's [Routes API policy](https://developers.google.com/maps/documentation/routes/policies) requires mapped results to appear on a Google Map, which is incompatible with rendering them on MapLibre. City/TTC data contains information licensed under the [Open Government Licence - Toronto](https://open.toronto.ca/open-data-license/).

Tests set `LUMA_EXTERNAL_DATA=0` and inject deterministic feed fixtures; normal development/hosting uses live feeds by default. The static stop/time index and walking network use disposable caches, so their first build on a cold instance can take longer.

Walking loads stop coordinates directly from the official static archives without building the full TTC timetable. Transit indexing uses compact numeric trip/stop references (about 262 MB for the bundled data), keeps the existing query interface through a SQL view, and sorts indexes in memory to avoid exhausting serverless temporary storage.
