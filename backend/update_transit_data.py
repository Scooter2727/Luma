"""Refresh the two official static TTC archives before restarting/redeploying.

Run: python -m backend.update_transit_data
Subsequent runs use HTTP validators; partial downloads never replace a good feed.
"""
import json
from pathlib import Path
from uuid import uuid4
import zipfile
import httpx
from .runtime import ROOT, cache_directory

FEEDS = {
    'ttc-surface-gtfs.zip': 'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/bd4809dd-e289-4de8-bbde-c5c00dafbf4f/resource/28514055-d011-4ed7-8bb0-97961dfe2b66/download/surfacegtfs.zip',
    'ttc-gtfs.zip': 'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/7795b45e-e65a-4465-81fc-c36b9dfff169/resource/cfb6b2b8-6191-41e3-bda1-b175c51148cb/download/opendata_ttc_schedules.zip',
}


def refresh():
    metadata_path = cache_directory() / 'ttc-download-validators.json'
    try:
        metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        metadata = {}
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        for name, url in FEEDS.items():
            target = ROOT / 'data/sources' / name
            old = metadata.get(name, {}) if target.exists() else {}
            headers = {}
            if old.get('etag'):headers['If-None-Match'] = old['etag']
            if old.get('modified'):headers['If-Modified-Since'] = old['modified']
            temporary = target.with_name(uuid4().hex + '.building')
            try:
                with client.stream('GET', url, headers=headers) as response:
                    if response.status_code == 304:
                        print(name + ': unchanged')
                        continue
                    response.raise_for_status()
                    with temporary.open('wb') as out:
                        count = 0
                        for chunk in response.iter_bytes():
                            count += len(chunk)
                            if count > 200_000_000:raise ValueError('Unexpectedly large TTC archive')
                            out.write(chunk)
                    validators = dict(etag=response.headers.get('etag'), modified=response.headers.get('last-modified'))
                with zipfile.ZipFile(temporary) as archive:
                    required = {'routes.txt','trips.txt','stops.txt','stop_times.txt','calendar.txt','calendar_dates.txt','shapes.txt'}
                    if not required.issubset(archive.namelist()) or archive.testzip() is not None:
                        raise ValueError('Invalid TTC static feed')
                temporary.replace(target)
                metadata[name] = validators
                print(name + ': updated')
            finally:
                temporary.unlink(missing_ok=True)
    metadata_path.write_text(json.dumps(metadata), encoding='utf-8')
    print('Restart the API (or redeploy) to use the updated indexed schedules and stop mappings.')


if __name__ == '__main__':
    refresh()
