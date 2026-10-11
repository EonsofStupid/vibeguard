"""Bounded MongoDB Voyage REST calls. Credentials stay on the server."""
import json
import math
import os
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

class VoyageError(RuntimeError):
    pass

def _call(endpoint, payload):
    key=os.environ.get('VOYAGE_API_KEY','')
    if not key:
        raise VoyageError('Set VOYAGE_API_KEY on the server first.')
    # Only the explicitly configured MongoDB US endpoint is used.
    base=os.environ.get('VOYAGE_BASE_URL','https://us.ai.mongodb.com/v1').rstrip('/')
    if base != 'https://us.ai.mongodb.com/v1':
        raise VoyageError('Use the US endpoint matching this project key.')
    req=Request(base+'/'+endpoint, data=json.dumps(payload).encode(), method='POST',
        headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=15) as response:
            raw=response.read(4_000_001)
            if len(raw)>4_000_000:
                raise VoyageError('Model API response exceeded the size limit.')
            return json.loads(raw)
    except HTTPError as e:
        raise VoyageError(f'Model API returned HTTP {e.code}. Check key, geography and quota.') from None
    except URLError as e:
        cause = e.reason
        if isinstance(cause, PermissionError) or getattr(cause, 'winerror', None) == 10013:
            raise VoyageError('Outbound connection blocked by Windows socket permissions (WinError 10013).') from None
        if isinstance(cause, TimeoutError):
            raise VoyageError('Model API request timed out after 15 seconds.') from None
        raise VoyageError('Model API connection failed (' + type(cause).__name__ + ').') from None
    except PermissionError:
        raise VoyageError('Outbound connection blocked by Windows socket permissions (WinError 10013).') from None
    except TimeoutError:
        raise VoyageError('Model API request timed out after 15 seconds.') from None
    except OSError as e:
        raise VoyageError('Model API connection failed (' + type(e).__name__ + ').') from None
    except (ValueError, KeyError, TypeError):
        raise VoyageError('Unexpected model API response.') from None

def health():
    data=_call('embeddings', {'input':['VibeGuard learns approved boundaries from coding failures.'],
        'model':os.environ.get('VOYAGE_MODEL','voyage-code-4'),'input_type':'document'})
    try:
        vector=data['data'][0]['embedding']
        dims=len(vector)
        if not isinstance(vector,list) or not dims or any(not isinstance(x,(int,float)) or isinstance(x,bool) or not math.isfinite(x) for x in vector):
            raise ValueError()
        return {'ok':True,'dimensions':dims,'model':data.get('model',os.environ.get('VOYAGE_MODEL','voyage-code-4'))}
    except (ValueError, KeyError, TypeError, IndexError):
        raise VoyageError('Embedding response did not contain a vector.') from None

def relevant_rules(query, approved, limit=3):
    # This retrieval helps assemble context; all active rules remain enforced by the guard.
    candidates=list(approved)[:50]
    if not candidates:
        return []
    data=_call('rerank', {'query':query[:4000], 'documents':[r.user_message for r in candidates],
        'model':'rerank-2.5','top_k':min(limit,len(candidates))})
    try:
        indices=[item['index'] for item in data['data']]
        if any(not isinstance(i,int) or i<0 or i>=len(candidates) for i in indices):
            raise ValueError()
        return [candidates[i] for i in indices[:limit]]
    except (ValueError, KeyError, TypeError):
        raise VoyageError('Invalid reranking response.') from None
