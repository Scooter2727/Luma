"""Official TTC GTFS-RT. Predictions require exact static trip/route/stop matches."""
import time
from datetime import datetime, timedelta
from google.transit import gtfs_realtime_pb2
import httpx
from .live_cache import CachedFeed
from .transit_data import raw_id, service_epoch, TZ

TRIPS = 'https://bustime.ttc.ca/gtfsrt/trips'
VEHICLES = 'https://bustime.ttc.ca/gtfsrt/vehicles'
MAX_AGE = 120


def event(value):
    return {key: getattr(value, key) for key in ('time', 'delay', 'uncertainty') if value.HasField(key)}


def fetch_feed(url, vehicle=False):
    response = httpx.get(url, timeout=8, follow_redirects=True)
    response.raise_for_status()
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response.content)
    if not feed.header.HasField('timestamp') or feed.header.incrementality != 0:
        raise ValueError('A timestamped full GTFS-RT feed is required')
    entries = []
    for entity in feed.entity:
        if entity.is_deleted:
            continue
        if vehicle and entity.HasField('vehicle'):
            v = entity.vehicle
            if not v.HasField('trip') or not v.HasField('position'):
                continue
            entries.append(dict(trip_id=v.trip.trip_id, route_id=v.trip.route_id,
                                direction_id=str(v.trip.direction_id) if v.trip.HasField('direction_id') else None,
                                id=v.vehicle.id, timestamp=v.timestamp or feed.header.timestamp,
                                longitude=v.position.longitude, latitude=v.position.latitude))
        elif not vehicle and entity.HasField('trip_update'):
            u = entity.trip_update
            entries.append(dict(trip_id=u.trip.trip_id, route_id=u.trip.route_id,
                                direction_id=str(u.trip.direction_id) if u.trip.HasField('direction_id') else None,
                                start_date=u.trip.start_date, relationship=u.trip.schedule_relationship,
                                timestamp=u.timestamp or feed.header.timestamp,
                                delay=u.delay if u.HasField('delay') else None,
                                stops=[dict(stop_id=s.stop_id, seq=s.stop_sequence or None,
                                            relationship=s.schedule_relationship,
                                            arrival=event(s.arrival), departure=event(s.departure)) for s in u.stop_time_update]))
    return dict(timestamp=feed.header.timestamp, entries=entries)


trip_feed = CachedFeed('ttc-trip-updates', 30, lambda: fetch_feed(TRIPS), 60)
vehicle_feed = CachedFeed('ttc-vehicle-positions', 30, lambda: fetch_feed(VEHICLES, True), 60)


def snapshot(now=None):
    now = time.time() if now is None else now
    trips, vehicles = trip_feed.get(), vehicle_feed.get()
    def fresh(result):
        return result['available'] and result['data'] and -60 <= now - result['data']['timestamp'] <= MAX_AGE
    updates, positions = {}, {}
    if fresh(trips):
        for update in trips['data']['entries']:
            if -60 <= now - update['timestamp'] <= MAX_AGE:
                updates.setdefault(update['trip_id'], []).append(update)
    if fresh(vehicles):
        for position in vehicles['data']['entries']:
            if -60 <= now - position['timestamp'] <= MAX_AGE:
                positions[position['trip_id']] = position
    return dict(updates=updates, vehicles=positions, available=bool(fresh(trips)),
                timestamp=trips['data']['timestamp'] if fresh(trips) else None)


def trip_times(rows, trip_id, route_id, direction, day, state):
    """Apply explicit predictions and GTFS delay propagation, preserving scheduled fallbacks.

    Stop IDs and sequences must agree if both are supplied. Subway times always stay
    scheduled. Cancelled trips and skipped stops must not be offered for boarding.
    """
    anchor = service_epoch(day)
    update = None
    if not trip_id.startswith('subway:'):
        for candidate in state['updates'].get(raw_id(trip_id), []):
            if candidate['route_id'] and candidate['route_id'] != raw_id(route_id):
                continue
            if candidate['direction_id'] is not None and str(direction) != candidate['direction_id']:
                continue
            if candidate['start_date'] and candidate['start_date'] != day.strftime('%Y%m%d'):
                continue
            header_day = datetime.fromtimestamp(state.get('timestamp') or 0, TZ).date()
            if not candidate['start_date'] and day not in (header_day, header_day - timedelta(days=1)):
                continue
            update = candidate
            break
    if update and update['relationship'] in (3, 7):
        return []
    by_seq = {}
    if update:
        for stop in update['stops']:
            for row in rows:
                if stop['seq'] is not None and stop['seq'] != row['seq']:
                    continue
                if stop['stop_id'] and stop['stop_id'] != raw_id(row['stop']):
                    continue
                if stop['seq'] is None and not stop['stop_id']:
                    continue
                by_seq[row['seq']] = stop
                break
    carry = update.get('delay') if update else None
    result = []
    for row in rows:
        stop = by_seq.get(row['seq'])
        if stop and stop['relationship'] == 2:  # NO_DATA ends delay propagation.
            carry = None
        values = dict(row)
        values['skipped'] = bool(stop and stop['relationship'] == 1)
        for key in ('arrival', 'departure'):
            scheduled = anchor + row[key]
            prediction = stop[key] if stop and stop['relationship'] == 0 else {}
            absolute = prediction.get('time')
            delay = prediction.get('delay')
            if absolute is not None and abs(absolute - scheduled) <= 43200:
                carry = absolute - scheduled
            elif delay is not None:
                carry = delay
            else:
                absolute = None
            live = carry is not None
            values[key] = absolute if absolute is not None else scheduled + (carry or 0)
            values[key + '_live'] = live
        result.append(values)
    return result
