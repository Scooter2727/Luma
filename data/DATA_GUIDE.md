# Location and purpose collection — November 7, 2026

Start with **locations_and_purpose.csv**. It supersedes the earlier `toronto_visual_accessibility.csv` snapshot. Do not concatenate the two. This research collection is not an exhaustive inventory or a current field survey.

**Latest expansion:** 5,834 tactile-paving records from a downloadable 2025 OpenStreetMap-derived snapshot were added after filtering against Toronto's official municipal polygon. See `tactile_paving_toronto.csv` for original tags and coordinates. The master now also includes Union Bus Terminal handrail wayfinding, and the Sherbourne Common record has been upgraded from a construction notice to a documented installation with an audio cue.

## Prototype assumptions requested by the user

`prototype_assumptions.json` and `prototype_feature_assumptions.csv` explicitly treat source data as correct, existing listed features as working, and all 1,407 APS intersections as equipped for every crossing direction in the hackathon demo. These are modelling assumptions. Original evidence fields remain unchanged. Unknown features are not invented; planned installations and relocated destinations retain their source status.

| File | Purpose |
| --- | --- |
| locations_and_purpose.csv | Master catalogue with names, locations, purposes, features, evidence and source URLs. |
| documented_vision_features.csv | Master excluding generic transit-stop context. Historical, planned and relocated records remain explicitly labelled. |
| locations_and_purpose.geojson | Master records with available coordinates for mapping. |
| ttc_stops.csv | 9,357 source stop records with original fields. Includes TTC stops outside Toronto; not municipally clipped. |
| ttc_routes.csv | 237 source routes and their modes. |
| ttc_stop_routes.csv | 27,986 unique stop/route/direction/headsign relationships across the schedule. |
| source_register.csv | Evidence sources and scope. |
| system_accessibility_features.csv | System-wide provider statements, not individual observations. |
| observed_service_notices.csv | Dated website notices requiring live rechecking. |
| collection_summary.json | Counts and checks. |
| sources/pedestrian-network.geojson | 87,105 official pedestrian-network geometries, preserved intact. |
| sources/ttc-gtfs.zip | Original trips, stop times, calendars, routes, stops and shapes. |
| sources/libraries.geojson | Full 112-record source; master uses only the 100 PhysicalBranch=1 entries. |

## Location and purpose fields

`location_id` identifies a record; `location_name` and `address_or_position` describe where it is. `purpose` describes what the location/feature helps a person do. `features` contains pipe-separated labels. `category` distinguishes infrastructure, services and transit context.

`latitude` and `longitude` use WGS84. Read `coordinate_precision`: signal points are not pushbuttons; stop points are not surveyed boarding positions; branch points are not entrances. Derived station coordinates are means of matching named GTFS points, explicitly labelled, not indoor asset locations. Missing coordinates are intentionally blank.

`source_id` and `source_url` identify the feature evidence. `coordinate_source_id` identifies coordinate provenance separately. `related_stop_ids` joins to `ttc_stops.csv`; station name matches are candidates, not verified bus-bay mappings. GTFS stop IDs can change between publications.

`evidence_status`, `observed_period` and `operational_status` distinguish provider claims, historical reports, planned work, elapsed pilots and relocation. `collected_date` is a research date, not a field inspection. Unknown does not mean absent, and published presence does not prove present-day operation.

## Interpretation

- Generic TTC stop rows locate transit service; they do not establish tactile paving or stop-mounted audio devices. Vehicle route announcements are recorded as a fleet-level feature.
- `wheelchair_boarding` is the original mobility-access code, not a vision rating. Consult https://gtfs.org/documentation/schedule/reference/#stopstxt for code meanings and inheritance.
- Line 6 feature records link Metrolinx's explicit line-wide tactile-surface statement to 36 directional GTFS platform points at 18 named stations. These are not independent inspections. TTC separately documents Braille-labelled assistance intercoms; exact device positions remain unknown.
- Library features apply TPL's published equipment statements to physical branches; named-branch additions are retained. Individual equipment may be unavailable.
- A stop context row and a feature row may describe the same physical site. Do not count catalogue rows as unique installations.
- York Mills is documented as a pilot; Dufferin/exit-sign pilot dates ended in September 2026. Source verification of continued operation is unavailable; the demo uses the user's working-feature assumption. Old Mill remains planned. Sherbourne's later opening article now confirms installation.
- CNIB's 2026 relocation notice overrides older listings of its Yonge Street hub. The old address is marked `relocated_do_not_route`.

## Schedule and routing scope

The TTC archive's calendar covers November 1–December 21, 2026; catalogue modification date is November 5. Stop-route membership alone does not establish service today. Use trips, stop_times, calendar and calendar_dates together from the retained ZIP.

No pathways.txt, transfers.txt or levels.txt was present. Indoor paths and bus-bay connections were not invented. Pedestrian geometry is useful map context, not proof of a continuously accessible route. Its topology, length units and linkages need validation before routing.

## Remaining gaps and collection failures

Exact tactile extents, crossing-specific APS coverage, button positions, live faults, temporary obstacles, and entrance-to-platform paths remain incomplete. Overpass requests failed, but a downloadable third-party OSM snapshot was subsequently obtained. This is incomplete community mapping, not the City's tactile asset inventory. The live TTC disruption catalogue is referenced but no live integration was built. Static service notices must be rechecked.

## Provenance and reproduction

Raw City GIS data, library and pedestrian geometry, GTFS and catalogue metadata are retained under sources/. City attribution: Contains information licensed under the Open Government Licence – Toronto (https://open.toronto.ca/open-data-license/). Website findings are short factual summaries with links, not represented as openly licensed bulk data.

Tactile snapshot attribution: © OpenStreetMap contributors, distributed by EmbedEarth, under ODbL 1.0. See https://www.openstreetmap.org/copyright and https://huggingface.co/datasets/EmbedEarth/tactile-paving . Preserve ODbL attribution and applicable database redistribution obligations when publishing these data or a derived database. The master contains this OSM-derived subset; its sources must not all be labelled City open data.

`sources/collect_tactile_snapshot.py` streamed 1,100,000 global rows and retained 9,151 bounding-box candidates. `sources/filter_tactile_snapshot.py` retained 5,834 unique source-ID/geometry records within the City's published WGS84 polygon and excluded 3,317 outside it. Original candidate and filtered JSON, source tags and the municipal shapefile ZIP are retained. Source OSM element type is absent in the third-party snapshot, so numeric IDs are not automatically turned into node URLs. Nearby signal names are derived labels with straight-line distances, not surveyed addresses or route connections. A missing sound/vibration tag remains unknown. Records are not deduplicated against official signal points because tactile paving and APS are different feature types.

`sources/extract_gtfs.py` extracts GTFS relationships and checks foreign keys. `sources/expand.mjs` compiles the master and supporting CSVs. They operate on retained snapshots; running them does not refresh sources. Recheck evidence and update snapshots before changing collection dates. These are data preparation scripts, not application implementation.

CSVs use UTF-8 BOM, quoted fields and CRLF. Checks cover unique record IDs, source references, GTFS foreign keys, coordinate plausibility and output row counts. No field verification was performed.
