"""Atlas record store. Rule transitions and their receipts commit together."""
from datetime import datetime, timezone
from pymongo import MongoClient
from pymongo.write_concern import WriteConcern
from pydantic import BaseModel

KINDS = {'rules', 'runs', 'lexicon', 'failures', 'costar', 'facts', 'audit'}

class AtlasStore:
    def __init__(self, uri: str, database: str = 'vibeguard', client=None):
        self.client = client if client is not None else MongoClient(uri,
            appname='VibeGuard', serverSelectionTimeoutMS=8000, connectTimeoutMS=8000,
            socketTimeoutMS=15000, timeoutMS=20000)
        self.db = self.client[database]
        self.client.admin.command('ping')
        # Create collections before a multi-document transaction begins.
        existing = set(self.db.list_collection_names())
        for kind in KINDS - existing:
            self.db.create_collection(kind)

    @classmethod
    def from_env(cls):
        import os
        uri = os.environ.get('MONGODB_URI', '')
        if not uri:
            raise ValueError('MONGODB_URI is required for Atlas storage.')
        return cls(uri, os.environ.get('MONGODB_DATABASE', 'vibeguard'))

    def read_log(self, kind):
        for doc in self._collection(kind).find().sort('_id', 1):
            yield {k: v for k, v in doc.items() if k != '_id'}

    def _collection(self, kind):
        if kind not in KINDS:
            raise ValueError('Unknown record kind')
        return self.db[kind]

    @staticmethod
    def _document(record_id, record, body):
        return {'_id': record_id, 'record': record.model_dump(mode='json'), 'body': body}

    def write(self, kind, record_id, record: BaseModel, body=''):
        self._collection(kind).replace_one({'_id': record_id},
            self._document(record_id, record, body), upsert=True)
        return record_id

    def read(self, kind, record_id, model):
        doc = self._collection(kind).find_one({'_id': record_id})
        if doc is None:
            raise FileNotFoundError(record_id)
        return model.model_validate(doc['record'])

    def exists(self, kind, record_id):
        return self._collection(kind).find_one({'_id': record_id}, {'_id': 1}) is not None

    def list(self, kind, model):
        for doc in self._collection(kind).find().sort('_id', 1):
            yield model.model_validate(doc['record'])

    def append_log(self, kind, event):
        self._collection(kind).insert_one({'at': datetime.now(timezone.utc).isoformat(), **event})

    def write_rule_and_audit(self, rule, body, receipt):
        from vibeguard.rules import GateError
        document = self._document(rule.rule_id, rule, body)
        def transition(session):
            rules = self._collection('rules')
            if receipt['event'] == 'propose':
                rules.insert_one(document, session=session)
            else:
                expected = {'_id': rule.rule_id, 'record.version': rule.version - 1}
                if receipt['event'] == 'approve':
                    expected['record.status'] = 'proposed'
                result = rules.replace_one(expected, document, session=session)
                if result.matched_count != 1:
                    raise GateError('Rule changed since review; reload before proceeding.')
            self._collection('audit').insert_one(
                {'at': datetime.now(timezone.utc).isoformat(), **receipt}, session=session)
        with self.client.start_session() as session:
            session.with_transaction(transition, write_concern=WriteConcern('majority'))

    def close(self):
        self.client.close()
