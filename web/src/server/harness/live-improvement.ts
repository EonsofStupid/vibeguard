import { MongoClient, type Document } from 'mongodb';

let connection: Promise<MongoClient> | undefined;

/** Keep evidence on the existing M10, even when the platform provides its own app database. */
export async function evidenceDatabase() {
  const uri = process.env.VIBEGUARD_ATLAS_URI;
  if (!uri) throw new Error('Live evidence needs VIBEGUARD_ATLAS_URI in the server environment.');
  if (!connection) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000,
      socketTimeoutMS: 15000, maxPoolSize: 5, readConcern: { level: 'majority' },
    });
    connection = client.connect().catch(async () => {
      connection = undefined;
      await client.close();
      throw new Error('The evidence database could not be reached. Check the Atlas connection and network access.');
    });
  }
  return (await connection).db(process.env.VIBEGUARD_ATLAS_DATABASE || 'vibeguard');
}

function comparison(value: Document, hasCandidate: boolean) {
  return {
    before: { passed: value.before, total: value.total },
    // A perfect baseline has no candidate, even if the artifact repeats its score.
    after: hasCandidate ? { passed: value.after, total: value.total } : null,
  };
}

export async function liveImprovement() {
  const db = await evidenceDatabase();
  const experiment = await db.collection('harness_experiments').findOne(
    { status: 'completed' },
    { sort: { started_at: -1 }, projection: {
      experiment_id: 1, started_at: 1, model: 1, 'model_calls.model': 1, evidence_type: 1,
      metrics: 1, promotion: 1, 'candidate.policy': 1,
    }, maxTimeMS: 5000 },
  );
  if (!experiment) return { experiment: null, proposal: null, review: { url: null, ready: false } };
  const proposal = await db.collection('harness_proposals').findOne(
    { experiment_id: experiment.experiment_id },
    { sort: { version: -1 }, projection: {
      version: 1, status: 1, policy_hash: 1, policy: 1, evidence_summary: 1,
      review_url: 1, review_state: 1,
    }, maxTimeMS: 5000 },
  );
  const hasCandidate = !!experiment.candidate?.policy;
  const ready = !!proposal?.review_url && ['awaiting_review', 'completed'].includes(proposal.review_state);
  return {
    experiment: {
      experiment_id: experiment.experiment_id,
      at: experiment.started_at,
      model: experiment.model || experiment.model_calls?.[0]?.model || 'Not recorded',
      evidence_kind: experiment.evidence_type,
      metrics: {
        train: comparison(experiment.metrics.train, hasCandidate),
        heldout: comparison(experiment.metrics.heldout, hasCandidate),
      },
      promotion: experiment.promotion,
    },
    proposal: proposal ? {
      _id: String(proposal._id), version: proposal.version, status: proposal.status,
      policy_hash: proposal.policy_hash, policy: proposal.policy, evidence_summary: proposal.evidence_summary,
    } : null,
    review: { url: ready ? proposal!.review_url : null, ready },
  };
}
