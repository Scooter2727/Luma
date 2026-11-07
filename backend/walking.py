"""Pedestrian routing, spatial matching, and geometry-derived instructions."""
import csv,json,math,pickle
from uuid import uuid4
from threading import Lock
from functools import lru_cache
from pathlib import Path
import networkx as nx
from shapely.geometry import LineString,Point,shape
from shapely.strtree import STRtree

ROOT=Path(__file__).resolve().parents[1]
SCALE_X=111195*math.cos(math.radians(43.7));SCALE_Y=111195
def xy(c):return (c[0]*SCALE_X,c[1]*SCALE_Y)
def ll(p):return (p[0]/SCALE_X,p[1]/SCALE_Y)
def distance(a,b):return math.dist(xy(a),xy(b))
def bearing(a,b):
    x,y=xy(a);u,v=xy(b)
    return math.degrees(math.atan2(u-x,v-y))%360
def cardinal(angle):return ['north','northeast','east','southeast','south','southwest','west','northwest'][round(angle/45)%8]
def turn(previous,current):
    delta=(current-previous+180)%360-180
    if abs(delta)<30:return 'Continue'
    if abs(delta)>155:return 'Turn around'
    return ('Bear ' if abs(delta)<60 else 'Turn ')+('right' if delta>0 else 'left')
def key(c):return tuple(round(v,6) for v in c)

class WalkingNetwork:
    def __init__(self):
        with (ROOT/'data/WAYFINDER_ALL_LOCATIONS.csv').open(encoding='utf-8-sig',newline='') as f:locations=list(csv.DictReader(f))
        signals=[r for r in locations if r['category']=='crossing signal' and r['latitude']]
        signal_points=[Point(xy((float(r['longitude']),float(r['latitude'])))) for r in signals]
        signal_tree=STRtree(signal_points);by_px={r['id'].removeprefix('aps-'):r for r in signals}
        tactile=[Point(xy((float(r['longitude']),float(r['latitude'])))) for r in locations if 'tactile' in r['feature'] and r['latitude']]
        tactile_tree=STRtree(tactile)
        road_features=json.loads((ROOT/'data/sources/centreline.geojson').read_text(encoding='utf-8'))['features']
        roads=[];names=[]
        for f in road_features:
            name=f['properties'].get('LINEAR_NAME_FULL')
            if not name or not f['geometry']:continue
            geom=shape(f['geometry']);parts=geom.geoms if geom.geom_type=='MultiLineString' else [geom]
            for line in parts:
                if line.geom_type!='LineString':continue
                roads.append(LineString([xy(c) for c in line.coords]));names.append(name)
        road_tree=STRtree(roads)
        self.g=nx.Graph()
        data=json.loads((ROOT/'data/sources/pedestrian-network.geojson').read_text(encoding='utf-8'))
        for f in data['features']:
            if not f['geometry']:continue
            p=f['properties'];geom=f['geometry'];parts=geom['coordinates'] if geom['type']=='MultiLineString' else [geom['coordinates']]
            for line in parts:
                if len(line)<2:continue
                crossing=p.get('CROSSWALK')==1
                whole=LineString([xy(c) for c in line]);mid=whole.interpolate(.5,normalized=True)
                source_len=whole.length
                if source_len<.05:continue
                road_id=int(road_tree.nearest(mid))
                road_name=names[road_id] if mid.distance(roads[road_id])<=55 else 'the pedestrian path'
                # Sidewalks follow a road; crosswalks intersect a road. Use orientation to disambiguate corners.
                candidates=road_tree.query(mid.buffer(35))
                line_angle=bearing(line[0],line[-1])
                def road_score(i):
                    road=roads[i];coords=list(road.coords);angle=math.degrees(math.atan2(coords[-1][0]-coords[0][0],coords[-1][1]-coords[0][1]))%180
                    diff=abs((line_angle-angle+90)%180-90)
                    return mid.distance(road)+(abs(90-diff) if crossing else diff)*.35
                if len(candidates):road_id=min(candidates,key=road_score);road_name=names[road_id]
                signal=by_px.get(str(p.get('PX','')).strip()) if crossing else None
                if crossing and not signal:
                    i=int(signal_tree.nearest(mid))
                    if mid.distance(signal_points[i])<=45:signal=signals[i]
                tactile_known=crossing and any(Point(xy(c)).distance(tactile[int(tactile_tree.nearest(Point(xy(c))))])<=8 for c in (line[0],line[-1]))
                for a,b in zip(line,line[1:]):
                    u,v=key(a),key(b);length=distance(u,v)
                    if u==v or length<.05:continue
                    attrs=dict(length=length,crossing=crossing,audible=bool(signal),tactile=bool(tactile_known),street=road_name,signal_name=signal['name'] if signal else '',pednet_id=str(p.get('OBJECTID')),share=length/source_len,control=str(p.get('CROSSWALK_TYPE','')).strip())
                    if not self.g.has_edge(u,v) or length<self.g[u][v]['length']:self.g.add_edge(u,v,**attrs)
        self.reindex()
        self.g.graph['splits']={}
        self.stop_nodes={};self.stop_offsets={};self.stops={}
        with (ROOT/'data/ttc_stops.csv').open(encoding='utf-8-sig',newline='') as f:
            for s in csv.DictReader(f):
                c=(float(s['stop_lon']),float(s['stop_lat']));self.stops[s['stop_id']]=s
                try:n,offset=self.attach(self.g,c,60)
                except ValueError:continue
                self.stop_nodes[s['stop_id']]=n;self.stop_offsets[s['stop_id']]=offset

    def reindex(self):
        self.edges=list(self.g.edges)
        self.lines=[LineString([xy(u),xy(v)]) for u,v in self.edges]
        self.tree=STRtree(self.lines)
        self.edge_attrs={edge:dict(self.g.edges[edge]) for edge in self.edges}

    def project(self,point):
        p=Point(xy(point));i=int(self.tree.nearest(p));line=self.lines[i]
        q=line.interpolate(line.project(p));return self.edges[i],key(ll(q.coords[0])),p.distance(q)

    def attach(self,g,point,max_offset=100):
        edge,n,offset=self.project(point)
        if offset>max_offset:raise ValueError('That location is more than '+str(max_offset)+' metres from a mapped pedestrian path. Choose a nearby street or entrance.')
        if n not in g:
            u,v=edge;e=self.edge_attrs[edge]
            splits=g.graph['splits'].setdefault(edge,[u,v]);splits.append(n);splits.sort(key=lambda p:distance(u,p))
            index=splits.index(n);left,right=splits[index-1],splits[index+1]
            if g.has_edge(left,right):g.remove_edge(left,right)
            for endpoint in (left,right):
                length=distance(n,endpoint)
                g.add_edge(n,endpoint,**dict(e,length=length,share=e['share']*length/e['length']))
        return n,offset

    def query_graph(self,start,end):
        g=self.g.copy();g.graph['splits']={k:v[:] for k,v in self.g.graph['splits'].items()}
        a,da=self.attach(g,start);b,db=self.attach(g,end)
        return g,[a,b],[da,db]

