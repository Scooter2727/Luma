"""Prepare a single readable location table without duplicating derived datasets."""
import csv,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def read(name):
    with (root/name).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
locations=read('locations_and_purpose.csv')
routes={r['route_id']:r for r in read('ttc_routes.csv')}
stop_routes={}
for r in read('ttc_stop_routes.csv'):
    route=routes[r['route_id']]
    stop_routes.setdefault(r['stop_id'],set()).add(route['route_short_name']+' — '+route['route_long_name'])
assumptions={r['location_id']:r for r in read('prototype_feature_assumptions.csv')}
headers=['id','name','latitude','longitude','address_or_position','category','feature','purpose','transit_routes','source_url','source_status','location_precision','demo_assumption','notes']
matrix=[headers]
for r in locations:
    linked=set()
    for stop in r['related_stop_ids'].split('|'):linked.update(stop_routes.get(stop,set()))
    a=assumptions.get(r['location_id'],{})
    demo=''
    if a.get('assumed_operational')=='yes_for_demo':demo='Assumed working for demo'
    if a.get('assumed_crossing_direction_coverage')=='all_directions':demo+='; all crossing directions'
    if a.get('assumed_operational')=='not_assumed':demo='Retain planned or relocated status'
    matrix.append([r['location_id'],r['location_name'],float(r['latitude']) if r['latitude'] else '',float(r['longitude']) if r['longitude'] else '',r['address_or_position'],r['category'].replace('_',' '),r['features'].replace('|','; ').replace('_',' '),r['purpose'],'; '.join(sorted(linked)),r['source_url'],r['evidence_status'].replace('_',' '),r['coordinate_precision'].replace('_',' '),demo,r['notes']])
assert len({r[0] for r in matrix[1:]})==len(locations)
(root/'sources'/'consolidated-matrix.json').write_text(json.dumps(matrix),encoding='utf-8')
print(json.dumps({'location_rows':len(locations),'columns':len(headers)}))
