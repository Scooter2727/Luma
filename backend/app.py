"""Luma local API: preserved research data and a bounded pedestrian routing demo."""
import csv,json,math,heapq
from pathlib import Path
from functools import lru_cache
import networkx as nx
from fastapi import FastAPI,HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel,Field

ROOT=Path(__file__).resolve().parents[1]
app=FastAPI(title='Luma',version='0.1.0')
app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],allow_methods=['GET','POST'],allow_headers=['*'])
app.add_middleware(GZipMiddleware,minimum_size=1000)
def distance(a,b):
    return math.hypot((a[0]-b[0])*111195*math.cos(math.radians((a[1]+b[1])/2)),(a[1]-b[1])*111195)
def category(row):
    c=row['category']
    if c=='crossing signal':return 'signal'
    if c=='transit stop context':return 'transit'
    if c=='library assistive equipment':return 'library'
    if 'tactile' in row['feature'] or c in ['mapped tactile paving','tactile warning','directional tactile']:return 'tactile'
    if c=='station accessibility' or c=='transit platform accessibility':return 'station'
    return 'place'
@lru_cache
def locations():
    with (ROOT/'data/WAYFINDER_ALL_LOCATIONS.csv').open(encoding='utf-8-sig',newline='') as f:
        rows=list(csv.DictReader(f))
    return [dict(r,kind=category(r)) for r in rows if r['latitude'] and r['longitude'] and r['source_status']!='planned' and 'relocated' not in r['source_status']]
@app.get('/api/health')
def health():return {'status':'ok','locations':len(locations())}
@app.get('/api/locations')
def geojson():
    keys=['id','name','kind','feature','purpose','source_url','source_status','location_precision','address_or_position','transit_routes','demo_assumption']
    return {'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'Point','coordinates':[float(r['longitude']),float(r['latitude'])]},'properties':{k:r[k] for k in keys}} for r in locations()]}
PRESETS=[{'id':'union','name':'Union Station','subtitle':'Front Street West · Downtown Toronto','coordinates':[-79.3806,43.6453]}, {'id':'city-hall','name':'Nathan Phillips Square','subtitle':'100 Queen Street West','coordinates':[-79.3832,43.6525]}, {'id':'st-lawrence','name':'St. Lawrence Market','subtitle':'93 Front Street East','coordinates':[-79.3715,43.6487]}, {'id':'ago','name':'Art Gallery of Ontario','subtitle':'317 Dundas Street West','coordinates':[-79.3925,43.6536]}, {'id':'park','name':'Berczy Park','subtitle':'35 Wellington Street East','coordinates':[-79.3754,43.6481]}]
@app.get('/api/search')
def search(q:str=''):
    q=q.strip().lower()
    if not q:return PRESETS
    result=[r for r in PRESETS if q in r['name'].lower()]
    for r in locations():
        if q in (r['name']+' '+r['address_or_position']).lower():result.append({'id':r['id'],'name':r['name'],'subtitle':r['purpose'],'coordinates':[float(r['longitude']),float(r['latitude'])]})
        if len(result)>=20:break
    return result
@lru_cache
def graph():
    data=json.loads((ROOT/'data/sources/pedestrian-network.geojson').read_text(encoding='utf-8'))
    g=nx.Graph();signals={r['id'].removeprefix('aps-'):r for r in locations() if r['kind']=='signal'}
    # Keep original Pednet connectivity; no arbitrary links across roads or inaccessible gaps.
    for f in data['features']:
        p=f['properties'];geom=f['geometry'];parts=geom['coordinates'] if geom['type']=='MultiLineString' else [geom['coordinates']]
        for line in parts:
            if not all(-79.425<=pt[0]<=-79.355 and 43.632<=pt[1]<=43.68 for pt in line):continue
            crossing=p.get('CROSSWALK')==1
            signal=signals.get(str(p.get('PX','')).strip()) if crossing else None
            for a,b in zip(line,line[1:]):
                u,v=tuple(round(c,6) for c in a),tuple(round(c,6) for c in b)
                length=distance(u,v)
                if u!=v and length>0:g.add_edge(u,v,length=length,crossing=crossing,audible=bool(signal),signal_name=signal['name'] if signal else '',pednet_id=p.get('OBJECTID'),px=str(p.get('PX','')).strip())
    return g
class RouteRequest(BaseModel):
    start:tuple[float,float]
    end:tuple[float,float]
    prefer_audible:bool=True
    fewer_crossings:bool=False
def nearest(g,point):return min(g.nodes,key=lambda n:distance(n,point))
def weight(prefer_audible,fewer_crossings):
    def cost(u,v,e):return e['length']+(65 if prefer_audible and e['crossing'] and not e['audible'] else 0)+(35 if fewer_crossings and e['crossing'] else 0)
    return cost
@app.post('/api/routes')
def route(req:RouteRequest):
    g=graph()
    if not g:raise HTTPException(503,'Pedestrian network is unavailable.')
    a,b=nearest(g,req.start),nearest(g,req.end)
    offsets=[round(distance(a,req.start)),round(distance(b,req.end))]
    if max(offsets)>180:raise HTTPException(422,'Routing currently covers downtown Toronto. Try Union Station and Nathan Phillips Square.')
    results=[]
    for name,pref,fewer in [('Your preferences',req.prefer_audible,req.fewer_crossings),('Shortest walk',False,False)]:
        try:path=nx.astar_path(g,a,b,heuristic=distance,weight=weight(pref,fewer))
        except nx.NetworkXNoPath:raise HTTPException(422,'These points are on disconnected pedestrian paths. Choose another nearby start or destination.')
        if any(r['coordinates']==[list(n) for n in path] for r in results):continue
        edges=[g[u][v] for u,v in zip(path,path[1:])];length=sum(e['length'] for e in edges)
        # Count contiguous segments with the same source crossing as a single crossing.
        crossing_edges=[];last=None
        for e in edges:
            key=e['pednet_id'] if e['crossing'] else None
            if key is not None and key!=last:crossing_edges.append(e)
            last=key
        steps=[]
        last_cross=None;accum=0
        for i,e in enumerate(edges):
            accum+=e['length']
            key=e['pednet_id'] if e['crossing'] else None
            if key is not None and key!=last_cross:
                steps.append({'text':('Cross at '+e['signal_name']+'. Audible signals are listed here.' if e['audible'] else 'Approach the mapped pedestrian crossing. Audible signal information is unknown.')+' Check traffic and the signal before crossing.','coordinates':list(path[i]),'distance':round(accum),'crossing':True})
                accum=0
            last_cross=key
        if not steps:steps.append({'text':'Follow the mapped pedestrian path toward your destination.','coordinates':list(a),'distance':round(length),'crossing':False})
        steps.append({'text':'You have reached the mapped arrival point. The exact entrance may be elsewhere.','coordinates':list(b),'distance':round(accum),'crossing':False})
        results.append({'id':str(len(results)),'name':name,'coordinates':[list(n) for n in path],'distance':round(length),'minutes':max(1,round(length/72)),'crossings':len(crossing_edges),'audible':sum(e['audible'] for e in crossing_edges),'steps':steps,'snap_distances':offsets})
    return {'routes':results,'notice':'Route preview uses source pedestrian paths and demo assumptions. Audible signals cover all directions in this prototype. This is not live crossing detection.','boundary':[-79.425,43.632,-79.355,43.68]}
