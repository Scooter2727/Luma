"""Deterministic feed and graph tests; never depend on today's external services."""
from datetime import datetime, timedelta, date
from types import SimpleNamespace
import copy
import networkx as nx
import pytest
from shapely.geometry import LineString
from shapely.strtree import STRtree
from backend import construction as c, realtime as rt
from backend.walking import xy, distance, walk_details, weight
from backend.transit_data import service_epoch, TZ


@pytest.mark.parametrize('description,expected', [
    ('Road construction; vehicle lanes closed.', ('unknown', None)),
    ('Full road closure. Pedestrian access is maintained.', ('open', None)),
    ('North sidewalk closed. South sidewalk remains open.', ('closed', 'north')),
    ('North sidewalk remains open and south sidewalk is closed.', ('closed', 'south')),
    ('Close North Sidewalk for bridge construction.', ('closed', 'north')),
    ('Both sidewalks closed.', ('closed', 'all')),
    ('No pedestrian access.', ('closed', 'all')),
    ('No pedestrian access restrictions.', ('unknown', None)),
    ('Sidewalk will not be closed.', ('unknown', None)),
    ('Only one sidewalk closed at a time (north or south).', ('unknown', None)),
    ('Partial sidewalk closures during hoisting.', ('unknown', None)),
    ('The sidewalk will be closed.', ('closed', None)),
    ('Lane closure for north sidewalk replacement.', ('unknown', None)),
    ('North sidewalk closure is not required.', ('unknown', None)),
    ('Proposed north sidewalk closure.', ('unknown', None)),
    ('North sidewalk has been closed.', ('closed', 'north')),
])
def test_pedestrian_language_is_conservative(description, expected):
    assert c.pedestrian_scope(description) == expected


def record(now, description='North sidewalk closed.'):
    return dict(id='work-1', road='Test St', name='Test Street work', description=description,
                startTime=int((now-timedelta(days=1)).timestamp()*1000),
                endTime=int((now+timedelta(days=1)).timestamp()*1000),
                longitude=-79.379, latitude=43.65, workPeriod='Continuous',
                geoPolyline='[-79.38,43.65],[-79.378,43.65]')


def small_net():
    a=(-79.38,43.65008); b=(-79.378,43.65008)
    x=(-79.38,43.64992); y=(-79.378,43.64992)
    g=nx.Graph()
    for u,v,crossing,label in [(a,b,False,'north'),(x,y,False,'south'),(a,x,True,'left'),(y,b,True,'right')]:
        g.add_edge(u,v,length=distance(u,v),crossing=crossing,audible=True,tactile=True,
                   street='Test St',pednet_id=label,signal_name='',control='')
    edges=list(g.edges);lines=[LineString([xy(u),xy(v)]) for u,v in edges]
    return SimpleNamespace(g=g,edges=edges,lines=lines,tree=STRtree(lines),edge_attrs={edge:g.edges[edge] for edge in edges}),a,b


def set_restrictions(monkeypatch, records):
    monkeypatch.setattr(c.current_feed,'get',lambda:dict(data=records,available=True,stale=False,fetched_at=1))
    monkeypatch.setattr(c.arcgis_feed,'get',lambda:dict(data=[],available=True,stale=False,fetched_at=1))


def test_confirmed_sidewalk_closure_detours_but_never_blocks_opposite_side(monkeypatch):
    now=datetime(2026,11,7,12,tzinfo=TZ);net,a,b=small_net()
    before=net.g.copy();set_restrictions(monkeypatch,[record(now)])
    state=c.snapshot(net,now);g=net.g.copy()
    assert c.apply_closures(g,state)==1
    assert not g.has_edge(a,b)
    assert any(e['pednet_id']=='south' for _,_,e in g.edges(data=True))
    path=nx.shortest_path(g,a,b,weight=weight())
    assert len(path)==4
    assert walk_details(g,path,1.2)['duration_seconds']>walk_details(before,[a,b],1.2)['duration_seconds']
    assert nx.utils.graphs_equal(net.g,before)
    assert state['features'][0]['properties']['routing_status']=='blocked'
    set_restrictions(monkeypatch,[])
    cleared=c.snapshot(net,now)
    assert cleared['revision']!=state['revision']
    assert c.apply_closures(before,cleared)==0 and before.has_edge(a,b)


