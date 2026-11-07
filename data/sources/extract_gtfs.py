"""Extract relationships from the preserved official GTFS archive; no network calls."""
import csv, io, json, zipfile
from pathlib import Path

root = Path(__file__).resolve().parent
with zipfile.ZipFile(root / 'ttc-gtfs.zip') as z:
    def read(name):
        return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig', newline=''))
    stops = list(read('stops.txt'))
    routes = list(read('routes.txt'))
    trips = {r['trip_id']: r for r in read('trips.txt')}
    links = set()
    for r in read('stop_times.txt'):
        t = trips[r['trip_id']]
        links.add((r['stop_id'], t['route_id'], t.get('direction_id', ''), t.get('trip_headsign', '')))
    calendars = list(read('calendar.txt'))
    exceptions = list(read('calendar_dates.txt'))
    assert len({r['stop_id'] for r in stops}) == len(stops)
    stop_ids = {r['stop_id'] for r in stops}
    route_ids = {r['route_id'] for r in routes}
    assert all(s in stop_ids and r in route_ids for s, r, _, _ in links)
    result = dict(stops=stops, routes=routes, stop_routes=[dict(zip(['stop_id','route_id','direction_id','trip_headsign'], r)) for r in sorted(links)], calendar=calendars, calendar_dates=exceptions, archive_members=z.namelist())
    (root / 'gtfs-extracted.json').write_text(json.dumps(result), encoding='utf-8')
    print(json.dumps({k:len(v) for k,v in result.items()}))
