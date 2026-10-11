"""Verify checkpoint 1 through the running app, never through an alternate transport."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request(url, data=None, headers=None):
    req=Request(url, data=data, headers=headers or {})
    try:
        with urlopen(req,timeout=25) as response:
            return response.status,response.read(1_000_001)
    except HTTPError as e:
        return e.code,e.read(1_000_001)


def verify(port=8765):
    base=f'http://127.0.0.1:{port}'
    report={'checkpoint':1,'at':datetime.now(timezone.utc).isoformat(),
            'app_url':base,'passed':False,'transport':'running workbench API'}
    try:
        code,body=request(base+'/api/state')
        report['state_http_status']=code
        if code!=200:
            report['error']='Workbench state could not be read.'
            return report
        state=json.loads(body)
        report['storage']=state['storage']
        code,page=request(base)
        if code!=200:
            report['error']='Workbench page could not be read.'
            return report
        token=re.search(r'name="vibeguard-csrf" content="([^"]+)"',page.decode()).group(1)
        code,raw=request(base+'/api/voyage/check',data=b'{}',headers={
            'Origin':base,'X-VibeGuard-CSRF':token,'Content-Type':'application/json'})
        result=json.loads(raw)
        report['voyage_http_status']=code
        if code==200 and result.get('ok') is True and type(result.get('dimensions')) is int and result['dimensions']>0:
            report.update(passed=True,model=result['model'],dimensions=result['dimensions'])
        else:
            report['error']=result.get('error','Embedding response was not valid.')
    except (URLError,OSError,ValueError,KeyError,AttributeError) as e:
        report['error']='Workbench verification failed ('+type(e).__name__+').'
    return report


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8765)
    args=parser.parse_args()
    report=verify(args.port)
    target=Path(__file__).resolve().parents[1]/'artifacts'/'checkpoint-1.json'
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(json.dumps(report,indent=2))
    raise SystemExit(0 if report['passed'] else 1)

if __name__=='__main__': main()
