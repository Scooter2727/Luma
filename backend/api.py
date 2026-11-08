"""Luma API: pedestrian directions and calendar-aware TTC bus journeys."""
import csv,math,re
from functools import lru_cache
from datetime import datetime,timedelta
from typing import Literal
import networkx as nx
from fastapi import FastAPI,HTTPException,Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse,Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel,Field,field_validator
from .walking import network,distance,walk_details,weight,ROOT
from .transit import TZ,bus_journeys,feed_range
from .reports import router as reports_router
from . import config,speech_audio,speech_phrasing

app=FastAPI(title='Luma',version='0.2.0')
app.include_router(reports_router)
app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],allow_methods=['GET','POST','DELETE'],allow_headers=['*'])
app.add_middleware(GZipMiddleware,minimum_size=1000)

@app.exception_handler(RequestValidationError)
async def invalid_request(request,exc):
    # Do not echo malformed coordinate values (NaN/Infinity cannot be JSON encoded).
    message='; '.join('.'.join(str(p) for p in e['loc'] if p!='body')+': '+e['msg'] for e in exc.errors())
    prefix='Invalid speech request. ' if request.url.path.startswith('/api/speech') else 'Invalid journey request. '
    return JSONResponse(status_code=422,content={'detail':prefix+message})
def category(row):
    c=row['category']
    if c=='crossing signal':return 'signal'
    if c=='transit stop context':return 'transit'
    if c=='library assistive equipment':return 'library'
    if 'tactile' in row['feature'] or c in ['mapped tactile paving','tactile warning','directional tactile']:return 'tactile'
    if c in ['station accessibility','transit platform accessibility']:return 'station'
    return 'place'
