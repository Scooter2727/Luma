"""Scheduled TTC bus journeys with walk access, real service calendars and up to one transfer."""
import csv,io,json,sqlite3,zipfile,math
from pathlib import Path
from functools import lru_cache
from datetime import datetime,timedelta,date,time
from zoneinfo import ZoneInfo
from threading import Lock
import networkx as nx
from .walking import ROOT,distance,walk_details,weight
from .runtime import cache_directory
TZ=ZoneInfo('America/Toronto')
def seconds(value):
    h,m,s=map(int,value.split(':'));return h*3600+m*60+s
def reader(z,name):return csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig',newline=''))
_database_lock=Lock()
def database():
    with _database_lock:return _database()

@lru_cache(maxsize=1)
def _database():
    archive=ROOT/'data/sources/ttc-gtfs.zip';folder=cache_directory()
    path=folder/'ttc-schedule-v2.sqlite'
    if path.exists() and path.stat().st_mtime>=archive.stat().st_mtime:return path
    # Construct under a temporary name: interrupted builds never become valid caches.
    temp=path.with_suffix('.building');temp.unlink(missing_ok=True)
    db=sqlite3.connect(temp)
    db.executescript('CREATE TABLE trips(id TEXT PRIMARY KEY,route TEXT,service TEXT,headsign TEXT,shape TEXT); CREATE TABLE times(trip TEXT,stop TEXT,seq INTEGER,arrival INTEGER,departure INTEGER,pickup INTEGER,dropoff INTEGER); CREATE TABLE shapes(id TEXT,seq INTEGER,lat REAL,lon REAL);')
    with zipfile.ZipFile(archive) as z:
        routes={r['route_id']:r for r in reader(z,'routes.txt')};trips={r['trip_id']:r for r in reader(z,'trips.txt') if routes[r['route_id']]['route_type']=='3'}
        db.executemany('INSERT INTO trips VALUES(?,?,?,?,?)',[(k,t['route_id'],t['service_id'],t['trip_headsign'],t['shape_id']) for k,t in trips.items()])
        def time_rows():
            for r in reader(z,'stop_times.txt'):
                if r['trip_id'] in trips and r['arrival_time'] and r['departure_time']:
                    yield(r['trip_id'],r['stop_id'],int(r['stop_sequence']),seconds(r['arrival_time']),seconds(r['departure_time']),int(r.get('pickup_type') or 0),int(r.get('drop_off_type') or 0))
        db.executemany('INSERT INTO times VALUES(?,?,?,?,?,?,?)',time_rows())
        shape_ids={t['shape_id'] for t in trips.values()}
        db.executemany('INSERT INTO shapes VALUES(?,?,?,?)',((r['shape_id'],int(r['shape_pt_sequence']),float(r['shape_pt_lat']),float(r['shape_pt_lon'])) for r in reader(z,'shapes.txt') if r['shape_id'] in shape_ids))
    db.executescript('CREATE INDEX stop_departure ON times(stop,departure);CREATE INDEX trip_seq ON times(trip,seq);CREATE INDEX shape_seq ON shapes(id,seq);')
    db.commit();db.close();temp.replace(path);return path

@lru_cache(maxsize=64)
def active_services(day:date):
    with zipfile.ZipFile(ROOT/'data/sources/ttc-gtfs.zip') as z:
        calendar=list(reader(z,'calendar.txt'));exceptions=list(reader(z,'calendar_dates.txt'))
    ymd=day.strftime('%Y%m%d');weekday=day.strftime('%A').lower()
    active={r['service_id'] for r in calendar if r['start_date']<=ymd<=r['end_date'] and r[weekday]=='1'}
    for r in exceptions:
        if r['date']==ymd:
            if r['exception_type']=='1':active.add(r['service_id'])
            else:active.discard(r['service_id'])
    return active
def feed_range():
    with zipfile.ZipFile(ROOT/'data/sources/ttc-gtfs.zip') as z:c=list(reader(z,'calendar.txt'))
    return min(r['start_date'] for r in c),max(r['end_date'] for r in c)
def service_epoch(day):
    # GTFS times are measured from noon minus 12 elapsed hours, including DST days.
    return datetime.combine(day,time(12),TZ).timestamp()-43200

