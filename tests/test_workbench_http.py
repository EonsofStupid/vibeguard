import json
from threading import Thread
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import pytest
from http.server import ThreadingHTTPServer
from vibeguard.web.server import Workbench, Handler

@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.delenv('MONGODB_URI', raising=False)
    app=Workbench(tmp_path)
    http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    http.app=app
    thread=Thread(target=http.serve_forever,daemon=True);thread.start()
    yield http, app, tmp_path
    http.shutdown();http.server_close();thread.join()

def request(server, route, body=None, csrf=True, origin=True):
    http,app,_=server
    base=f'http://127.0.0.1:{http.server_port}'
    headers={}
    if csrf: headers['X-VibeGuard-CSRF']=app.csrf
    if origin: headers['Origin']=base
    if body is not None: headers['Content-Type']='application/json'
    req=Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
        with urlopen(req, timeout=5) as r: return r.status, r.read()
    except HTTPError as e: return e.code,e.read()

def test_eval_persists_across_workbench_restart(server):
    status,raw=request(server,'/api/run',{})
    assert status==200
    first=json.loads(raw)
    assert first['heldout']['passed']==1 and first['proposed']
    restored=Workbench(server[2]).state()
    assert restored['runs'][0]['run_id']==first['run_id']
    assert restored['rules'][0]['status']=='proposed'

def test_external_or_missing_confirmation_cannot_mutate(server):
    assert request(server,'/api/run',{},csrf=False)[0]==403
    assert request(server,'/api/run',{},origin=False)[0]==403
    assert server[1].state()['runs']==[]

def test_oversized_draft_returns_reviewable_error(server):
    status,raw=request(server,'/api/check',{'draft':'x'*33000,'prompt':'Build'})
    assert status==400 and 'Shorten' in json.loads(raw)['error']

def test_page_serves_only_config_token_not_model_credentials(server,monkeypatch):
    monkeypatch.setenv('VOYAGE_API_KEY','test-secret-never-send-to-browser')
    status,raw=request(server,'/')
    assert status==200 and server[1].csrf.encode() in raw
    _,state=request(server,'/api/state')
    assert b'test-secret-never-send-to-browser' not in raw+state


def test_upstream_permission_failure_is_503_not_success(server,monkeypatch):
    from urllib.error import URLError
    from vibeguard.context import voyage
    monkeypatch.setenv('VOYAGE_API_KEY','test-only')
    def blocked(*args,**kwargs): raise URLError(PermissionError('socket denied'))
    monkeypatch.setattr(voyage,'urlopen',blocked)
    status,raw=request(server,'/api/voyage/check',{})
    assert status==503
    assert 'Windows socket permissions' in json.loads(raw)['error']


def test_voyage_result_survives_refresh_but_not_restart(server,monkeypatch):
    from vibeguard.context import voyage
    monkeypatch.setattr(voyage,'health',lambda:{'ok':True,'model':'test-model','dimensions':2})
    status,_=request(server,'/api/voyage/check',{})
    assert status==200
    _,raw=request(server,'/api/state')
    check=json.loads(raw)['voyage_check']
    assert check['status']=='passed' and check['model']=='test-model'
    assert check['checked_at']
    assert Workbench(server[2]).state()['voyage_check']['status']=='untested'

def test_failed_voyage_check_remains_failed_after_refresh(server,monkeypatch):
    from vibeguard.context import voyage
    def failed(): raise voyage.VoyageError('Model API request timed out after 15 seconds.')
    monkeypatch.setattr(voyage,'health',failed)
    assert request(server,'/api/voyage/check',{})[0]==503
    _,raw=request(server,'/api/state')
    check=json.loads(raw)['voyage_check']
    assert check['status']=='failed' and 'timed out' in check['error']
