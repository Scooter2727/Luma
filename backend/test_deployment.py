from uuid import uuid4
from fastapi.testclient import TestClient
from backend.app import app
from backend import runtime,reports


def test_vercel_cache_uses_temporary_directory(monkeypatch,tmp_path):
    monkeypatch.setenv('VERCEL','1')
    monkeypatch.delenv('LUMA_CACHE_DIR',raising=False)
    monkeypatch.setattr(runtime.tempfile,'gettempdir',lambda:str(tmp_path))
    assert runtime.cache_directory()==tmp_path/'luma-cache'
    assert runtime.cache_directory().is_dir()


def test_cache_can_be_overridden_without_changing_source_paths(monkeypatch,tmp_path):
    monkeypatch.setenv('LUMA_CACHE_DIR',str(tmp_path/'cache'))
    assert runtime.cache_directory()==tmp_path/'cache'
    assert (runtime.ROOT/'data/WAYFINDER_ALL_LOCATIONS.csv').is_file()


def test_hosted_reports_never_write_ephemeral_records(monkeypatch,tmp_path):
    monkeypatch.setenv('VERCEL','1')
    target=tmp_path/'must-not-exist.sqlite'
    monkeypatch.setattr(reports,'REPORT_DB',target)
    client=TestClient(app)
    assert client.get('/api/reports/status').json()['enabled'] is False
    response=client.post('/api/reports',json={'issue_type':'signal_silent','location_name':'Union Station','coordinates':[-79.3806,43.6453]})
    assert response.status_code==503
    assert 'disabled' in response.json()['detail']
    assert client.get('/api/reports/'+str(uuid4())).status_code==503
    assert client.delete('/api/reports/'+str(uuid4())).status_code==503
    assert not target.exists()


def test_local_reports_stay_enabled(monkeypatch):
    monkeypatch.delenv('VERCEL',raising=False)
    assert TestClient(app).get('/api/reports/status').json()=={'enabled':True,'reason':None}
