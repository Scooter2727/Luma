"""TTC bus, streetcar and subway journeys, using matched live predictions when available."""
import sqlite3, math
from datetime import datetime, timedelta
import networkx as nx
from shapely.geometry import Point
from shapely.strtree import STRtree
from .walking import distance, walk_details, weight, xy
from .transit_data import (TZ, database, active_services, feed_range, service_epoch, iso_at,
                           route_metadata, stop_metadata, raw_id, seconds, reader)
from . import realtime


def vehicle_mode(metadata, headsign):
    return 'bus' if any(term in headsign.lower() for term in ('replacement bus','shuttle bus')) else metadata.get('mode','bus')


def minute_parts(walking, waiting, riding):
    # Round display components together so they add up to the displayed ETA.
    values=[walking/60,waiting/60,riding/60]
    rounded=[math.floor(v) for v in values]
    remainder=math.ceil(round(walking+waiting+riding,6)/60)-sum(rounded)
    for i in sorted(range(3),key=lambda i:values[i]-rounded[i],reverse=True)[:remainder]:rounded[i]+=1
    return rounded


def bus_journeys(net,g,anchors,start,end,depart,speed,prefs,max_walk=1000):
    first_day,last_day=feed_range()
    if not (first_day<=depart.strftime('%Y%m%d')<=last_day):
        raise ValueError(f'The downloaded TTC timetable covers {first_day} to {last_day}. Choose a departure in that range or update the GTFS feeds.')
    edge_weight=weight(speed,**prefs)
    access_cost,access_paths=nx.single_source_dijkstra(g,anchors[0],cutoff=max_walk/speed+500,weight=edge_weight)
    egress_cost,egress_paths=nx.single_source_dijkstra(g,anchors[1],cutoff=max_walk/speed+500,weight=edge_weight)
    def walks(cost,paths,station_allowance):
        result={}
        for sid,node in net.stop_nodes.items():
            if node not in paths:continue
            path=paths[node];d=walk_details(g,path,speed);offset=net.stop_offsets[sid]
            if d['distance']+offset<=max_walk:
                extra=station_allowance if sid.startswith('subway:') else 0
                result[sid]=dict(path=path,details=d,seconds=d['duration_seconds']+offset/speed+extra,score=cost[node]+offset/speed+extra,offset=offset)
        return result
    access=walks(access_cost,access_paths,120);egress=walks(egress_cost,egress_paths,90)
    origin_offset=distance(start,anchors[0])/speed;destination_offset=distance(end,anchors[1])/speed
    for w in access.values():w['seconds']+=origin_offset;w['score']+=origin_offset
    for w in egress.values():w['seconds']+=destination_offset;w['score']+=destination_offset
    if not access or not egress:return []
    db=sqlite3.connect(database());db.row_factory=sqlite3.Row
    routes=route_metadata();base_epoch=service_epoch(depart.date());base_seconds=depart.timestamp()-base_epoch
    live=realtime.snapshot() if abs(depart.timestamp()-datetime.now(TZ).timestamp())<=7200 else dict(updates={},vehicles={},available=False,timestamp=None)
    service_days=[(depart.date()+timedelta(days=d),service_epoch(depart.date()+timedelta(days=d))-base_epoch) for d in [-1,0,1]]
    reached={sid:[dict(arrival=base_seconds+w['seconds'],score=base_seconds+w['score'],legs=[],access=sid)] for sid,w in access.items()}
    timing_cache={};transfer_cache={}
    stop_ids=list(net.stop_nodes)
    stop_points=[Point(xy((float(net.stops[s]['stop_lon']),float(net.stops[s]['stop_lat'])))) for s in stop_ids]
    stop_tree=STRtree(stop_points)
    def timings(candidate):
        key=(candidate['trip'],candidate['service_day'])
        if key not in timing_cache:
            rows=list(db.execute('SELECT * FROM times WHERE trip=? ORDER BY seq',(candidate['trip'],)))
            timing_cache[key]=realtime.trip_times(rows,candidate['trip'],candidate['route'],candidate['direction'],candidate['service_day'],live)
        return timing_cache[key]
    def connections(sid):
        if sid not in net.stop_nodes:return []
        if sid in transfer_cache:return transfer_cache[sid]
        point=Point(xy((float(net.stops[sid]['stop_lon']),float(net.stops[sid]['stop_lat']))))
        nearby=[stop_ids[int(i)] for i in stop_tree.query(point.buffer(100)) if stop_ids[int(i)]!=sid and stop_points[int(i)].distance(point)<=100]
        result=[]
        if nearby:
            costs,paths=nx.single_source_dijkstra(g,net.stop_nodes[sid],cutoff=200/speed+120,weight=edge_weight)
            for target in nearby:
                node=net.stop_nodes[target]
                if node not in paths:continue
                details=walk_details(g,paths[node],speed);offset=net.stop_offsets[sid]+net.stop_offsets[target]
                if details['distance']+offset>200:continue
                # A station transfer needs time for platform access; this is an estimate, not a mapped indoor pathway.
                station=120 if sid.startswith('subway:') or target.startswith('subway:') else 0
                result.append(dict(target=target,path=paths[node],details=details,seconds=details['duration_seconds']+offset/speed+station,score=costs[node]+offset/speed+station,distance=details['distance']+offset,from_stop=sid,to_stop=target))
        transfer_cache[sid]=result
        return result
    found=[]
    try:
        for boarding_round in range(2):
            candidates={}
            for sid,labels in reached.items():
                for label in labels:
                    ready=label['arrival']+60
                    for service_day,day_offset in service_days:
                        services=active_services(service_day)
                        if not services:continue
                        placeholders=','.join('?' for _ in services)
                        lookback=7200 if live['available'] else 0
                        rows=db.execute(f'''SELECT times.*,trips.route,trips.headsign,trips.shape,trips.direction FROM times JOIN trips ON times.trip=trips.id WHERE stop=? AND departure>=? AND departure<=? AND pickup=0 AND trips.service IN ({placeholders}) ORDER BY departure''',(sid,ready-day_offset-lookback,base_seconds+10800-day_offset,*sorted(services)))
                        for row in rows:
                            if label['legs'] and label['legs'][-1]['route_id']==row['route']:continue
                            key=(row['trip'],day_offset)
                            candidate=dict(row);candidate.update(board=sid,label=label,day_offset=day_offset,service_day=service_day)
                            predicted=next((r for r in timings(candidate) if r['seq']==candidate['seq']),None)
                            if not predicted or predicted['skipped'] or predicted['departure']-base_epoch<ready:continue
                            candidate['predicted']=predicted
                            candidate['penalty']=label['score']-label['arrival']
                            existing=candidates.setdefault(key,[])
                            if not any(c['seq']<=candidate['seq'] and c['penalty']<=candidate['penalty'] for c in existing):
                                existing[:]=[c for c in existing if not(candidate['seq']<=c['seq'] and candidate['penalty']<=c['penalty'])]
                                existing.append(candidate)
            next_reached={}
            def retain(sid,new):
                existing=next_reached.setdefault(sid,[])
                if not any(x['arrival']<=new['arrival'] and x['score']<=new['score'] for x in existing):
                    existing[:]=[x for x in existing if not(new['arrival']<=x['arrival'] and new['score']<=x['score'])]
                    existing.append(new)
            for candidate in (c for group in candidates.values() for c in group):
                label=candidate['label'];dep=candidate['predicted']['departure']-base_epoch
                remaining=[r for r in timings(candidate) if r['seq']>candidate['seq']]
                for stop_count,row in enumerate(remaining,1):
                    arrival=row['arrival']-base_epoch
                    if row['dropoff']!=0 or row['skipped'] or arrival<dep or arrival>base_seconds+10800:continue
                    meta=routes[candidate['route']]
                    leg=dict(mode=vehicle_mode(meta,candidate['headsign']),trip=candidate['trip'],route_id=candidate['route'],route=meta['route_short_name'],direction_id=candidate['direction'],headsign=candidate['headsign'],shape=candidate['shape'],from_stop=candidate['board'],to_stop=row['stop'],board_seq=candidate['seq'],alight_seq=row['seq'],departure_seconds=dep,arrival_seconds=arrival,scheduled_departure_seconds=candidate['departure']+candidate['day_offset'],departure_live=candidate['predicted']['departure_live'],arrival_live=row['arrival_live'],service_date=candidate['service_day'].isoformat(),stops=stop_count,transfer_walk=label.get('transfer_walk'))
                    new=dict(arrival=arrival,score=label['score']+(arrival-label['arrival']),legs=label['legs']+[leg],access=label['access'])
                    sid=row['stop']
                    if sid in egress:
                        e=egress[sid];found.append(dict(**new,egress=sid,total_seconds=arrival+e['seconds']-base_seconds,total_score=new['score']+e['score']-base_seconds))
                    if boarding_round==0:retain(sid,new)
            if boarding_round==0:
                # Use actual pedestrian connections, not stop proximity alone, for transfers.
                original=[(sid,list(labels)) for sid,labels in next_reached.items()]
                for sid,labels in original:
                    for connection in connections(sid):
                        for label in list(labels):
                            retain(connection['target'],dict(label,arrival=label['arrival']+connection['seconds'],score=label['score']+connection['score'],transfer_walk=connection))
            reached=next_reached
        found.sort(key=lambda j:(j['total_score'],len(j['legs']),j['total_seconds']))
        unique=[];seen=set()
        for j in found:
            if any(len(other['legs'])<len(j['legs']) and other['total_score']<=j['total_score']+1e-6 and other['total_seconds']<=j['total_seconds']+1e-6 for other in unique):continue
            signature=tuple((l['route_id'],l['headsign']) for l in j['legs'])
            if signature not in seen:seen.add(signature);unique.append(j)
            if len(unique)>=3:break
        return [serialize_journey(db,net,g,j,access[j['access']],egress[j['egress']],depart,speed,start,end) for j in unique]
    finally:db.close()