@pytest.mark.parametrize('description', ['Road closed; sidewalks remain open.', 'Sidewalk work.', 'The sidewalk is closed.', 'North or south sidewalk closed at a time.'])
def test_road_only_unknown_side_and_alternating_closures_do_not_remove_paths(monkeypatch,description):
    now=datetime(2026,11,7,12,tzinfo=TZ);net,_,_=small_net()
    set_restrictions(monkeypatch,[record(now,description)])
    assert c.apply_closures(net.g,c.snapshot(net,now))==0


def test_restriction_dates_and_overnight_work_hours(monkeypatch):
    now=datetime(2026,11,7,2,tzinfo=TZ);net,_,_=small_net()
    r=record(now);r.update(workPeriod='Daily',scheduleFriday='21:00-05:00')
    set_restrictions(monkeypatch,[r])
    assert c.snapshot(net,now)['_blocked']
    assert not c.snapshot(net,now.replace(hour=12))['_blocked']
    r['startTime']=int((now+timedelta(hours=1)).timestamp()*1000)
    assert not c.snapshot(net,now)['features']


def calls():
    return [dict(trip='surface:t',stop='surface:'+s,seq=i+1,arrival=12*3600+i*600,departure=12*3600+i*600,pickup=0,dropoff=0) for i,s in enumerate(('a','b','c'))]


def live_state(stops=None, **changes):
    day=date(2026,11,7);stamp=service_epoch(day)+12*3600
    update=dict(trip_id='t',route_id='10',direction_id='1',start_date='20261107',relationship=0,timestamp=stamp,delay=None,stops=stops or [])
    update.update(changes)
    return dict(updates={'t':[update]},vehicles={},available=True,timestamp=stamp)


def stop(seq, name, **changes):
    result=dict(seq=seq,stop_id=name,relationship=0,arrival={},departure={})
    result.update(changes);return result


def test_live_predictions_change_wait_and_ride_without_changing_static_schedule():
    day=date(2026,11,7);anchor=service_epoch(day);rows=calls();before=copy.deepcopy(rows)
    state=live_state([stop(1,'a',departure={'time':anchor+12*3600+180}),stop(3,'c',arrival={'time':anchor+12*3600+1500})])
    result=rt.trip_times(rows,'surface:t','surface:10','1',day,state)
    assert result[0]['departure']==anchor+12*3600+180
    assert result[1]['arrival']==anchor+12*3600+600+180
    assert result[2]['arrival']==anchor+12*3600+1500
    assert result[2]['arrival_live'] and rows==before


@pytest.mark.parametrize('change',[{'route_id':'11'},{'direction_id':'0'},{'start_date':'20261108'}])
def test_wrong_route_direction_or_service_date_never_matches(change):
    state=live_state([stop(1,'a',departure={'delay':600})],**change)
    result=rt.trip_times(calls(),'surface:t','surface:10','1',date(2026,11,7),state)
    assert not any(r['departure_live'] for r in result)


def test_stop_ids_must_agree_with_sequence_and_no_data_ends_propagation():
    state=live_state([stop(1,'wrong-stop',departure={'delay':900}),stop(2,'b',arrival={'delay':120}),stop(3,'c',relationship=2)])
    result=rt.trip_times(calls(),'surface:t','surface:10','1',date(2026,11,7),state)
    assert not result[0]['departure_live']
    assert result[1]['arrival_live']
    assert not result[2]['arrival_live']


def test_cancellations_skipped_stops_and_subway_fallback():
    day=date(2026,11,7)
    assert rt.trip_times(calls(),'surface:t','surface:10','1',day,live_state(relationship=3))==[]
    result=rt.trip_times(calls(),'surface:t','surface:10','1',day,live_state([stop(2,'b',relationship=1)]))
    assert result[1]['skipped']
    result=rt.trip_times(calls(),'subway:t','subway:10','1',day,live_state(delay=500))
    assert not any(r['arrival_live'] for r in result)


def test_stale_feed_is_not_live(monkeypatch):
    monkeypatch.setattr(rt.trip_feed,'get',lambda:dict(data=dict(timestamp=100,entries=[]),available=True,stale=False,fetched_at=100))
    monkeypatch.setattr(rt.vehicle_feed,'get',lambda:dict(data=None,available=False,stale=False,fetched_at=None))
    assert not rt.snapshot(1000)['available']
    assert rt.snapshot(1000)['updates']=={}