def iso_at(day,sec):return datetime.fromtimestamp(service_epoch(day)+sec,TZ).isoformat()

def bus_journeys(net,g,anchors,start,end,depart,speed,prefs,max_walk=1000):
    if not (feed_range()[0]<=depart.strftime('%Y%m%d')<=feed_range()[1]):
        raise ValueError('The downloaded TTC timetable covers November 1 to December 21, 2026. Choose a departure in that range or update the GTFS feed.')
    edge_weight=weight(speed,**prefs)
    # Dijkstra incorporates preferences on BOTH walking legs. Restrict by effort, not straight-line proximity alone.
    access_cost,access_paths=nx.single_source_dijkstra(g,anchors[0],cutoff=max_walk/speed+500,weight=edge_weight)
    egress_cost,egress_paths=nx.single_source_dijkstra(g,anchors[1],cutoff=max_walk/speed+500,weight=edge_weight)
    def walks(cost,paths):
        result={}
        for sid,node in net.stop_nodes.items():
            if node not in paths:continue
            path=paths[node];d=walk_details(g,path,speed);offset=net.stop_offsets[sid]
            if d['distance']+offset<=max_walk:
                result[sid]=dict(path=path,details=d,seconds=d['duration_seconds']+offset/speed,score=cost[node]+offset/speed,offset=offset)
        return result
    access=walks(access_cost,access_paths);egress=walks(egress_cost,egress_paths)
    origin_offset=distance(start,anchors[0])/speed;destination_offset=distance(end,anchors[1])/speed
    for w in access.values():w['seconds']+=origin_offset;w['score']+=origin_offset
    for w in egress.values():w['seconds']+=destination_offset;w['score']+=destination_offset
    if not access or not egress:return []
    db=sqlite3.connect(database());db.row_factory=sqlite3.Row
    routes=route_metadata();base_epoch=service_epoch(depart.date());base_seconds=depart.timestamp()-base_epoch
    # Include previous service day's times >24:00 and next day's first departures.
    service_days=[(depart.date()+timedelta(days=d),service_epoch(depart.date()+timedelta(days=d))-base_epoch) for d in [-1,0,1]]
    reached={sid:[dict(arrival=base_seconds+w['seconds'],score=base_seconds+w['score'],legs=[],access=sid)] for sid,w in access.items()}
    found=[]
    try:
        for boarding_round in range(2):
            candidates={}
            for sid,labels in reached.items():
                for label in labels:
                    ready=label['arrival']+60 # explicit boarding / transfer buffer
                    for service_day,day_offset in service_days:
                        services=active_services(service_day)
                        if not services:continue
                        placeholders=','.join('?' for _ in services)
                        rows=db.execute(f'''SELECT times.*,trips.route,trips.headsign,trips.shape FROM times JOIN trips ON times.trip=trips.id WHERE stop=? AND departure>=? AND departure<=? AND pickup=0 AND trips.service IN ({placeholders}) ORDER BY departure''',(sid,ready-day_offset,base_seconds+10800-day_offset,*sorted(services)))
                        for row in rows:
                            if label['legs'] and label['legs'][-1]['route_id']==row['route']:continue
                            key=(row['trip'],day_offset)
                            candidate=dict(row);candidate.update(board=sid,label=label,day_offset=day_offset,service_day=service_day)
                            # Keep non-dominated boarding points: earlier boarding and
                            # a smaller walking penalty are independent advantages.
                            candidate['penalty']=label['score']-label['arrival']
                            existing=candidates.setdefault(key,[])
                            if not any(c['seq']<=candidate['seq'] and c['penalty']<=candidate['penalty'] for c in existing):
                                existing[:]=[c for c in existing if not(candidate['seq']<=c['seq'] and candidate['penalty']<=c['penalty'])]
                                existing.append(candidate)
            next_reached={}
            for candidate in (c for group in candidates.values() for c in group):
                label=candidate['label'];dep=candidate['departure']+candidate['day_offset']
                for stop_count,row in enumerate(db.execute('SELECT * FROM times WHERE trip=? AND seq>? ORDER BY seq',(candidate['trip'],candidate['seq'])),1):
                    arrival=row['arrival']+candidate['day_offset']
                    if row['dropoff']!=0 or arrival<dep or arrival>base_seconds+10800:continue
                    leg=dict(mode='bus',trip=candidate['trip'],route_id=candidate['route'],route=routes[candidate['route']]['route_short_name'],headsign=candidate['headsign'],shape=candidate['shape'],from_stop=candidate['board'],to_stop=row['stop'],board_seq=candidate['seq'],alight_seq=row['seq'],departure_seconds=dep,arrival_seconds=arrival,stops=stop_count)
                    # Keep an immutable itinerary so later improvements cannot corrupt earlier labels.
                    new=dict(arrival=arrival,score=label['score']+(arrival-label['arrival']),legs=label['legs']+[leg],access=label['access'])
                    sid=row['stop']
                    if sid in egress:
                        e=egress[sid];found.append(dict(**new,egress=sid,total_seconds=arrival+e['seconds']-base_seconds,total_score=new['score']+e['score']-base_seconds))
                    existing=next_reached.setdefault(sid,[])
                    if not any(x['arrival']<=new['arrival'] and x['score']<=new['score'] for x in existing):
                        existing[:]=[x for x in existing if not (new['arrival']<=x['arrival'] and new['score']<=x['score'])];existing.append(new)
            reached=next_reached
        # One-transfer journeys change buses at the SAME stop only. No inferred transfer walks across roads.
        found.sort(key=lambda j:(j['total_score'],len(j['legs']),j['total_seconds']))
        unique=[];seen=set()
        for j in found:
            if any(len(other['legs'])<len(j['legs']) and other['total_score']<=j['total_score']+1e-6 and other['total_seconds']<=j['total_seconds']+1e-6 for other in unique):continue
            signature=tuple((l['route_id'],l['headsign']) for l in j['legs'])
            if signature not in seen:seen.add(signature);unique.append(j)
            if len(unique)>=3:break
        return [serialize_journey(db,net,g,j,access[j['access']],egress[j['egress']],depart,speed,start,end) for j in unique]
    finally:db.close()

