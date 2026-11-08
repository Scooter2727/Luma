from datetime import date, datetime, timedelta
import math
import sqlite3
import networkx as nx
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend.walking import weight, network, distance
from backend.transit import active_services, database, seconds, TZ, iso_at

client = TestClient(app)
BASE = dict(start=[-79.3806,43.6453], end=[-79.3832,43.6525], start_name="Union Station", end_name="Nathan Phillips Square", departure_time="2026-11-07T12:00:00-05:00")

def get_routes(**changes):
    response=client.post('/api/routes',json=dict(BASE,**changes))
    assert response.status_code==200,response.text
    return response.json()['routes']

def test_data_and_search():
    assert client.get('/api/health').json()['locations']>16000
    assert client.get('/api/search?q=Union').json()[0]['name']=='Union Station'
    assert any('Museum' in r['name'] for r in client.get('/api/search?q=Royal Ontario').json())

def test_preferences_change_actual_paths_without_inflating_eta():
    fastest=get_routes()[0]
    options=get_routes(prefer_audible=True)
    preferred=options[0]
    comparison=next(r for r in options if r['name']=='Fastest walk')
    assert fastest['name']=='Fastest walk'
    assert fastest['coordinates']==comparison['coordinates']
    assert preferred['coordinates']!=fastest['coordinates']
    assert preferred['crossings']-preferred['audible']<fastest['crossings']-fastest['audible']
    assert preferred['duration_seconds']>=fastest['duration_seconds']
    assert preferred['extra_minutes']>0
    assert datetime.fromisoformat(fastest['arrival_time'])-datetime.fromisoformat(fastest['departure_time'])==timedelta(seconds=fastest['duration_seconds'])
    assert len(fastest['steps'])>10
    assert any('Bay' in s['title'] for s in fastest['steps'])
    assert all(s['title'] and s['coordinates'] for s in fastest['steps'])
    # Split segments preserve physical crossing time rather than charging per geometry vertex.
    assert fastest['duration_seconds']<fastest['distance']/1.2+fastest['crossings']*21+2

@pytest.mark.parametrize('preference',['audible','fewer','tactile'])
def test_each_preference_affects_graph_cost(preference):
    g=nx.Graph()
    g.add_edge('a','b',length=10,crossing=True,audible=False,tactile=False)
    g.add_edge('a','c',length=22,crossing=False,audible=False,tactile=False)
    g.add_edge('c','b',length=22,crossing=False,audible=False,tactile=False)
    assert nx.shortest_path(g,'a','b',weight=weight())==['a','b']
    assert nx.shortest_path(g,'a','b',weight=weight(**{preference:True}))==['a','c','b']

@pytest.mark.parametrize('count',[1,2,3])
def test_real_alternatives_are_distinct_connected_and_do_not_modify_network(count):
    from backend.api import walking_alternatives
    g=nx.Graph();a=(-79.38,43.65);b=(-79.378,43.65)
    for i in range(count):
        middle=(-79.379,43.65+i*.0001)
        for u,v in [(a,middle),(middle,b)]:
            g.add_edge(u,v,length=distance(u,v),crossing=False,audible=False,tactile=False)
    before=g.copy()
    initial=nx.shortest_path(g,a,b,weight=weight())
    paths=walking_alternatives(g,a,b,[initial],1.2,dict(audible=False,fewer=False,tactile=False))
    assert len(paths)==count
    assert len(set(map(tuple,paths)))==count
    assert all(path[0]==a and path[-1]==b and nx.is_simple_path(g,path) for path in paths)
    assert nx.utils.graphs_equal(g,before)

def test_default_walk_returns_up_to_three_real_geometries():
    routes=get_routes()
    assert 1<=len(routes)<=3
    assert len({str(r['coordinates']) for r in routes})==len(routes)
    assert routes[0]['name']=='Fastest walk'
    assert all(r['steps'] and r['segments'] and r['minutes']>0 and r['distance']>0 for r in routes)

def test_bus_comparison_keeps_walking_option_within_three_route_limit(monkeypatch):
    import backend.api as api
    monkeypatch.setattr(api,'bus_journeys',lambda *args,**kwargs:[dict(mode='bus',steps=[]) for _ in range(3)])
    routes=get_routes(mode='bus')
    assert len(routes)==3
    assert [r['mode'] for r in routes]==['bus','bus','walk']

def test_endpoint_projection_splits_same_edge_and_does_not_mutate_shared_graph():
    net=network();u,v=next((u,v) for u,v in net.edges if distance(u,v)>30)
    a=tuple(.75*x+.25*y for x,y in zip(u,v));b=tuple(.25*x+.75*y for x,y in zip(u,v))
    before=net.g.number_of_edges()
    g,(s,t),offsets=net.query_graph(a,b)
    path=nx.shortest_path(g,s,t,weight='length')
    assert math.isclose(sum(g[x][y]['length'] for x,y in zip(path,path[1:])),distance(s,t),abs_tol=.3)
    assert max(offsets)<.2
    assert net.g.number_of_edges()==before

