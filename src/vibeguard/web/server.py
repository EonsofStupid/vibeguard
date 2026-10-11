"""Loopback-only hackathon workbench, backed by the actual harness."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import RLock
from uuid import uuid4

from vibeguard.context.voyage import VoyageError
from vibeguard.context.schema import VoyageCheck
from vibeguard.costar import score_prompt, side_conversation
from vibeguard.costar.check import missing
from vibeguard.evals import load_tasks
from vibeguard.loop import run_once
from vibeguard.loop.run import RunResult
from vibeguard.loop.guard import first_violation
from vibeguard.loop.promotion import check_promotion
from vibeguard.rules import RuleGate, RuleStatus, GateError
from vibeguard.storage import FlatFileStore

STATIC = Path(__file__).parent / 'static'

def load_env(root):
    env = root / '.env'
    if env.exists():
        for line in env.read_text(encoding='utf8').splitlines():
            if line.strip() and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

class Workbench:
    def __init__(self, root: Path):
        load_env(root)
        self.tasks = load_tasks()
        dataset = Path(__file__).parents[1] / 'evals' / 'tasks.yaml'
        self.dataset_hash = hashlib.sha256(dataset.read_bytes()).hexdigest()
        self.storage = 'Local files'
        self.voyage_check = VoyageCheck()
        self.lock = RLock()
        self.csrf = secrets.token_urlsafe(32)
        uri = os.environ.get('MONGODB_URI', '')
        if uri:
            from vibeguard.storage.atlas import AtlasStore
            # An explicit Atlas configuration fails startup instead of falling back to local files.
            self.store = AtlasStore(uri, os.environ.get('MONGODB_DATABASE', 'vibeguard'))
            self.storage = 'MongoDB Atlas'
        else:
            self.store = FlatFileStore(root / '.runtime' / 'wiki')
        self.gate = RuleGate(self.store)

    def state(self):
        rules = self.gate.all()
        runs = sorted(self.store.list('runs', RunResult), key=lambda r: r.at)
        previews = {r.rule_id: check_promotion(r, self.tasks, self.gate.approved()).model_dump()
                    for r in rules if r.status == RuleStatus.proposed}
        return {'storage': self.storage, 'atlas_configured': self.storage == 'MongoDB Atlas',
            'voyage_configured': bool(os.environ.get('VOYAGE_API_KEY')),
            'voyage_check': self.voyage_check.model_dump(mode='json'),
            'mode': 'Recorded replay', 'dataset_hash': self.dataset_hash,
            'rules': [r.model_dump(mode='json') for r in rules],
            'runs': [r.model_dump(mode='json') for r in runs], 'previews': previews,
            'tasks': [{'task_id': t.task_id, 'split': t.split.value, 'prompt': t.prompt,
                'draft': t.candidates[0] if t.candidates else ''} for t in self.tasks]}

    def action(self, route, payload):
        if route == '/api/run':
            r = run_once('run_' + uuid4().hex[:12], self.tasks, self.store)
            self.store.append_log('audit', {'event': 'eval', 'run_id': r.run_id,
                'dataset_hash': self.dataset_hash, 'mode': 'recorded_replay'})
            return r.model_dump(mode='json')
        if route == '/api/approve':
            rule_id = str(payload.get('rule_id', ''))
            rule = next((r for r in self.gate.all() if r.rule_id == rule_id), None)
            if rule is None or rule.status != RuleStatus.proposed:
                raise ValueError('Reload: this rule is no longer proposed.')
            check = check_promotion(rule, self.tasks, self.gate.approved())
            if not check.eligible:
                raise GateError(check.reason)
            if payload.get('confirmed') is not True:
                raise GateError('Human confirmation is required.')
            self.store.append_log('audit', {'event': 'promotion_check', 'rule_id': rule_id,
                'dataset_hash': self.dataset_hash, 'check': check.model_dump()})
            return self.gate.approve(rule_id, 'human:local-reviewer').model_dump(mode='json')
        if route == '/api/revert':
            reason = str(payload.get('reason', '')).strip()
            if payload.get('confirmed') is not True or not reason:
                raise GateError('Human confirmation and a reason are required.')
            return self.gate.revert(str(payload.get('rule_id', '')), 'human:local-reviewer', reason).model_dump(mode='json')
        if route == '/api/voyage/check':
            from vibeguard.context.voyage import health
            checked_at = datetime.now(timezone.utc)
            try:
                result = health()
            except VoyageError as e:
                self.voyage_check = VoyageCheck(status='failed', checked_at=checked_at, error=str(e))
                raise
            self.voyage_check = VoyageCheck(status='passed', checked_at=checked_at,
                model=result['model'], dimensions=result['dimensions'])
            return result
        if route == '/api/check':
            prompt, draft = str(payload.get('prompt', '')), str(payload.get('draft', ''))
            if len(prompt) > 16000 or len(draft) > 32000:
                raise ValueError('Shorten the prompt or draft before checking.')
            scores = score_prompt(prompt)
            hit = first_violation(draft, self.gate.approved())
            return {'scores': [s.model_dump(mode='json') for s in scores],
                'questions': side_conversation(missing(scores)),
                'blocked': bool(hit), 'rule_id': hit.rule_id if hit else None,
                'message': hit.user_message if hit else 'Draft passed the active rules. This is not a correctness guarantee.',
                'context': '\n'.join(r.user_message for r in self.gate.approved())[:8000]}
        raise ValueError('Unknown action')

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Do not log bodies or configuration values.

    @property
    def app(self):
        return self.server.app

    def host_ok(self):
        return self.headers.get('Host', '') in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}

    def send(self, status, body, mime='application/json'):
        data = body.encode('utf8') if isinstance(body, str) else json.dumps(body).encode('utf8')
        self.send_response(status)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.host_ok():
            return self.send(403, {'error': 'Unrecognized host'})
        if self.path == '/api/state':
            try:
                with self.app.lock:
                    return self.send(200, self.app.state())
            except Exception:
                return self.send(503, {'error': 'Storage unavailable. Check the server connection.'})
        assets = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'application/javascript'), '/style.css': ('style.css', 'text/css')}
        if self.path not in assets:
            return self.send(404, {'error': 'Not found'})
        name, mime = assets[self.path]
        text = (STATIC / name).read_text(encoding='utf8').replace('__CSRF__', self.app.csrf)
        self.send(200, text, mime)

    def do_POST(self):
        if not self.host_ok() or self.headers.get('X-VibeGuard-CSRF') != self.app.csrf:
            return self.send(403, {'error': 'Reload the workbench before continuing.'})
        allowed = {f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'}
        if self.headers.get('Origin') not in allowed:
            return self.send(403, {'error': 'Unrecognized origin'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 65536:
                raise ValueError('Invalid request size')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('Expected an object')
            with self.app.lock:
                result = self.app.action(self.path, payload)
            self.send(200, result)
        except VoyageError as e:
            self.send(503, {'error': str(e)})
        except (ValueError, GateError, FileNotFoundError) as e:
            self.send(400, {'error': str(e)})
        except Exception:
            self.send(503, {'error': 'Operation failed. No success is being claimed; check storage and retry.'})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        app = Workbench(args.root)
    except Exception as e:
        print(f'Atlas startup failed ({type(e).__name__}). Check MONGODB_URI, database user and network access.')
        raise SystemExit(1)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.app = app
    print(f'VibeGuard: http://127.0.0.1:{args.port} | {app.storage}', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
