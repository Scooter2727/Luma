# Toronto visual accessibility data

**Start here: [WAYFINDER_ALL_LOCATIONS.csv](WAYFINDER_ALL_LOCATIONS.csv)** — one consolidated table of every collected location, with its feature, purpose, coordinates, source and transit routes. Original datasets are retained as supporting material; you do not need to join them to use this table. Pedestrian line geometry and full timetables remain separate, as agreed.

**Updated collection:** See [DATA_GUIDE.md](DATA_GUIDE.md) and `locations_and_purpose.csv` for the expanded location-and-purpose catalogue. The following describes the original snapshot only.

`toronto_visual_accessibility.csv` contains 1,407 City of Toronto accessible pedestrian signal inventory records and one separately identified historical tactile-surface pilot location. Prepared for the Wayfinder research prototype; no application has been built.

## Sources and scope

- Accessible signals: https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/MapServer/4 . Retrieved all records using `query?where=1%3D1&outFields=*&outSR=4326&f=json`. Original response is preserved in `sources/accessible-signals.json`. Download returned 1,407 records, with no transfer-limit flag; all have AUDIBLEPEDSIGNAL = 1. Coordinates use the API geometry transformed to WGS84 (EPSG:4326), latitude then longitude in the CSV. PX identifies the source signal record.
- Tactile surfaces: https://www.toronto.ca/services-payments/streets-parking-transportation/sidewalk-tours-wayfinding/accessible-streets/tactile-walking-surface-indicators/ . City page, modified August 12, 2024, describes the Shuter/Victoria pilot from November 2012 to July 2013, involving all four corners. It does not supply precise coordinates or establish current condition. This is one intersection-level historical record, not four invented asset points.
- Catalogue context: https://open.toronto.ca/dataset/traffic-signals-tabular/ . Metadata is preserved in `sources/traffic-signals-metadata.json` and identifies the Open Government Licence - Toronto: https://open.toronto.ca/open-data-license/ . Attribution: Contains information licensed under the Open Government Licence - Toronto.

## Interpretation

The textured paving is called tactile walking surface indicators (TWSIs). Accessible pedestrian signals (APS) are a different accommodation. A signal record does not establish tactile paving, every crossing direction, exact pushbutton position, current operation, or a complete accessible pedestrian route. The signal activation date was deliberately not presented as an APS installation or verification date.

No citywide tactile-surface location inventory was found in this search, including the Toronto catalogue query for `tactile`; this does not prove no inventory exists. The CSV is not an exhaustive inventory of accommodations for blind and low-vision people. Unknown values remain explicit or blank, never inferred as absence. No live functionality or field verification is claimed. Historical tactile records must not be treated as current installations.

## Columns and checks

One row per source signal location, plus one historical tactile intersection. `record_id` is unique. `accommodation_type`, `evidence_status`, `current_operational_status`, and `tactile_surface_status` distinguish evidence and uncertainty. `source_observation_period` is blank where unavailable. `retrieved_at_utc` is a download timestamp, not an inspection timestamp. Missing tactile coordinates are intentional.

CSV is UTF-8 with BOM, quoted fields, and CRLF line endings. Generation checks unique IDs, API truncation/error flags, and signal coordinates against a broad Toronto plausibility envelope. Raw data is retained for auditing. The source API did not provide a per-asset last-inspected timestamp.
