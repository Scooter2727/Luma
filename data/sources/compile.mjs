import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire('C:/Users/scott/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { Workbook } = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const wb=Workbook.create();
const raw=JSON.parse(await fs.readFile('data/sources/accessible-signals.json','utf8'));
if(raw.error || raw.exceededTransferLimit) throw Error('Incomplete source download');
const source='https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/MapServer/4';
const tactile='https://www.toronto.ca/services-payments/streets-parking-transportation/sidewalk-tours-wayfinding/accessible-streets/tactile-walking-surface-indicators/';
const downloaded=(await fs.stat('data/sources/accessible-signals.json')).mtime.toISOString();
const headers=['record_id','accommodation_type','location_name','main_street','side1_street','side2_street','latitude','longitude','coordinate_reference_system','location_precision','source_signal_px','aps_operation','audible_ped_signal_source_value','tactile_surface_status','evidence_status','current_operational_status','source_observation_period','retrieved_at_utc','source_name','source_url','notes'];
const rows=raw.features.map(({attributes:a,geometry:g})=>[
 'toronto-aps-'+a.PX,'accessible_pedestrian_signal',[a.MAIN_STREET,a.SIDE1_STREET,a.SIDE2_STREET].filter(Boolean).join(' / '),a.MAIN_STREET??'',a.SIDE1_STREET??'',a.SIDE2_STREET??'',g.y,g.x,'EPSG:4326','signal/intersection location; not individual pushbutton',String(a.PX),a.APS_OPERATION??'',a.AUDIBLEPEDSIGNAL,'unknown','city_inventory_record','not_field_verified','',downloaded,'City of Toronto - Accessible Signal',source,[a.MIDBLOCK_ROUTE,a.PRIVATE_ACCESS,a.ADDITIONAL_INFO,'No crossing-specific coverage or live fault status established; tactile paving is not inferred.'].filter(Boolean).join('; ')
]).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}));
rows.push(['toronto-twsi-shuter-victoria-pilot','tactile_walking_surface_indicator','Shuter Street / Victoria Street','SHUTER ST','VICTORIA ST','','','','','intersection; four corners described, exact coordinates not supplied','','','','historically_documented','city_historical_pilot_report','unknown','2012-11 to 2013-07',downloaded,'City of Toronto - Tactile Walking Surface Indicators',tactile,'City describes four products installed at four corners for a pilot. Historical evidence only; present-day condition and retention not verified.']);
const ids=new Set();
for(const row of rows){if(ids.has(row[0]))throw Error('Duplicate record ID');ids.add(row[0]);if(row[1]==='accessible_pedestrian_signal'&&!(row[6]>43&&row[6]<45&&row[7]>-80&&row[7]<-78))throw Error('Invalid Toronto coordinate');}
const sheet=wb.worksheets.add('Locations');
sheet.getRange(`A1:U${rows.length+1}`).values=[headers,...rows];
const values=sheet.getRange(`A1:U${rows.length+1}`).values;
const escape=value=>'"'+String(value??'').replaceAll('"','""')+'"';
await fs.writeFile('data/toronto_visual_accessibility.csv','\ufeff'+values.map(row=>row.map(escape).join(',')).join('\r\n')+'\r\n','utf8');
console.log(JSON.stringify({total_records:rows.length,accessible_signals:raw.features.length,historical_tactile_locations:1,unique_ids:ids.size,coordinate_checks:'passed',output:'data/toronto_visual_accessibility.csv'}));