def test_cache_shares_requests_and_expires_failed_predictions(monkeypatch,tmp_path):
    from backend import live_cache
    monkeypatch.setenv('LUMA_EXTERNAL_DATA','1')
    monkeypatch.setattr(live_cache,'cache_directory',lambda:tmp_path)
    now=[1000];monkeypatch.setattr(live_cache.time,'time',lambda:now[0])
    count=[]
    def fetch():
        count.append(1)
        if len(count)>1:raise OSError('offline')
        return {'value':1}
    cache=live_cache.CachedFeed('test-feed',30,fetch,60)
    assert cache.get()['available']
    cache.get();assert len(count)==1
    now[0]+=31
    assert cache.get()['available'] and cache.get()['stale']
    now[0]+=120
    assert not cache.get()['available']


def test_protobuf_feed_decoding_preserves_identity_and_zero_direction(monkeypatch):
    from google.transit import gtfs_realtime_pb2 as pb
    feed=pb.FeedMessage();feed.header.gtfs_realtime_version='2.0';feed.header.timestamp=1000
    update=feed.entity.add();update.id='trip';update.trip_update.trip.trip_id='t'
    update.trip_update.trip.route_id='10';update.trip_update.trip.direction_id=0
    update.trip_update.trip.start_date='20261107'
    call=update.trip_update.stop_time_update.add();call.stop_id='a';call.stop_sequence=1;call.arrival.time=1200
    response=SimpleNamespace(content=feed.SerializeToString(),raise_for_status=lambda:None)
    monkeypatch.setattr(rt.httpx,'get',lambda *a,**kw:response)
    data=rt.fetch_feed(rt.TRIPS)
    assert data['timestamp']==1000
    assert data['entries'][0]['direction_id']=='0'
    assert data['entries'][0]['stops'][0]['arrival']['time']==1200


def test_stop_arrivals_use_predictions_with_schedule_fallback_and_cancelled_trip_removed(monkeypatch,tmp_path):
    import sqlite3
    from backend import transit
    path=tmp_path/'times.sqlite';db=sqlite3.connect(path)
    db.executescript('CREATE TABLE trips(id TEXT,route TEXT,service TEXT,headsign TEXT,direction TEXT); CREATE TABLE times(trip TEXT,stop TEXT,seq INTEGER,arrival INTEGER,departure INTEGER,pickup INTEGER,dropoff INTEGER);')
    for i in (1,2,3):
        db.execute('INSERT INTO trips VALUES(?,?,?,?,?)',(f'surface:t{i}','surface:10','s','East','1'))
        db.execute('INSERT INTO times VALUES(?,?,?,?,?,?,?)',(f'surface:t{i}','surface:a',1,43200+i*300,43200+i*300,0,0))
    db.commit();db.close()
    when=datetime(2026,11,7,12,tzinfo=TZ)
    class Clock(datetime):
        @classmethod
        def now(cls,tz=None):return when
    monkeypatch.setattr(transit,'datetime',Clock)
    monkeypatch.setattr(transit,'database',lambda:path)
    monkeypatch.setattr(transit,'active_services',lambda d:{'s'} if d==when.date() else set())
    monkeypatch.setattr(transit,'stop_metadata',lambda:{'surface:a':dict(stop_name='A',stop_lon=-79.38,stop_lat=43.65)})
    monkeypatch.setattr(transit,'route_metadata',lambda:{'surface:10':dict(route_short_name='10',mode='bus')})
    state=live_state();state['updates']={
        't1':[dict(state['updates']['t'][0],trip_id='t1',stops=[stop(1,'a',arrival={'delay':180})])],
        't3':[dict(state['updates']['t'][0],trip_id='t3',relationship=3)],
    }
    monkeypatch.setattr(transit.realtime,'snapshot',lambda *a:state)
    arrivals=transit.upcoming_arrivals(['surface:a'],when)['stops'][0]['arrivals']
    assert [(a['trip'],a['minutes'],a['timing']) for a in arrivals]==[('surface:t1',8,'real-time'),('surface:t2',10,'scheduled')]
    assert arrivals[0]['delay_seconds']==180
    assert arrivals[1]['delay_seconds'] is None


def test_short_closure_intersecting_a_long_path_edge_still_blocks_it():
    feature=dict(properties=dict(street='Test St',side='north'))
    line=LineString([xy((-79.379,43.65)),xy((-79.3788,43.65))])
    assert c.matches_edge((-79.38,43.65008),(-79.378,43.65008),dict(street='Test St',crossing=False),feature,line)


@pytest.mark.parametrize('parts',[(981.2,132.8,540),(60,60,60),(30,30,30),(0,1,59),(0,0,1600)])
def test_displayed_time_components_add_up_to_eta(parts):
    import math
    from backend.transit import minute_parts
    rounded=minute_parts(*parts)
    assert sum(rounded)==math.ceil(sum(parts)/60)
    assert all(abs(value-seconds/60)<1 for value,seconds in zip(rounded,parts))


