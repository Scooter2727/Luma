import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend import reports


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(reports, 'REPORT_DB', tmp_path / 'reports.sqlite')
    return TestClient(app)


BODY = dict(issue_type='signal_silent', location_name='Queen and Bay', coordinates=[-79.3819,43.6523], notes='The button produced no sound.', location_source='selected')


def test_report_is_persistent_unverified_and_can_be_deleted_with_device_key(client):
    response = client.post('/api/reports', json=BODY)
    assert response.status_code == 201
    report = response.json()
    assert report['status'] == 'unverified'
    assert report['notes'] == BODY['notes']
    assert report['created_at'] and report['delete_token']
    # A fresh client/connection reads the stored database record, not browser state.
    read = TestClient(app).get('/api/reports/' + report['id']).json()
    assert read['coordinates'] == BODY['coordinates']
    assert 'delete_token' not in read
    assert client.delete('/api/reports/' + report['id']).status_code == 403
    assert client.delete('/api/reports/' + report['id'], headers={'X-Report-Token':report['delete_token']}).status_code == 204
    assert client.get('/api/reports/' + report['id']).status_code == 404


@pytest.mark.parametrize('changes', [dict(coordinates=[0,0]),dict(issue_type='invented'),dict(location_name='  '),dict(notes='x'*2001),dict(location_source='live_signal'),dict(accuracy_metres=-1)])
def test_invalid_reports_are_rejected(client, changes):
    assert client.post('/api/reports',json=dict(BODY,**changes)).status_code == 422


def test_report_notes_are_stored_as_text_without_modifying_route_data(client):
    r=client.post('/api/reports',json=dict(BODY,notes="' ); DROP TABLE reports; -- <script>alert(1)</script>")).json()
    assert client.get('/api/reports/'+r['id']).json()['notes']==r['notes']
    assert client.post('/api/reports',json=BODY).status_code == 201
