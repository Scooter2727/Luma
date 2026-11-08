"""Toronto restrictions: only explicit, spatially resolvable pedestrian closures block paths."""
import hashlib
import json
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import httpx
from shapely.geometry import LineString, Point
from .live_cache import CachedFeed
from .walking import xy

ARCGIS = 'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/FeatureServer/5'
CURRENT = 'https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json'
TZ = ZoneInfo('America/Toronto')


def fetch_arcgis():
    features = []
    with httpx.Client(timeout=10, follow_redirects=True) as client:
        for offset in range(0, 20000, 2000):
            response = client.get(ARCGIS + '/query', params=dict(
                where="IS_CURRENT='Y'", outFields='*', outSR=4326, f='json',
                resultOffset=offset, resultRecordCount=2000, orderByFields='OBJECTID'))
            response.raise_for_status()
            data = response.json()
            if 'error' in data:
                raise ValueError('ArcGIS error')
            features.extend(data['features'])
            if not data.get('exceededTransferLimit'):
                return features
    raise ValueError('Incomplete restriction feed')


def fetch_current():
    response = httpx.get(CURRENT, timeout=12, follow_redirects=True)
    response.raise_for_status()
    return response.json()['Closure']


arcgis_feed = CachedFeed('toronto-arcgis-restrictions', 300, fetch_arcgis, 600)
current_feed = CachedFeed('toronto-v3-restrictions', 120, fetch_current, 600)


def pedestrian_scope(description):
    text = description.lower()
    # Conditional, alternating, partial, and negated closures cannot identify a blocked side now.
    uncertain = r'\b(may|might|could|proposed|requested|pending|intermittent|partial|alternat\w*|hoisting)\b|at a time|north\s+or\s+south|east\s+or\s+west'
    if re.search(uncertain, text):
        return 'unknown', None
    clauses = re.split(r'[.;,\n]|\b(?:and|but|while|whereas)\b', text)
    ambiguous = False
    sides = set()
    for clause in clauses:
        if re.search(r'no pedestrian access(?:\s+(?:is\s+)?(?:allowed|permitted))?\s*$', clause.strip()):
            return 'closed', 'all'
        if re.search(r'\b(?:not|never|without)\b|\bno\b.{0,30}\bclosure', clause):
            continue
        auxiliary = r'(?:(?:is|are|will|be|remain|remains|temporarily|fully|completely|continuously|has|have|been|being|to)\s+){0,6}'
        if re.search(r'closed\s+to\s+pedestrians|pedestrian\s+access\s+' + auxiliary + r'(?:closed|prohibited|blocked)', clause):
            return 'closed', 'all'
        pedestrian = r'(?:sidewalks?|footpaths?|walkways?)'
        subject_closed = pedestrian + r'\s+' + auxiliary + r'(?:closed|blocked|impassable|closures?)\b'
        close_subject = r'\b(?:close[ds]?|closing|closures?(?:\s+of)?|blocked)\s+(?:the\s+)?(?:(?:north|south|east|west|both|all)(?:ern)?\s+(?:side\s+)?)?' + pedestrian
        # A lane closure FOR sidewalk work does not confirm that the sidewalk is closed.
        if re.search(subject_closed + '|' + close_subject, clause):
            if re.search(r'\b(?:both|all)\s+' + pedestrian, clause):
                return 'closed', 'all'
            side = re.search(r'\b(north|south|east|west)(?:ern)?(?:\s+side)?\s+(?:sidewalk|footpath|walkway)', clause)
            if side:
                sides.add(side[1])
            else:
                ambiguous = True
    if len(sides) == 1 and not ambiguous:
        return 'closed', next(iter(sides))
    if sides or ambiguous:
        return 'closed', None
    if re.search(r'pedestrian access.{0,25}(maintained|open)|sidewalk.{0,30}(remain open|kept open)|pedestrians? can pass', text):
        return 'open', None
    return 'unknown', None


def epoch(value):
    try:
        return float(value) / 1000 if value not in (None, '') else None
    except (ValueError, TypeError):
        return None


def in_window(record, when):
    start, end = epoch(record.get('startTime')), epoch(record.get('endTime'))
    if start is None or when.timestamp() < start or (end is not None and when.timestamp() > end):
        return False
    if record.get('expired') in (1, '1'):
        return False
    return True


def working_now(record, when):
    if (record.get('workPeriod') or '').lower() == 'continuous':
        return True
    # Overnight ranges belong to the preceding service day after midnight.
    for day_offset in (0, -1):
        day = when + timedelta(days=day_offset)
        spec = record.get('schedule' + day.strftime('%A')) or record.get('scheduleEveryday')
        if not spec:
            continue
        if (record.get('workPeriod') or '').lower() == 'weekdays' and day.weekday() >= 5:
            continue
        for begin, finish in re.findall(r'(\d\d:\d\d)\s*-\s*(\d\d:\d\d)', spec):
            try:
                left = day.replace(hour=int(begin[:2]), minute=int(begin[3:]), second=0, microsecond=0)
                right = day.replace(hour=int(finish[:2]), minute=int(finish[3:]), second=59, microsecond=999999)
                if right < left:
                    right += timedelta(days=1)
                if left <= when <= right:
                    return True
            except ValueError:
                continue
    return False