@pytest.mark.parametrize('changes',[{'start':[-80,44]},{'end':BASE['start']},{'walking_speed':0},{'start':[float('nan'),43.65]},{'mode':'flying'}])
def test_invalid_routes(changes):
    # NaN is sent as JSON text to exercise server validation, not the client's strict encoder.
    import json
    response=client.post('/api/routes',content=json.dumps(dict(BASE,**changes)),headers={'Content-Type':'application/json'})
    assert response.status_code==422

def test_slower_speed_changes_physical_time():
    fast=get_routes()[0];slow=get_routes(walking_speed=.8)[0]
    assert slow['duration_seconds']>fast['duration_seconds']
    assert slow['minutes']==math.ceil(slow['duration_seconds']/60)

def test_bus_journey_matches_feed_and_includes_complete_walking_legs():
    routes=get_routes(end=[-79.3948,43.6677],end_name='Royal Ontario Museum',mode='bus')
    bus=routes[0]
    assert bus['mode']=='transit' and bus['timing']=='scheduled'
    assert any(r['mode']=='walk' for r in routes)
    assert 0<=bus['transfers']<=1
    assert bus['walking_minutes']>0 and bus['waiting_minutes']>=1
    assert {'wait','board','ride','alight','arrive'}.issubset({s['kind'] for s in bus['steps']})
    assert any(s['mode'] in ('bus','streetcar','subway') and len(s['coordinates'])>3 for s in bus['segments'])
    previous=datetime.fromisoformat(bus['departure_time'])
    db=sqlite3.connect(database());db.row_factory=sqlite3.Row
    for leg in bus['bus_legs']:
        departure=datetime.fromisoformat(leg['departure_time']);arrival=datetime.fromisoformat(leg['arrival_time'])
        assert departure>=previous+timedelta(seconds=60)
        assert arrival>departure
        trip=db.execute('SELECT * FROM trips WHERE id=?',(leg['trip'],)).fetchone()
        service_day=(departure-timedelta(seconds=leg['departure_seconds'])).date()
        assert trip['service'] in active_services(service_day)
        board=db.execute('SELECT * FROM times WHERE trip=? AND seq=?',(leg['trip'],leg['board_seq'])).fetchone()
        alight=db.execute('SELECT * FROM times WHERE trip=? AND seq=?',(leg['trip'],leg['alight_seq'])).fetchone()
        assert board['stop']==leg['from_stop'] and board['pickup']==0
        assert alight['stop']==leg['to_stop'] and alight['dropoff']==0
        assert datetime.fromisoformat(iso_at(service_day,board['departure']))==departure
        assert datetime.fromisoformat(iso_at(service_day,alight['arrival']))==arrival
        previous=arrival
    db.close()
    assert datetime.fromisoformat(bus['arrival_time'])>=previous

def test_service_calendar_and_midnight_times():
    assert seconds('25:10:00')==90600
    assert datetime.fromisoformat(iso_at(date(2026,11,7),90600)).date()==date(2026,11,8)
    assert active_services(date(2026,11,7))!=active_services(date(2026,11,9))
    assert not active_services(date(2027,1,10))
    response=client.post('/api/routes',json=dict(BASE,mode='bus',departure_time='2027-01-10T12:00'))
    assert response.status_code==422 and 'timetable' in response.json()['detail']

@pytest.mark.parametrize('hour',[12,24])
@pytest.mark.parametrize('miss_transfer',[False,True])
@pytest.mark.parametrize('live_delay',[0,60,300])
def test_same_stop_transfer_buffer_and_overnight_service(tmp_path,monkeypatch,hour,miss_transfer,live_delay):
    from types import SimpleNamespace
    from backend import transit
    path=tmp_path/'schedule.sqlite'
    db=sqlite3.connect(path)
    db.executescript('CREATE TABLE trips(id TEXT,route TEXT,service TEXT,headsign TEXT,shape TEXT); CREATE TABLE times(trip TEXT,stop TEXT,seq INTEGER,arrival INTEGER,departure INTEGER,pickup INTEGER,dropoff INTEGER); CREATE TABLE shapes(id TEXT,seq INTEGER,lat REAL,lon REAL);')
    db.executemany('INSERT INTO trips VALUES(?,?,?,?,?)',[('t1','1','s','East','x'),('t2','2','s','North','y')])
    base=hour*3600;second_departure=base+(15*60+30 if miss_transfer else 17*60)
    db.executemany('INSERT INTO times VALUES(?,?,?,?,?,?,?)',[
        ('t1','a',1,base+300,base+300,0,0),('t1','b',2,base+900,base+900,0,0),
        ('t2','b',1,second_departure,second_departure,0,0),('t2','c',2,base+1620,base+1620,0,0)])
    db.execute("ALTER TABLE trips ADD COLUMN direction TEXT DEFAULT '0'")
    db.commit();db.close()
    nodes={'a':(-79.38,43.65),'b':(-79.35,43.67),'c':(-79.32,43.69)}
    g=nx.Graph();g.add_nodes_from(nodes.values())
    net=SimpleNamespace(stop_nodes=nodes,stop_offsets={s:0 for s in nodes},stops={s:dict(stop_lon=c[0],stop_lat=c[1],stop_name=s.upper()) for s,c in nodes.items()})
    monkeypatch.setattr(transit,'database',lambda:path)
    monkeypatch.setattr(transit,'feed_range',lambda:('20261107','20261108'))
    monkeypatch.setattr(transit,'active_services',lambda d:{'s'} if d==date(2026,11,7) else set())
    monkeypatch.setattr(transit,'route_metadata',lambda:{str(i):{'route_short_name':str(i)} for i in [1,2]})
    depart=datetime(2026,11,7,12 if hour==12 else 23,0 if hour==12 else 55,tzinfo=TZ)
    if live_delay:
        class Clock(datetime):
            @classmethod
            def now(cls,tz=None):return depart
        monkeypatch.setattr(transit,'datetime',Clock)
        live=dict(available=True,timestamp=depart.timestamp(),vehicles={},updates={'t1':[dict(
            trip_id='t1',route_id='1',direction_id='0',start_date='20261107',relationship=0,delay=None,
            stops=[dict(seq=2,stop_id='b',relationship=0,arrival={'delay':live_delay},departure={})])]})
        monkeypatch.setattr(transit.realtime,'snapshot',lambda:live)
    result=transit.bus_journeys(net,g,(nodes['a'],nodes['c']),nodes['a'],nodes['c'],depart,1.2,dict(audible=False,fewer=False,tactile=False))
    if miss_transfer or live_delay>=300:assert not result
    else:
        assert result[0]['transfers']==1
        assert [l['route'] for l in result[0]['bus_legs']]==['1','2']
        arrival=datetime.fromisoformat(result[0]['arrival_time'])
        assert arrival==datetime.fromisoformat(iso_at(date(2026,11,7),base+1620))
        assert result[0]['duration_seconds']==int(arrival.timestamp()-depart.timestamp())
        if live_delay:assert result[0]['timing']=='mixed'