@lru_cache(maxsize=1)
def route_metadata():
    with zipfile.ZipFile(ROOT/'data/sources/ttc-gtfs.zip') as z:return {r['route_id']:r for r in reader(z,'routes.txt')}
def bus_geometry(db,leg,net):
    points=[(r['lon'],r['lat']) for r in db.execute('SELECT lat,lon FROM shapes WHERE id=? ORDER BY seq',(leg['shape'],))]
    start=net.stops[leg['from_stop']];end=net.stops[leg['to_stop']]
    a=(float(start['stop_lon']),float(start['stop_lat']));b=(float(end['stop_lon']),float(end['stop_lat']))
    if not points:return [list(a),list(b)]
    # Match all stops forwards so loop stops use the correct shape occurrence.
    cursor=0;indices={}
    for stop in db.execute('SELECT stop,seq FROM times WHERE trip=? ORDER BY seq',(leg['trip'],)):
        s=net.stops[stop['stop']];c=(float(s['stop_lon']),float(s['stop_lat']))
        cursor=min(range(cursor,len(points)),key=lambda k:distance(points[k],c))
        indices[stop['seq']]=cursor
    i=indices[leg['board_seq']];j=indices[leg['alight_seq']]
    return [list(a)]+[list(p) for p in points[i:j+1]]+[list(b)]