@lru_cache(maxsize=1)
def locations():
    with (ROOT/'data/WAYFINDER_ALL_LOCATIONS.csv').open(encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
    return [dict(r,kind=category(r)) for r in rows if r['latitude'] and r['longitude'] and r['source_status']!='planned' and 'relocated' not in r['source_status']]
@app.get('/api/health')
def health():return {'status':'ok','locations':len(locations())}
@app.get('/api/current-road')
def current_road(longitude:float=Query(...,ge=-180,le=180),latitude:float=Query(...,ge=-90,le=90)):
    # Never label a distant Toronto street as the user's current road.
    if not (-79.65 <= longitude <= -79.10 and 43.55 <= latitude <= 43.90):
        return {'street':None}
    net=network()
    edge,_,offset=net.project((longitude,latitude))
    street=net.edge_attrs[edge].get('street') if offset<=30 else None
    return {'street':street or None}
@app.get('/api/locations')
def geojson():
    keys=['id','name','kind','feature','purpose','source_url','source_status','location_precision','address_or_position','transit_routes','demo_assumption']
    return {'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'Point','coordinates':[float(r['longitude']),float(r['latitude'])]},'properties':{k:r[k] for k in keys}} for r in locations()]}
PRESETS=[{'id':'union','name':'Union Station','subtitle':'Front Street West · Downtown Toronto','coordinates':[-79.3806,43.6453]}, {'id':'city-hall','name':'Nathan Phillips Square','subtitle':'100 Queen Street West','coordinates':[-79.3832,43.6525]}, {'id':'st-lawrence','name':'St. Lawrence Market','subtitle':'93 Front Street East','coordinates':[-79.3715,43.6487]}, {'id':'ago','name':'Art Gallery of Ontario','subtitle':'317 Dundas Street West','coordinates':[-79.3925,43.6536]}, {'id':'park','name':'Berczy Park','subtitle':'35 Wellington Street East','coordinates':[-79.3754,43.6481]}, {'id':'rom','name':'Royal Ontario Museum','subtitle':'100 Queens Park','coordinates':[-79.3948,43.6677]}, {'id':'distillery','name':'Distillery District','subtitle':'Mill Street and Trinity Street','coordinates':[-79.3596,43.6503]}, {'id':'queen-parliament','name':'Queen Street East & Parliament Street','subtitle':'Queen and Parliament','coordinates':[-79.3645,43.6553]}, {'id':'king-parliament','name':'King Street East & Parliament Street','subtitle':'King and Parliament','coordinates':[-79.3622,43.6522]}]
def normalize(s):return ' '.join(re.findall(r'[a-z0-9]+',s.lower())).replace('street','st').replace('avenue','ave').replace('station','stn')
@app.get('/api/search')
def search(q:str=Query('',max_length=200)):
    query=normalize(q)
    if not query:return PRESETS
    tokens=query.split();ranked=[];seen=set()
    for priority,r in [(0,p) for p in PRESETS]+[(1,dict(id=r['id'],name=r['name'],subtitle=r['address_or_position'] or r['purpose'],coordinates=[float(r['longitude']),float(r['latitude'])])) for r in locations() if r['kind']!='tactile']:
        name=normalize(r['name']);alltext=name+' '+normalize(r['subtitle'])
        if not all(t in alltext for t in tokens):continue
        score=(0 if name==query else 1 if name.startswith(query) else 2,priority,len(name));identity=(name,round(r['coordinates'][0],4),round(r['coordinates'][1],4))
        if identity in seen:continue
        seen.add(identity);ranked.append((score,r))
    return [r for _,r in sorted(ranked,key=lambda pair:pair[0])[:15]]

class RouteRequest(BaseModel):
    start:tuple[float,float]
    end:tuple[float,float]
    start_name:str=Field('Starting point',max_length=200)
    end_name:str=Field('Destination',max_length=200)
    prefer_audible:bool=False
    fewer_crossings:bool=False
    prefer_tactile:bool=False
    walking_speed:float=Field(1.2,ge=.5,le=2)
    mode:Literal['walk','bus']='walk'
    departure_time:datetime|None=None
    directions:Literal['clock','left-right','both']='left-right'
    @field_validator('start','end')
    @classmethod
    def coordinate(cls,c):
        if not all(math.isfinite(n) for n in c) or not (-79.8<c[0]<-79 and 43.5<c[1]<44):raise ValueError('Choose a location in Toronto.')
        return c

def departure(req):
    t=req.departure_time or datetime.now(TZ)
    return t.replace(tzinfo=TZ) if t.tzinfo is None else t.astimezone(TZ)
def finish_walk(g,path,req,depart,offsets,name,route_id):
    r=walk_details(g,path,req.walking_speed);r['duration_seconds']+=sum(offsets)/req.walking_speed;r['distance']+=sum(offsets)
    r['duration_seconds']=math.ceil(r['duration_seconds'])
    if offsets[0]>8:r['steps'].insert(0,dict(kind='connect',title='Join the mapped pedestrian path',text=f'Join the mapped pedestrian path. From {req.start_name}, join the pedestrian path approximately {round(offsets[0])} metres away. The approach is not mapped; confirm the connection on site.',distance=round(offsets[0]),coordinates=list(req.start),end_coordinates=list(path[0]),crossing=False))
    if offsets[1]>8:r['steps'].append(dict(kind='connect',title=f'Approach {req.end_name}',text=f'Approach {req.end_name}. The mapped path ends approximately {round(offsets[1])} metres from {req.end_name}. Locate the entrance; this approach is not mapped.',distance=round(offsets[1]),coordinates=list(path[-1]),end_coordinates=list(req.end),crossing=False))
    r['steps'].append(dict(kind='arrive',title=f'Arrive near {req.end_name}',text=f'Arrive near {req.end_name}. Confirm the entrance and final approach.',distance=0,coordinates=list(req.end),crossing=False))
    segments=[dict(mode='walk',coordinates=r['coordinates'])] if len(path)>1 else []
    if offsets[0]>1:segments.insert(0,dict(mode='connect',coordinates=[list(req.start),list(path[0])]))
    if offsets[1]>1:segments.append(dict(mode='connect',coordinates=[list(path[-1]),list(req.end)]))
    r.update(id=route_id,name=name,mode='walk',minutes=max(1,math.ceil(r['duration_seconds']/60)),distance=round(r['distance']),duration_seconds=math.ceil(r['duration_seconds']),departure_time=depart.isoformat(),arrival_time=datetime.fromtimestamp(depart.timestamp()+r['duration_seconds'],TZ).isoformat(),timing='estimated',snap_distances=[round(n) for n in offsets],segments=segments,coordinates=[list(req.start)]+r['coordinates']+[list(req.end)])
    return r
SPEECH_UNAVAILABLE='AI voice is unavailable on this server. Luma uses the device voice instead.'
class SpeechRequest(BaseModel):
    text:str=Field(min_length=1,max_length=1000)
    @field_validator('text')
    @classmethod
    def nonempty_text(cls,value):
        if not value.strip():raise ValueError('Enter text to speak.')
        return value.strip()
@app.get('/api/speech/status')
def speech_status():return {'available':config.speech_configured()}
@app.post('/api/speech/synthesize')
async def synthesize_speech(req:SpeechRequest):
    if not config.speech_configured():raise HTTPException(503,SPEECH_UNAVAILABLE)
    audio=await speech_audio.synthesize(req.text)
    if audio is None:raise HTTPException(503,'AI voice could not be generated. Luma uses the device voice instead.')
    return Response(audio,media_type='audio/mpeg',headers={'Cache-Control':'private, max-age=86400'})
@app.get('/api/transit/meta')
def transit_meta():return {'service_start':feed_range()[0],'service_end':feed_range()[1],'timing':'scheduled','timezone':'America/Toronto','max_bus_transfers':1,'max_access_walk_metres':1000}
def number_text(n):return str(int(n)) if float(n).is_integer() else str(n)
def instruction_text(step,previous,style):
    """Mirror of web/src/model.ts instructionText(): the sentence the browser would speak."""
    if style=='left-right' or step.get('kind')!='walk' or step.get('bearing') is None or previous is None or previous.get('bearing') is None:return step['text']
    delta=(step['bearing']-previous['bearing']+360)%360
    clock=math.floor(delta/30+.5)%12 or 12
    phrase=f"Toward {clock} o'clock, along {step.get('street') or 'the pedestrian path'}. Continue {number_text(step['distance'])} metres."
    return step['text']+' '+phrase if style=='both' else phrase
def add_spoken_text(routes,style):
    """Every step gets ai_text: the sentence to speak in the chosen directions style. The browser may later replace it via /api/speech/rephrase."""
    for r in routes:
        r['ai_directions']=style
        for i,s in enumerate(r['steps']):s['ai_text']=instruction_text(s,r['steps'][i-1] if i else None,style)
class RephraseStep(BaseModel):
    text:str=Field(min_length=1,max_length=1000)
    street:str|None=Field(None,max_length=200)
    distance:float|None=None
    crossing:bool=False
    audible:bool|None=None
    tactile:bool|None=None
class RephraseRequest(BaseModel):
    steps:list[RephraseStep]=Field(min_length=1,max_length=80)
@app.post('/api/speech/rephrase')
async def rephrase(req:RephraseRequest):
    """Natural spoken phrasing for one route. Unconfigured or failed rephrasing returns the original text."""
    steps=[s.model_dump() for s in req.steps]
    texts=await speech_phrasing.rephrase_steps(steps) if config.speech_configured() else [s['text'] for s in steps]
    return {'texts':texts,'rephrased':[a!=s['text'] for a,s in zip(texts,steps)]}
@app.post('/api/routes')
def route(req:RouteRequest):
    response=plan_routes(req)
    add_spoken_text(response['routes'],req.directions)
    return response
def plan_routes(req:RouteRequest):
    if distance(req.start,req.end)<5:raise HTTPException(422,'Start and destination are the same. Choose two different locations.')
    depart=departure(req);net=network()
    try:g,(a,b),offsets=net.query_graph(req.start,req.end)
    except ValueError as e:raise HTTPException(422,str(e))
    prefs=dict(audible=req.prefer_audible,fewer=req.fewer_crossings,tactile=req.prefer_tactile);preferred=any(prefs.values())
    if req.mode=='bus':
        try:results=bus_journeys(net,g,(a,b),req.start,req.end,depart,req.walking_speed,prefs)
        except ValueError as e:raise HTTPException(422,str(e))
        if not results:raise HTTPException(422,'No scheduled bus journey found within 3 hours, with up to one same-stop transfer and walks of up to 1 km at either end. Try another departure time or walking mode.')
        for i,r in enumerate(results):
            r['id']=str(i);r['name']=('Preferred bus journey' if preferred else 'Earliest bus arrival') if i==0 else 'Bus alternative'
            r['steps'].append(dict(kind='arrive',title=f'Arrive near {req.end_name}',text=f'Arrive near {req.end_name}. Confirm the entrance.',distance=0,coordinates=list(req.end),crossing=False))
            r['explanation']='Includes walking, waiting, and a 60-second boarding or transfer buffer.'+(' Your crossing preferences apply to both walking legs.' if preferred else ' Earliest scheduled arrival for this bus option.')
        # Give users useful context when walking is quicker than waiting for a bus.
        try:
            path=nx.astar_path(g,a,b,heuristic=lambda x,y:distance(x,y)/req.walking_speed,weight=weight(req.walking_speed,**prefs))
            walk=finish_walk(g,path,req,depart,offsets,'Walking alternative',str(len(results)))
            walk['explanation']='Walk the whole journey with your crossing preferences.' if preferred else 'Walk the whole journey without waiting for a bus.'
            results.append(walk)
        except nx.NetworkXNoPath:pass
    else:
        try:
            fastest=nx.astar_path(g,a,b,heuristic=lambda x,y:distance(x,y)/req.walking_speed,weight=weight(req.walking_speed))
            selected=nx.astar_path(g,a,b,heuristic=lambda x,y:distance(x,y)/req.walking_speed,weight=weight(req.walking_speed,**prefs)) if preferred else fastest
        except nx.NetworkXNoPath:raise HTTPException(422,'No connected pedestrian route between these locations in the source network. Try a nearby entrance or intersection.')
        results=[finish_walk(g,selected,req,depart,offsets,'Accessibility preferences' if preferred else 'Fastest walk','0')]
        if selected!=fastest:results.append(finish_walk(g,fastest,req,depart,offsets,'Fastest walk','1'))
        baseline=walk_details(g,fastest,req.walking_speed)
        for r in results:
            r['extra_minutes']=max(0,math.ceil((r['duration_seconds']-math.ceil(baseline['duration_seconds']+sum(offsets)/req.walking_speed))/60))
            r['explanation']=('Prioritizes '+', '.join(label for enabled,label in [(req.prefer_audible,'listed audible signals'),(req.fewer_crossings,'fewer crossings'),(req.prefer_tactile,'mapped tactile paving')] if enabled)+'. '+('The fastest path already meets this preference balance.' if selected==fastest else f"Adds about {r['extra_minutes']} minutes compared with the fastest walk.")) if preferred and r['id']=='0' else 'Shortest estimated walking time, including a 20-second allowance per mapped crossing.'
    return {'routes':results,'notice':'Accessibility routes prioritize documented features; they are not a guarantee of safety. Listed audible signals are assumed to cover all directions for this prototype.','preferences_applied':preferred,'timezone':'America/Toronto'}