def test_gtfs_service_anchor_spans_daylight_saving_change():
    from backend.transit import service_epoch
    # GTFS defines the service anchor as noon minus 12 elapsed hours.
    day=date(2026,11,1)
    assert service_epoch(day)==datetime(2026,11,1,12,tzinfo=TZ).timestamp()-43200
    assert datetime.fromisoformat(iso_at(day,3*3600)).timestamp()-datetime.fromisoformat(iso_at(day,3600)).timestamp()==7200

def test_every_step_has_ai_text_equal_to_text_by_default(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY',raising=False)
    for route in get_routes()+get_routes(prefer_audible=True):
        assert route['ai_directions']=='left-right'
        assert all(s['ai_text']==s['text'] for s in route['steps'])

def test_clock_ai_text_matches_the_browser_instruction():
    from backend.api import instruction_text
    route=get_routes(directions='clock')[0]
    assert route['ai_directions']=='clock'
    walks=[(s,route['steps'][i-1]) for i,s in enumerate(route['steps']) if i and s['kind']=='walk' and route['steps'][i-1].get('bearing') is not None]
    assert walks
    for step,previous in walks:
        assert step['ai_text']=="Toward {} o'clock, along {}. Continue {} metres.".format(math.floor((step['bearing']-previous['bearing']+360)%360/30+.5)%12 or 12,step['street'] or 'the pedestrian path',step['distance'])
    assert instruction_text(dict(kind='walk',text='Walk.',bearing=112.6,distance=5,street='King St'),None,'cardinal')=="Head southeast along King St. Continue 5 metres."
    assert instruction_text(dict(kind='walk',text='Walk.',bearing=-22,distance=5.5,street=''),None,'cardinal')=="Head north along the pedestrian path. Continue 5.5 metres."
    assert instruction_text(dict(kind='bus',text='Board the 504.',bearing=90,distance=5),None,'cardinal')=="Board the 504."
    assert route['steps'][-1]['ai_text']==route['steps'][-1]['text']

def test_rephrase_returns_originals_without_keys():
    steps=[dict(text=s['ai_text'],street=s.get('street'),distance=s['distance'],crossing=s['crossing']) for s in get_routes()[0]['steps']]
    body=client.post('/api/speech/rephrase',json={'steps':steps}).json()
    assert body['texts']==[s['text'] for s in steps]
    assert not any(body['rephrased'])

def test_rephrase_uses_gemini_when_configured(monkeypatch):
    from backend import api
    calls=[]
    async def fake(steps):
        calls.append(steps);return ['Spoken '+s['text'] for s in steps]
    monkeypatch.setenv('GEMINI_API_KEY','k');monkeypatch.setenv('ELEVENLABS_API_KEY','k')
    monkeypatch.setattr(api.speech_phrasing,'rephrase_steps',fake)
    get_routes()
    assert not calls
    body=client.post('/api/speech/rephrase',json={'steps':[{'text':'Cross Bay St.','street':'Bay St','crossing':True,'audible':None}]}).json()
    assert body=={'texts':['Spoken Cross Bay St.'],'rephrased':[True]}
    assert calls[0][0]['street']=='Bay St'
    assert client.post('/api/speech/rephrase',json={'steps':[]}).status_code==422
    assert client.post('/api/speech/rephrase',json={'steps':[{'text':'x'}]*81}).status_code==422
