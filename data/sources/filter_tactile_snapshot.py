import json,struct,zipfile,math,collections
from pathlib import Path
root=Path(__file__).resolve().parent
with zipfile.ZipFile(root/'toronto-boundary.zip') as z:
    b=z.read('citygcs_regional_mun_wgs84.shp')
assert struct.unpack_from('<i',b,32)[0]==5
polygons=[]; offset=100
while offset<len(b):
    length=struct.unpack_from('>i',b,offset+4)[0]*2
    rec=b[offset+8:offset+8+length];offset+=8+length
    if struct.unpack_from('<i',rec)[0]==0:continue
    assert struct.unpack_from('<i',rec)[0]==5
    nparts,npoints=struct.unpack_from('<2i',rec,36)
    starts=list(struct.unpack_from('<'+str(nparts)+'i',rec,44))+[npoints]
    points=[struct.unpack_from('<2d',rec,44+4*nparts+16*i) for i in range(npoints)]
    polygons.append([points[starts[i]:starts[i+1]] for i in range(nparts)])
def ring_contains(x,y,ring):
    inside=False
    for (x1,y1),(x2,y2) in zip(ring,ring[1:]+ring[:1]):
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1:inside=not inside
    return inside
def contains(x,y):return any(sum(ring_contains(x,y,r) for r in poly)%2 for poly in polygons)
assert contains(-79.38,43.65)
assert not contains(-79.7,43.65)
assert not contains(-79.4,43.95)
source=json.loads((root/'osm-tactile-snapshot.json').read_text())
aps=json.loads((root/'accessible-signals.json').read_text())['features']
signals=[(f['geometry']['x'],f['geometry']['y'],' / '.join(f['attributes'][k] for k in ['MAIN_STREET','SIDE1_STREET','SIDE2_STREET'] if f['attributes'][k])) for f in aps]
rows=[];seen=set()
for r in source['records']:
    x,y=float(r['longitude']),float(r['latitude'])
    if not contains(x,y):continue
    key=(str(r['properties'].get('osm_id')),r['geometry_wkb'])
    if key in seen:continue
    seen.add(key)
    nearest=min(signals,key=lambda p:((x-p[0])*math.cos(math.radians(y)))**2+(y-p[1])**2)
    distance=111195*math.sqrt(((x-nearest[0])*math.cos(math.radians(y)))**2+(y-nearest[1])**2)
    r['geographic_scope']='within City of Toronto published WGS84 boundary'
    r['nearest_signal_name']=nearest[2];r['nearest_signal_distance_m']=round(distance)
    rows.append(r)
result={'source_url':source['source_url'],'snapshot_year':2025,'bounding_box_candidates':len(source['records']),'toronto_records':len(rows),'records':rows}
(root/'osm-tactile-toronto.json').write_text(json.dumps(result),encoding='utf-8')
print(json.dumps({'toronto_records':len(rows),'outside_boundary':len(source['records'])-len(rows),'tags':dict(collections.Counter(r['properties'].get('tactile_paving') for r in rows))}))
