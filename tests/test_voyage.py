import io,json
from urllib.error import URLError
import pytest
from vibeguard.context import voyage

class Response(io.BytesIO):
    pass

def test_health_uses_endpoint_supported_code_model(monkeypatch):
    monkeypatch.setenv('VOYAGE_API_KEY','test-only')
    monkeypatch.delenv('VOYAGE_MODEL',raising=False)
    def transport(request,timeout):
        assert request.full_url=='https://us.ai.mongodb.com/v1/embeddings'
        assert json.loads(request.data)['model']=='voyage-code-4'
        assert timeout==15
        return Response(json.dumps({'model':'voyage-code-4','data':[{'embedding':[.1,.2]}]}).encode())
    monkeypatch.setattr(voyage,'urlopen',transport)
    assert voyage.health()=={'ok':True,'dimensions':2,'model':'voyage-code-4'}

def test_socket_denial_is_not_reported_as_timeout(monkeypatch):
    monkeypatch.setenv('VOYAGE_API_KEY','test-only')
    def denied(*a,**kw): raise URLError(PermissionError('socket denied'))
    monkeypatch.setattr(voyage,'urlopen',denied)
    with pytest.raises(voyage.VoyageError,match='Windows socket permissions'):
        voyage.health()

@pytest.mark.parametrize('vector',['wrong',[float('nan')],[True],[],[None]])
def test_malformed_embedding_cannot_be_success(monkeypatch,vector):
    monkeypatch.setattr(voyage,'_call',lambda *a:{'data':[{'embedding':vector}]})
    with pytest.raises(voyage.VoyageError): voyage.health()