def bus_geometry(db,leg,net):
    points=[(r['lon'],r['lat']) for r in db.execute('SELECT lat,lon FROM shapes WHERE id=? ORDER BY seq',(leg['shape'],))]
    start=net.stops[leg['from_stop']];end=net.stops[leg['to_stop']]
    a=(float(start['stop_lon']),float(start['stop_lat']));b=(float(end['stop_lon']),float(end['stop_lat']))
    if not points:return []
    # Match all stops forwards so loop stops use the correct shape occurrence.
    cursor=0;indices={}
    for stop in db.execute('SELECT stop,seq FROM times WHERE trip=? ORDER BY seq',(leg['trip'],)):
        s=net.stops[stop['stop']];c=(float(s['stop_lon']),float(s['stop_lat']))
        cursor=min(range(cursor,len(points)),key=lambda k:distance(points[k],c))
        indices[stop['seq']]=cursor
    i=indices[leg['board_seq']];j=indices[leg['alight_seq']]
    return [list(a)]+[list(p) for p in points[i:j+1]]+[list(b)]
def serialize_journey(db,net,g,j,access,egress,depart,speed,start,end):
    steps=[];segments=[];ride_seconds=0;day=depart.date();transfer_seconds=0
    first=walk_details(g,access['path'],speed);last=walk_details(g,list(reversed(egress['path'])),speed)
    def connector(a,b,title,detail):
        metres=distance(a,b)
        if metres>1:segments.append(dict(mode='connect',coordinates=[list(a),list(b)]))
        if metres>8:
            steps.append(dict(kind='connect',title=title,text=title+'. '+detail+f' Approximately {round(metres)} metres; this short connection is not mapped. Confirm the approach on site.',distance=round(metres),coordinates=list(a),end_coordinates=list(b),crossing=False))
    connector(start,access['path'][0],'Join the mapped pedestrian path','Find the nearby pedestrian path.')
    steps.extend(first['steps'])
    if len(first['coordinates'])>1:segments.append(dict(mode='walk',coordinates=first['coordinates']))
    first_stop=net.stops[j['legs'][0]['from_stop']]
    first_coord=(float(first_stop['stop_lon']),float(first_stop['stop_lat']))
    connector(access['path'][-1],first_coord,'Approach '+first_stop['stop_name'],'Locate the stop or station boarding area.')
    transfer_crossings=transfer_audible=transfer_tactile=transfer_distance=0
    pednet_ids=set(first['pednet_ids']+last['pednet_ids'])
    for leg in j['legs']:
        board=net.stops[leg['from_stop']];alight=net.stops[leg['to_stop']]
        coords=(float(board['stop_lon']),float(board['stop_lat']));dest=(float(alight['stop_lon']),float(alight['stop_lat']))
        connection=leg.pop('transfer_walk',None)
        if connection:
            old=net.stops[connection['from_stop']];old_coord=(float(old['stop_lon']),float(old['stop_lat']))
            connector(old_coord,connection['path'][0],'Walk to the transfer stop','Locate the mapped pedestrian connection.')
            steps.extend(connection['details']['steps'])
            if len(connection['path'])>1:segments.append(dict(mode='walk',coordinates=connection['details']['coordinates']))
            connector(connection['path'][-1],coords,'Approach '+board['stop_name'],'Locate the transfer boarding area.')
            pednet_ids.update(connection['details']['pednet_ids'])
            transfer_seconds+=connection['seconds'];transfer_distance+=connection['distance']
            transfer_crossings+=connection['details']['crossings'];transfer_audible+=connection['details']['audible'];transfer_tactile+=connection['details']['tactile']
        dep=iso_at(day,leg['departure_seconds']);arr=iso_at(day,leg['arrival_seconds'])
        departure_label=datetime.fromisoformat(dep).strftime('%I:%M %p').lstrip('0');arrival_label=datetime.fromisoformat(arr).strftime('%I:%M %p').lstrip('0')
        vehicle=('subway Line ' if leg['mode']=='subway' else 'light rail Line ' if leg['mode']=='streetcar' and leg['route'] in ('5','6') else leg['mode']+' ')+leg['route']
        departure_kind='Predicted' if leg['departure_live'] else 'Scheduled'
        arrival_kind='Predicted' if leg['arrival_live'] else 'Scheduled'
        title=f'Wait for {vehicle}'
        steps.append(dict(kind='wait',title=title,text=title+f". At {board['stop_name']}. {leg['headsign']}. {departure_kind} departure {departure_label}; arrive at least one minute before boarding.",distance=0,coordinates=list(coords),crossing=False,scheduled_time=dep,timing='real-time' if leg['departure_live'] else 'scheduled'))
        title=f'Board {vehicle}'
        steps.append(dict(kind='board',title=title,text=title+f". At {board['stop_name']}. {leg['headsign']}. Check the route and destination announcement before boarding."+(' Station entry and platform walking times are estimates; indoor pathways are not mapped.' if leg['mode']=='subway' else ''),distance=0,coordinates=list(coords),crossing=False,scheduled_time=dep,timing='real-time' if leg['departure_live'] else 'scheduled'))
        title=f"Ride {leg['stops']} stops to {alight['stop_name']}"
        steps.append(dict(kind='ride',title=title,text=title+f'. Stay on {vehicle}. {arrival_kind} arrival {arrival_label}.',distance=0,coordinates=list(coords),end_coordinates=list(dest),crossing=False,scheduled_time=arr,timing='real-time' if leg['arrival_live'] else 'scheduled'))
        title=f"Get off at {alight['stop_name']}"
        steps.append(dict(kind='alight',title=title,text=title+'. '+('Follow the transfer walking directions to the next boarding stop.' if leg!=j['legs'][-1] else 'Continue on foot to your destination.'),distance=0,coordinates=list(dest),crossing=False))
        segments.append(dict(mode=leg['mode'],route=leg['route'],coordinates=bus_geometry(db,leg,net)))
        ride_seconds+=leg['arrival_seconds']-leg['departure_seconds']
        leg.update(from_name=board['stop_name'],to_name=alight['stop_name'],departure_time=dep,arrival_time=arr,
                   timing='real-time' if leg['departure_live'] and leg['arrival_live'] else 'mixed' if leg['departure_live'] or leg['arrival_live'] else 'scheduled')
    connector(dest,egress['path'][-1],'Rejoin the mapped pedestrian path','Locate the path from the stop.')
    steps.extend(last['steps'])
    if len(last['coordinates'])>1:segments.append(dict(mode='walk',coordinates=last['coordinates']))
    connector(egress['path'][0],end,'Approach your destination','Locate the destination entrance.')
    duration=math.ceil(j['total_seconds']);walk_seconds=access['seconds']+egress['seconds']+transfer_seconds
    origin_offset=distance(start,access['path'][0]);destination_offset=distance(end,egress['path'][0])
    legs=j['legs'];timing='real-time' if all(l['timing']=='real-time' for l in legs) else 'mixed' if any(l['timing']!='scheduled' for l in legs) else 'scheduled'
    waiting_seconds=max(0,duration-walk_seconds-ride_seconds)
    walk_minutes,wait_minutes,ride_minutes=minute_parts(walk_seconds,waiting_seconds,ride_seconds)
    return dict(pednet_ids=sorted(pednet_ids),id='',name='TTC journey',mode='transit',coordinates=[list(start)]+[c for s in segments for c in s['coordinates']]+[list(end)],segments=segments,steps=steps,distance=round(first['distance']+last['distance']+transfer_distance+access['offset']+egress['offset']+origin_offset+destination_offset),duration_seconds=duration,minutes=max(1,math.ceil(duration/60)),crossings=first['crossings']+last['crossings']+transfer_crossings,audible=first['audible']+last['audible']+transfer_audible,tactile=first['tactile']+last['tactile']+transfer_tactile,walking_minutes=walk_minutes,riding_minutes=ride_minutes,waiting_minutes=wait_minutes,transfers=len(legs)-1,bus_legs=legs,transit_legs=legs,departure_time=depart.isoformat(),arrival_time=datetime.fromtimestamp(depart.timestamp()+duration,TZ).isoformat(),timing=timing,snap_distances=[round(origin_offset),round(destination_offset)],stop_offsets=[round(access['offset']),round(egress['offset'])],walk_seconds=walk_seconds,waiting_seconds=waiting_seconds,riding_seconds=ride_seconds)


