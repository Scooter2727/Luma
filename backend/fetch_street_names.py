"""One-off reproducible street-name snapshot from City of Toronto's public GIS."""
import json,urllib.parse,urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
BASE='https://gis.toronto.ca/arcgis/rest/services/cot_geospatial/MapServer/2/query'
def get(params):
    with urllib.request.urlopen(BASE+'?'+urllib.parse.urlencode(params),timeout=60) as r:return json.load(r)
if __name__=='__main__':
    ids=get({'where':'FEATURE_CODE < 204000','returnIdsOnly':'true','f':'json'})['objectIds']
    ids.sort()
    batches=[ids[i:i+1500] for i in range(0,len(ids),1500)]
    def batch(ids):return get({'where':f'OBJECTID >= {ids[0]} AND OBJECTID <= {ids[-1]} AND FEATURE_CODE < 204000','outFields':'CENTRELINE_ID,LINEAR_NAME_FULL,FEATURE_CODE','outSR':4326,'f':'geojson'})['features']
    with ThreadPoolExecutor(max_workers=4) as pool:features=[f for chunk in pool.map(batch,batches) for f in chunk]
    if len(features)!=len(ids):raise RuntimeError('City GIS returned an incomplete street snapshot; keep the existing file and retry with smaller batches.')
    out=Path(__file__).resolve().parents[1]/'data/sources/centreline.geojson'
    out.write_text(json.dumps({'type':'FeatureCollection','features':features}),encoding='utf-8')
    print('Saved',len(features),'street features',flush=True)
