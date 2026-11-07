"""Stream a public OSM-derived snapshot and retain a Toronto-area bounding box."""
import csv, io, json, urllib.request
from pathlib import Path
url='https://huggingface.co/datasets/EmbedEarth/tactile-paving/resolve/main/data.csv?download=true'
rows=[]
count=0
with urllib.request.urlopen(url, timeout=60) as response:
    for r in csv.DictReader(io.TextIOWrapper(response, encoding='utf-8-sig', newline='')):
        count+=1
        lat,lon=float(r['latitude']),float(r['longitude'])
        if 43.58<=lat<=43.86 and -79.64<=lon<=-79.11:
            r['properties']=json.loads(r['properties'])
            r['geographic_scope']='Toronto-area bounding box; municipal membership unverified'
            r['core_toronto_bbox']=43.60<=lat<=43.73 and -79.50<=lon<=-79.20
            rows.append(r)
        if count%100000==0:print(json.dumps({'scanned':count,'area_candidates':len(rows)}),flush=True)
out=Path(__file__).resolve().parent/'osm-tactile-snapshot.json'
out.write_text(json.dumps({'source_url':url,'source_snapshot_year':2025,'scanned_records':count,'records':rows}),encoding='utf-8')
print(json.dumps({'scanned':count,'area_candidates':len(rows),'core_records':sum(r['core_toronto_bbox'] for r in rows)}),flush=True)