def upcoming_arrivals(stop_ids, when=None, limit=6):
    when=when or datetime.now(TZ);now=when.timestamp()
    stops=stop_metadata();routes=route_metadata()
    stop_ids=[sid for sid in stop_ids[:4] if sid in stops]
    live=realtime.snapshot(now) if abs(now-datetime.now(TZ).timestamp())<=7200 and any(not s.startswith('subway:') for s in stop_ids) else dict(updates={},vehicles={},available=False,timestamp=None)
    results=[];timings={}
    with sqlite3.connect(database()) as db:
        db.row_factory=sqlite3.Row
        for sid in stop_ids:
            predictions=[]
            for offset in (-1,0,1):
                day=when.date()+timedelta(days=offset);anchor=service_epoch(day)
                services=active_services(day)
                if not services:continue
                marks=','.join('?' for _ in services)
                lookback=7200 if live['available'] else 60
                rows=db.execute(f'''SELECT times.*,trips.route,trips.headsign,trips.direction FROM times JOIN trips ON times.trip=trips.id WHERE stop=? AND departure>=? AND departure<=? AND pickup=0 AND trips.service IN ({marks}) ORDER BY departure''',(sid,now-anchor-lookback,now-anchor+10800,*sorted(services)))
                for row in rows:
                    key=(row['trip'],day)
                    if key not in timings:
                        calls=list(db.execute('SELECT * FROM times WHERE trip=? ORDER BY seq',(row['trip'],)))
                        timings[key]=realtime.trip_times(calls,row['trip'],row['route'],row['direction'],day,live)
                    call=next((r for r in timings[key] if r['seq']==row['seq']),None)
                    if not call or call['skipped'] or call['departure']<now-30:continue
                    at=call['arrival'] if call['arrival_live'] or not call['departure_live'] else call['departure']
                    if at>now+10800:continue
                    meta=routes[row['route']]
                    vehicle=live['vehicles'].get(raw_id(row['trip']))
                    if vehicle and ((vehicle['route_id'] and vehicle['route_id']!=raw_id(row['route'])) or (vehicle['direction_id'] is not None and vehicle['direction_id']!=row['direction'])):vehicle=None
                    event_key='arrival' if call['arrival_live'] or not call['departure_live'] else 'departure'
                    delay_seconds=round(at-(anchor+row[event_key])) if call['arrival_live'] or call['departure_live'] else None
                    predictions.append(dict(delay_seconds=delay_seconds,trip=row['trip'],route_id=row['route'],route=meta['route_short_name'],mode=vehicle_mode(meta,row['headsign']),direction_id=row['direction'],headsign=row['headsign'],stop_id=sid,arrival_time=datetime.fromtimestamp(at,TZ).isoformat(),minutes=max(0,math.ceil((at-now)/60)),timing='real-time' if call['arrival_live'] or call['departure_live'] else 'scheduled',vehicle=vehicle))
            predictions.sort(key=lambda p:p['arrival_time'])
            results.append(dict(id=sid,name=stops[sid]['stop_name'],coordinates=[float(stops[sid]['stop_lon']),float(stops[sid]['stop_lat'])],arrivals=predictions[:limit]))
    return dict(stops=results,realtime_available=live['available'],updated_at=live['timestamp'])