_network=None
_network_lock=Lock()
def network():
    global _network
    with _network_lock:
        if _network is None:
            folder=ROOT/'data/out';folder.mkdir(exist_ok=True)
            cache=folder/'pedestrian-network-v3.pickle'
            sources=[Path(__file__),ROOT/'data/WAYFINDER_ALL_LOCATIONS.csv',ROOT/'data/ttc_stops.csv',ROOT/'data/sources/pedestrian-network.geojson',ROOT/'data/sources/centreline.geojson']
            stamp=[(p.stat().st_mtime_ns,p.stat().st_size) for p in sources]
            try:
                with cache.open('rb') as f:stored=pickle.load(f)
                if stored['stamp']==stamp:_network=stored['network']
            except (OSError,EOFError,pickle.UnpicklingError,AttributeError,ValueError,KeyError):pass
            if _network is None:
                _network=WalkingNetwork()
                temp=folder/(uuid4().hex+'.building')
                try:
                    with temp.open('wb') as f:pickle.dump(dict(stamp=stamp,network=_network),f,pickle.HIGHEST_PROTOCOL)
                    temp.replace(cache)
                except OSError:temp.unlink(missing_ok=True)
        return _network

def edge_cost(e,speed=1.2,audible=False,fewer=False,tactile=False):
    base=e['length']/speed
    if e['crossing']:
        base+=20*e.get('share',1)
        base+=e.get('share',1)*((120 if audible and not e['audible'] else 0)+(60 if fewer else 0)+(45 if tactile and not e.get('tactile') else 0))
    return base
def weight(speed=1.2,audible=False,fewer=False,tactile=False):return lambda u,v,e:edge_cost(e,speed,audible,fewer,tactile)

def instructions(g,path):
    groups=[]
    for u,v in zip(path,path[1:]):
        e=g[u][v];heading=bearing(u,v)
        group_key=('cross',e['pednet_id']) if e['crossing'] else ('walk',e['street'])
        if groups and groups[-1]['key']==group_key and (e['crossing'] or abs((heading-groups[-1]['heading']+180)%360-180)<35):
            groups[-1]['distance']+=e['length'];groups[-1]['end']=v;groups[-1]['path'].append(v)
        else:groups.append(dict(key=group_key,edge=e,distance=e['length'],heading=heading,start=u,end=v,path=[u,v]))
    result=[];last_heading=None
    for group in groups:
        e=group['edge'];metres=max(1,round(group['distance']));heading=group['heading'];kind='cross' if e['crossing'] else 'walk'
        if kind=='cross':
            title=f"Cross {e['street']}"+(f" at {e['signal_name']}" if e['signal_name'] else '')
            detail=f"About {metres} metres. "+('Audible signals listed at this intersection. ' if e['audible'] else 'Audible signal information unknown. ')+('Tactile paving mapped near the curb. ' if e['tactile'] else '')+'Check traffic and the pedestrian signal before crossing.'
        else:
            action=f'Head {cardinal(heading)}' if last_heading is None else turn(last_heading,heading)
            title=f"{action} {'along' if action=='Continue' or last_heading is None else 'onto'} {e['street']}"
            detail=f"Continue {metres} metres, heading {cardinal(heading)}."
        result.append(dict(kind=kind,title=title,text=title+'. '+detail,distance=metres,coordinates=list(group['start']),end_coordinates=list(group['end']),crossing=kind=='cross',bearing=round(heading),street=e['street'],control=e.get('control',''),audible=e['audible'] if kind=='cross' else None,tactile=e['tactile'] if kind=='cross' else None))
        last_heading=heading
    return result

def walk_details(g,path,speed):
    edges=[g[u][v] for u,v in zip(path,path[1:])];crossings=[];last=None
    for e in edges:
        k=e['pednet_id'] if e['crossing'] else None
        if k is not None and k!=last:crossings.append(e)
        last=k
    return dict(distance=sum(e['length'] for e in edges),duration_seconds=sum(edge_cost(e,speed) for e in edges),crossings=len(crossings),audible=sum(e['audible'] for e in crossings),tactile=sum(e['tactile'] for e in crossings),steps=instructions(g,path),coordinates=[list(n) for n in path])