def serialize_journey(db,net,g,j,access,egress,depart,speed,start,end):
    steps=[];segments=[];bus_seconds=0;day=depart.date()
    first=walk_details(g,access['path'],speed);last=walk_details(g,list(reversed(egress['path'])),speed)
    def connector(a,b,title,detail):
        metres=distance(a,b)
        if metres>1:
            segments.append(dict(mode='connect',coordinates=[list(a),list(b)]))
        if metres>8:
            steps.append(dict(kind='connect',title=title,text=title+'. '+detail+f' Approximately {round(metres)} metres; this short connection is not mapped. Confirm the approach on site.',distance=round(metres),coordinates=list(a),end_coordinates=list(b),crossing=False))
    connector(start,access['path'][0],'Join the mapped pedestrian path','Find the nearby pedestrian path.')
    steps.extend(first['steps'])
    if len(first['coordinates'])>1:segments.append(dict(mode='walk',coordinates=first['coordinates']))
    first_stop=net.stops[j['legs'][0]['from_stop']]
    first_coord=(float(first_stop['stop_lon']),float(first_stop['stop_lat']))
    connector(access['path'][-1],first_coord,'Approach '+first_stop['stop_name'],'Locate the bus stop and boarding area.')
    for leg in j['legs']:
        board=net.stops[leg['from_stop']];alight=net.stops[leg['to_stop']]
        coords=(float(board['stop_lon']),float(board['stop_lat']));dest=(float(alight['stop_lon']),float(alight['stop_lat']))
        dep=iso_at(day,leg['departure_seconds']);arr=iso_at(day,leg['arrival_seconds'])
        departure_label=datetime.fromisoformat(dep).strftime('%I:%M %p').lstrip('0')
        arrival_label=datetime.fromisoformat(arr).strftime('%I:%M %p').lstrip('0')
        title=f"Wait for bus {leg['route']}"
        steps.append(dict(kind='wait',title=title,text=title+f". At {board['stop_name']}. {leg['headsign']}. Scheduled departure {departure_label}; arrive at least one minute before boarding.",distance=0,coordinates=list(coords),crossing=False,scheduled_time=dep))
        title=f"Board bus {leg['route']}"
        steps.append(dict(kind='board',title=title,text=title+f". At {board['stop_name']}. {leg['headsign']}. Check the route and destination announcement before boarding.",distance=0,coordinates=list(coords),crossing=False,scheduled_time=dep))
        title=f"Ride {leg['stops']} stops to {alight['stop_name']}"
        steps.append(dict(kind='ride',title=title,text=title+f". Stay on bus {leg['route']}. Scheduled arrival {arrival_label}.",distance=0,coordinates=list(coords),end_coordinates=list(dest),crossing=False,scheduled_time=arr))
        title=f"Get off at {alight['stop_name']}"
        steps.append(dict(kind='alight',title=title,text=title+'. '+('Transfer at this stop; confirm the next route with the operator.' if leg!=j['legs'][-1] else 'Continue on foot to your destination.'),distance=0,coordinates=list(dest),crossing=False))
        segments.append(dict(mode='bus',route=leg['route'],coordinates=bus_geometry(db,leg,net)))
        bus_seconds+=leg['arrival_seconds']-leg['departure_seconds']
        leg.update(from_name=board['stop_name'],to_name=alight['stop_name'],departure_time=dep,arrival_time=arr)
    connector(dest,egress['path'][-1],'Rejoin the mapped pedestrian path','Locate the path from the stop.')
    steps.extend(last['steps'])
    if len(last['coordinates'])>1:segments.append(dict(mode='walk',coordinates=last['coordinates']))
    connector(egress['path'][0],end,'Approach your destination','Locate the destination entrance.')
    duration=math.ceil(j['total_seconds']);walk_seconds=access['seconds']+egress['seconds']
    origin_offset=distance(start,access['path'][0]);destination_offset=distance(end,egress['path'][0])
    return dict(id='',name='Scheduled bus journey',mode='bus',coordinates=[c for s in segments for c in s['coordinates']],segments=segments,steps=steps,distance=round(first['distance']+last['distance']+access['offset']+egress['offset']+origin_offset+destination_offset),duration_seconds=math.ceil(duration),minutes=max(1,math.ceil(duration/60)),crossings=first['crossings']+last['crossings'],audible=first['audible']+last['audible'],tactile=first['tactile']+last['tactile'],walking_minutes=math.ceil(walk_seconds/60),riding_minutes=math.ceil(bus_seconds/60),waiting_minutes=max(0,math.ceil((duration-walk_seconds-bus_seconds)/60)),transfers=len(j['legs'])-1,bus_legs=j['legs'],departure_time=depart.isoformat(),arrival_time=datetime.fromtimestamp(depart.timestamp()+duration,TZ).isoformat(),timing='scheduled',snap_distances=[round(origin_offset),round(destination_offset)],stop_offsets=[round(access['offset']),round(egress['offset'])])
