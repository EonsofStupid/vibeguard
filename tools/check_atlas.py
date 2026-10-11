"""Bounded Atlas ping and durable write/read proof. Never prints credentials."""
from datetime import datetime, timezone
import json
from pathlib import Path
from pydantic import BaseModel
from vibeguard.web.server import load_env
from vibeguard.storage.atlas import AtlasStore

ROOT = Path(__file__).resolve().parents[1]

class ProbeRecord(BaseModel):
    kind: str = 'setup_probe'
    checked_at: str
    purpose: str = 'Verify the configured Atlas database can persist and retrieve a VibeGuard record.'

def main():
    load_env(ROOT)
    import os
    report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'uri_configured': bool(os.environ.get('MONGODB_URI')), 'ping': False, 'write_read': False, 'passed': False}
    store = None
    try:
        if not report['uri_configured']:
            raise ValueError('MONGODB_URI is missing')
        store = AtlasStore.from_env()
        report['ping'] = True
        record = ProbeRecord(checked_at=report['checked_at'])
        record_id = 'system-atlas-connectivity'
        store.write('facts', record_id, record, body='Setup connectivity evidence; not a user preference or approved rule.')
        retrieved = store.read('facts', record_id, ProbeRecord)
        report['write_read'] = retrieved == record
        if not report['write_read']:
            raise ValueError('Read-back mismatch')
        store.append_log('audit', {'event': 'atlas_connectivity_check', 'record_id': record_id, 'checked_at': report['checked_at'], 'source': 'explicit_user_setup_request'})
        report['audit_receipt'] = True
        report['database'] = os.environ.get('MONGODB_DATABASE', 'vibeguard')
        report['passed'] = True
    except Exception as error:
        report['error_type'] = type(error).__name__
        # Classify without emitting driver exception strings that may include credentials.
        detail = str(error).lower()
        if any(marker in detail for marker in ('10013', 'eacces', 'permission denied', 'forbidden by its access permissions')):
            report['error'] = 'Outbound database access denied by this process environment.'
        elif any(marker in detail for marker in ('resolution lifetime expired', 'dns operation timed out', 'dns query name does not exist')):
            report['failure_stage'] = 'dns_resolution'
            report['error'] = 'Atlas hostname discovery failed before database authentication. Check DNS/network access in the process environment.'
        elif getattr(error, 'code', None) == 18 or 'authentication failed' in detail:
            report['error'] = 'Atlas rejected the database credentials.'
        elif not report['uri_configured']:
            report['error'] = 'MONGODB_URI is missing from the root .env.'
        else:
            report['error'] = 'Atlas did not complete the bounded connection or record check. Check URI, network access and runtime logs locally.'
    finally:
        if store is not None:
            store.close()
    target = ROOT / 'artifacts' / 'atlas-checkpoint.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['passed'] else 1)

if __name__ == '__main__':
    main()
