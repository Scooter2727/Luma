"""Indexed official TTC surface schedules and scheduled subway service.

Namespaces are essential: BusTime stop/trip IDs differ from the legacy timetable,
and surface route 1 is a shuttle bus, not subway Line 1.
"""
import csv
import io
import json
import sqlite3
import zipfile
from uuid import uuid4
from datetime import datetime, date, time
from functools import lru_cache
from threading import Lock
from zoneinfo import ZoneInfo
from .runtime import ROOT, cache_directory

TZ = ZoneInfo('America/Toronto')
SOURCES = (
    ('surface', ROOT / 'data/sources/ttc-surface-gtfs.zip', {'0', '3'}),
    ('subway', ROOT / 'data/sources/ttc-gtfs.zip', {'1'}),
)
_database_lock = Lock()


def seconds(value):
    h, m, s = map(int, value.split(':'))
    return h * 3600 + m * 60 + s


def reader(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig', newline=''))


def ident(source, value):
    return source + ':' + value


def raw_id(value):
    return value.split(':', 1)[-1]


def database():
    with _database_lock:
        return _database()


@lru_cache(maxsize=1)
def _database():
    path = cache_directory() / 'ttc-all-modes-v4.sqlite'
    stamp = json.dumps([(source, file.stat().st_mtime_ns, file.stat().st_size) for source, file, _ in SOURCES])
    if path.exists():
        try:
            with sqlite3.connect(path) as db:
                if db.execute('SELECT value FROM metadata WHERE key="stamp"').fetchone()[0] == stamp:
                    return path
        except (sqlite3.Error, TypeError):
            pass
    temporary = path.with_name(uuid4().hex + '.building')
    temporary.unlink(missing_ok=True)
    db = sqlite3.connect(temporary)
    try:
        db.executescript('''
          PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY;
          CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
          CREATE TABLE trips(id TEXT PRIMARY KEY,route TEXT,service TEXT,headsign TEXT,shape TEXT,direction TEXT);
          CREATE TABLE raw_times(trip_key INTEGER,stop_key INTEGER,seq INTEGER,arrival INTEGER,departure INTEGER,pickup INTEGER,dropoff INTEGER);
          CREATE TABLE shapes(id TEXT,seq INTEGER,lat REAL,lon REAL);
          CREATE TABLE stops(id TEXT PRIMARY KEY,payload TEXT);
        ''')
        # Compact numeric foreign keys avoid repeating long GTFS IDs in millions
        # of rows and indexes. Keep the public SQL view identical to the old table.
        db.executemany('INSERT INTO stops VALUES(?,?)', ((k,json.dumps(v)) for k,v in stop_metadata().items()))
        stop_keys={raw: key for key,raw in db.execute('SELECT rowid,id FROM stops')}
        for source, file, types in SOURCES:
            with zipfile.ZipFile(file) as z:
                routes = {r['route_id']: r for r in reader(z, 'routes.txt')}
                trips = {r['trip_id']: r for r in reader(z, 'trips.txt') if routes[r['route_id']]['route_type'] in types}
                db.executemany('INSERT INTO trips VALUES(?,?,?,?,?,?)', (
                    (ident(source, k), ident(source, t['route_id']), ident(source, t['service_id']), t['trip_headsign'], ident(source, t['shape_id']), t.get('direction_id', ''))
                    for k, t in trips.items()))
                trip_keys={raw_id(raw):key for key,raw in db.execute('SELECT rowid,id FROM trips WHERE id LIKE ?', (source+':%',))}
                def time_rows():
                    for r in reader(z, 'stop_times.txt'):
                        if r['trip_id'] in trips and r['arrival_time'] and r['departure_time']:
                            stop_key=stop_keys.get(ident(source,r['stop_id']))
                            if stop_key is not None:
                                yield (trip_keys[r['trip_id']],stop_key,int(r['stop_sequence']),seconds(r['arrival_time']),seconds(r['departure_time']),int(r.get('pickup_type') or 0),int(r.get('drop_off_type') or 0))
                db.executemany('INSERT INTO raw_times VALUES(?,?,?,?,?,?,?)', time_rows())
                shape_ids = {t['shape_id'] for t in trips.values()}
                db.executemany('INSERT INTO shapes VALUES(?,?,?,?)', (
                    (ident(source, r['shape_id']), int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon']))
                    for r in reader(z, 'shapes.txt') if r['shape_id'] in shape_ids))
        db.executescript('''
          CREATE INDEX stop_departure ON raw_times(stop_key,departure);
          CREATE INDEX trip_seq ON raw_times(trip_key,seq);
          CREATE INDEX shape_seq ON shapes(id,seq);
          DELETE FROM stops WHERE rowid NOT IN (SELECT DISTINCT stop_key FROM raw_times);
          CREATE VIEW times AS SELECT t.id AS trip,s.id AS stop,r.seq,r.arrival,r.departure,r.pickup,r.dropoff
            FROM raw_times r JOIN trips t ON t.rowid=r.trip_key JOIN stops s ON s.rowid=r.stop_key;
        ''')
        db.execute('INSERT INTO metadata VALUES(?,?)', ('stamp', stamp))
        db.commit()
    except BaseException:
        db.close()
        temporary.unlink(missing_ok=True)
        raise
    else:
        db.close()
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


@lru_cache(maxsize=64)
def active_services(day: date):
    ymd, weekday = day.strftime('%Y%m%d'), day.strftime('%A').lower()
    active = set()
    for source, file, _ in SOURCES:
        with zipfile.ZipFile(file) as z:
            active.update(ident(source, r['service_id']) for r in reader(z, 'calendar.txt') if r['start_date'] <= ymd <= r['end_date'] and r[weekday] == '1')
            for r in reader(z, 'calendar_dates.txt'):
                if r['date'] == ymd:
                    if r['exception_type'] == '1':
                        active.add(ident(source, r['service_id']))
                    else:
                        active.discard(ident(source, r['service_id']))
    return active


def feed_range():
    calendars = []
    for _, file, _ in SOURCES:
        with zipfile.ZipFile(file) as z:
            calendars.extend(reader(z, 'calendar.txt'))
    return min(r['start_date'] for r in calendars), max(r['end_date'] for r in calendars)


def service_epoch(day):
    return datetime.combine(day, time(12), TZ).timestamp() - 43200


def iso_at(day, sec):
    return datetime.fromtimestamp(service_epoch(day) + sec, TZ).isoformat()


@lru_cache(maxsize=1)
def route_metadata():
    result = {}
    for source, file, types in SOURCES:
        with zipfile.ZipFile(file) as z:
            for r in reader(z, 'routes.txt'):
                if r['route_type'] in types:
                    result[ident(source, r['route_id'])] = dict(r, mode={'0': 'streetcar', '1': 'subway', '3': 'bus'}[r['route_type']])
    return result


@lru_cache(maxsize=2)
def stop_metadata(served=False):
    if served:
        with sqlite3.connect(database()) as db:
            return {key:json.loads(payload) for key,payload in db.execute('SELECT id,payload FROM stops')}
    # Walking and construction matching only need stop coordinates. Do not build
    # the entire timetable database just to open a map or calculate a walk.
    result={}
    for source,file,types in SOURCES:
        with zipfile.ZipFile(file) as z:
            allowed=None
            if source=='subway':
                routes={r['route_id'] for r in reader(z,'routes.txt') if r['route_type'] in types}
                trips={r['trip_id'] for r in reader(z,'trips.txt') if r['route_id'] in routes}
                allowed={r['stop_id'] for r in reader(z,'stop_times.txt') if r['trip_id'] in trips}
            for r in reader(z,'stops.txt'):
                if allowed is None or r['stop_id'] in allowed:
                    key=ident(source,r['stop_id'])
                    result[key]=dict(r,stop_id=key,source=source)
    return result