def test_replacement_bus_is_not_labelled_as_a_streetcar():
    from backend.transit import vehicle_mode
    assert vehicle_mode(dict(mode='streetcar'),'East - 503 Kingston Rd Replacement Bus towards Victoria Park')=='bus'
    assert vehicle_mode(dict(mode='streetcar'),'East - 504 King')=='streetcar'


def test_walking_stop_metadata_does_not_build_the_transit_database(monkeypatch):
    from backend import transit_data
    transit_data.stop_metadata.cache_clear()
    def unexpected():raise AssertionError('Walking must not build the TTC timetable')
    monkeypatch.setattr(transit_data,'database',unexpected)
    stops=transit_data.stop_metadata()
    assert any(s.startswith('surface:') for s in stops)
    assert any(s.startswith('subway:') for s in stops)


def test_complete_transit_index_leaves_room_in_serverless_temporary_storage():
    from backend.transit_data import database
    # The previous 410 MB index plus dependency extraction and SQLite sort
    # spills exceeded the host's temporary disk. Preserve runtime headroom.
    assert database().stat().st_size < 300*1024*1024


@pytest.mark.parametrize('blocked',[False,True])
def test_transfers_need_a_real_unblocked_walking_connection(monkeypatch,tmp_path,blocked):
    import sqlite3
    from backend import transit
    path=tmp_path/'transfer.sqlite';db=sqlite3.connect(path)
    db.executescript('CREATE TABLE trips(id TEXT,route TEXT,service TEXT,headsign TEXT,shape TEXT,direction TEXT); CREATE TABLE times(trip TEXT,stop TEXT,seq INTEGER,arrival INTEGER,departure INTEGER,pickup INTEGER,dropoff INTEGER); CREATE TABLE shapes(id TEXT,seq INTEGER,lat REAL,lon REAL);')
    db.executemany('INSERT INTO trips VALUES(?,?,?,?,?,?)',[('t1','1','s','East','x','0'),('t2','2','s','North','y','0')])
    db.executemany('INSERT INTO times VALUES(?,?,?,?,?,?,?)',[
        ('t1','a',1,43500,43500,0,0),('t1','b',2,44100,44100,0,0),
        ('t2','b2',1,44220,44220,0,0),('t2','c',2,44820,44820,0,0)])
    db.commit();db.close()
    nodes={'a':(-79.38,43.65),'b':(-79.35,43.67008),'b2':(-79.3495,43.67008),'c':(-79.32,43.69)}
    graph=nx.Graph();graph.add_nodes_from(nodes.values())
    graph.add_edge(nodes['b'],nodes['b2'],length=distance(nodes['b'],nodes['b2']),crossing=False,audible=False,tactile=False,street='Test St',pednet_id='transfer',signal_name='',control='')
    if blocked:
        feature=dict(properties=dict(street='Test St',side='north'))
        line=LineString([xy((-79.35,43.67)),xy((-79.3495,43.67))])
        assert c.apply_closures(graph,dict(_blocked=[(feature,line,{'transfer'})]))==1
    net=SimpleNamespace(stop_nodes=nodes,stop_offsets={s:0 for s in nodes},stops={s:dict(stop_lon=c[0],stop_lat=c[1],stop_name=s) for s,c in nodes.items()})
    monkeypatch.setattr(transit,'database',lambda:path)
    monkeypatch.setattr(transit,'feed_range',lambda:('20261107','20261107'))
    monkeypatch.setattr(transit,'active_services',lambda day:{'s'} if day==date(2026,11,7) else set())
    monkeypatch.setattr(transit,'route_metadata',lambda:{'1':dict(route_short_name='1',mode='bus'),'2':dict(route_short_name='2',mode='streetcar')})
    result=transit.bus_journeys(net,graph,(nodes['a'],nodes['c']),nodes['a'],nodes['c'],datetime(2026,11,7,12,tzinfo=TZ),1.2,dict(audible=False,fewer=False,tactile=False))
    if blocked:
        assert not result
    else:
        assert result[0]['transfers']==1
        assert [l['mode'] for l in result[0]['transit_legs']]==['bus','streetcar']
        assert any(s['mode']=='walk' and s['coordinates']==[list(nodes['b']),list(nodes['b2'])] for s in result[0]['segments'])
        assert result[0]['walk_seconds']+result[0]['waiting_seconds']+result[0]['riding_seconds']==result[0]['duration_seconds']