def normalise_v3(record, when):
    if not in_window(record, when):
        return None
    access, side = pedestrian_scope(record.get('description') or '')
    line = None
    try:
        points = json.loads('[' + record.get('geoPolyline', '') + ']')
        if len(points) > 1 and all(-80 < p[0] < -79 and 43 < p[1] < 45 for p in points):
            line = {'type': 'LineString', 'coordinates': points}
    except (ValueError, TypeError, IndexError):
        pass
    try:
        position = [float(record['longitude']), float(record['latitude'])]
    except (ValueError, KeyError, TypeError):
        return None
    return dict(type='Feature', geometry=line or dict(type='Point', coordinates=position), properties=dict(
        id='v3-' + str(record['id']), name=record.get('name') or record.get('road') or 'Construction',
        street=record.get('road') or '', description=record.get('description') or '',
        pedestrian_access=access, side=side, active=working_now(record, when),
        source_url=CURRENT, updated_at=epoch(record.get('lastUpdated')),
        routing_status='unmapped' if access == 'closed' else access))


def normalise_arcgis(feature, when):
    a = feature['attributes']
    record = dict(startTime=a.get('START_DATE_TIME'), endTime=a.get('END_DATE_TIME'))
    if not in_window(record, when):
        return None
    access, side = pedestrian_scope(a.get('DESCRIPTION') or '')
    g = feature.get('geometry') or {}
    try:
        position = [float(g.get('x', a.get('RR_LONGITUDE'))), float(g.get('y', a.get('RR_LATITUDE')))]
    except (TypeError, ValueError):
        return None
    return dict(type='Feature', geometry=dict(type='Point', coordinates=position), properties=dict(
        id='arcgis-' + str(a.get('ID', a.get('OBJECTID'))), name=a.get('MAIN_ROAD') or 'Road restriction',
        street=a.get('MAIN_ROAD') or '', description=a.get('DESCRIPTION') or '',
        pedestrian_access=access, side=side, active=(a.get('NOTE') or '').lower() == 'continuous',
        source_url=ARCGIS, updated_at=epoch(a.get('INFO_UPDATED')),
        routing_status='unmapped' if access == 'closed' else access))


def street_key(value):
    words = {'street': 'st', 'avenue': 'ave', 'road': 'rd', 'boulevard': 'blvd', 'drive': 'dr', 'west': 'w', 'east': 'e', 'north': 'n', 'south': 's'}
    return ' '.join(words.get(w, w) for w in re.findall(r'[a-z0-9]+', value.lower()))


def matches_edge(u, v, edge, feature, line):
    p = feature['properties']
    if edge.get('crossing') or street_key(edge.get('street', '')) != street_key(p['street']):
        return False
    path = LineString([xy(u), xy(v)])
    overlap = path.intersection(line.buffer(30, cap_style=2))
    if overlap.is_empty or overlap.length < .5:
        return False
    middle = overlap.interpolate(.5, normalized=True)
    along = line.project(middle)
    # Do not extend a road-centreline closure around a corner or invent a whole block.
    if middle.distance(line) > 30 or along < .5 or along > line.length - .5:
        return False
    tangent_a = line.interpolate(max(0, along - 2))
    tangent_b = line.interpolate(min(line.length, along + 2))
    dx, dy = tangent_b.x - tangent_a.x, tangent_b.y - tangent_a.y
    ux, uy = xy(u); vx, vy = xy(v)
    denominator = path.length * (dx * dx + dy * dy) ** .5
    if not denominator or abs((vx - ux) * dx + (vy - uy) * dy) / denominator < .8:
        return False
    nearest = line.interpolate(along)
    side = p['side']
    return side == 'all' or (side == 'north' and middle.y > nearest.y + 1) or (side == 'south' and middle.y < nearest.y - 1) or (side == 'east' and middle.x > nearest.x + 1) or (side == 'west' and middle.x < nearest.x - 1)


def snapshot(net, when=None):
    when = (when or datetime.now(TZ)).astimezone(TZ)
    current, arcgis = current_feed.get(), arcgis_feed.get()
    features = [f for r in current['data'] or [] if (f := normalise_v3(r, when))]
    features += [f for r in arcgis['data'] or [] if (f := normalise_arcgis(r, when))]
    blocked = []
    for feature in features:
        p = feature['properties']
        p['closed_pednet_ids'] = []
        if p['pedestrian_access'] != 'closed' or not p['side'] or not p['active'] or feature['geometry']['type'] != 'LineString':
            continue
        line = LineString([xy(c) for c in feature['geometry']['coordinates']])
        ids = set()
        for i in net.tree.query(line.buffer(30)):
            u, v = net.edges[i];edge = net.edge_attrs[(u, v)]
            if matches_edge(u, v, edge, feature, line):
                ids.add(edge['pednet_id'])
        if ids:
            p['closed_pednet_ids'] = sorted(ids)
            p['routing_status'] = 'blocked'
            blocked.append((feature, line, ids))
    revision = hashlib.sha256(json.dumps([(f['properties']['id'], f['geometry'], f['properties']['side']) for f, _, _ in blocked], sort_keys=True).encode()).hexdigest()[:16]
    return dict(type='FeatureCollection', features=features, revision=revision,
                available=current['available'] or arcgis['available'],
                complete=current['available'] and arcgis['available'],
                stale=current['stale'] or arcgis['stale'],
                fetched_at=max(current['fetched_at'] or 0, arcgis['fetched_at'] or 0) or None,
                _blocked=blocked)


def apply_closures(graph, state):
    restrictions = {}
    for feature, line, ids in state['_blocked']:
        for pednet_id in ids:
            restrictions.setdefault(pednet_id, []).append((feature, line))
    remove = [(u, v) for u, v, edge in graph.edges(data=True)
              if any(matches_edge(u, v, edge, feature, line) for feature, line in restrictions.get(edge.get('pednet_id'), []))]
    graph.remove_edges_from(remove)
    return len(remove)


def public_snapshot(state):
    return {k: v for k, v in state.items() if not k.startswith('_')}
