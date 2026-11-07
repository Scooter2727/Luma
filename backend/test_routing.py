from fastapi.testclient import TestClient
from backend.app import app,weight
client=TestClient(app)
def test_data_and_search():
    assert client.get('/api/health').json()['locations']>16000
    assert any(r['name']=='Union Station' for r in client.get('/api/search?q=Union').json())
def test_preferences_penalize_only_relevant_edges():
    plain={'length':10,'crossing':False,'audible':False}
    unknown={'length':10,'crossing':True,'audible':False}
    audible={'length':10,'crossing':True,'audible':True}
    assert weight(True,False)(0,1,plain)==10
    assert weight(True,False)(0,1,unknown)>weight(True,False)(0,1,audible)
def test_real_route():
    response=client.post('/api/routes',json={'start':[-79.3806,43.6453],'end':[-79.3832,43.6525]})
    assert response.status_code==200,response.text
    route=response.json()['routes'][0]
    assert route['distance']>700
    assert route['crossings']>=route['audible']
    assert len(route['coordinates'])>10
def test_outside_boundary():
    assert client.post('/api/routes',json={'start':[-80,44],'end':[-79.38,43.65]}).status_code==422
