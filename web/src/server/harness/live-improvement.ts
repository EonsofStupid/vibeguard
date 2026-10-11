import { MongoClient, MongoNetworkError, MongoServerSelectionError, MongoOperationTimeoutError, type Db, type Document } from 'mongodb';

let connection: Promise<MongoClient> | undefined;

/** Keep evidence on the existing M10, even when the platform provides its own app database. */
export async function evidenceDatabase() {
  const uri = process.env.VIBEGUARD_ATLAS_URI;
  if (!uri) throw new Error('Live evidence needs VIBEGUARD_ATLAS_URI in the server environment.');
  if (!connection) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000,
      socketTimeoutMS: 10000, timeoutMS: 10000, waitQueueTimeoutMS: 5000,
      maxPoolSize: 5, maxIdleTimeMS: 30000, retryReads: false, readConcern: { level: 'majority' },
    });
    connection = client.connect().catch(async (error: unknown) => {
      connection = undefined;
      await client.close();
      throw new Error('The evidence database could not be reached. Check the Atlas connection and network access.', { cause: error });
    });
  }
  return (await connection).db(process.env.VIBEGUARD_ATLAS_DATABASE || 'vibeguard');
}

function transientReadFailure(error: unknown): boolean {
  return error instanceof MongoNetworkError || error instanceof MongoServerSelectionError ||
    error instanceof MongoOperationTimeoutError ||
    (error instanceof Error && error.cause !== undefined && transientReadFailure(error.cause));
}

/** Two READ attempts share one 18-second budget; no write or paid request is retried. */
export async function evidenceRead<T>(operation: (db: Db, options: { signal: AbortSignal; timeoutMS: number }) => Promise<T>): Promise<T> {
  const deadline = Date.now() + 18000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timedOut = () => new Error('Atlas evidence is taking too long to respond. No model request was sent; please try again.');
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(timedOut()); }, 18000);
  });
  const read = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        controller.signal.throwIfAborted();
        const db = await evidenceDatabase();
        controller.signal.throwIfAborted();
        return await operation(db, { signal: controller.signal, timeoutMS: Math.max(1, deadline - Date.now()) });
      } catch (error) {
        if (controller.signal.aborted || Date.now() >= deadline) throw timedOut();
        if (!transientReadFailure(error)) throw error;
        if (attempt === 1) throw new Error('Atlas evidence could not be read after two connection attempts. No model request was sent; please try again.');
      }
    }
    throw timedOut();
  };
  try { return await Promise.race([read(), timeout]); }
  finally { clearTimeout(timer!); }
}

function comparison(value: Document, hasCandidate: boolean) {
  return {
    before: { passed: value.before, total: value.total },
    // A perfect baseline has no candidate, even if the artifact repeats its score.
    after: hasCandidate ? { passed: value.after, total: value.total } : null,
  };
}

export async function liveImprovement() {
  const experiment = await evidenceRead((db, options) => db.collection('harness_experiments').findOne(
    { status: 'completed' },
    { sort: { started_at: -1 }, projection: {
      experiment_id: 1, started_at: 1, model: 1, 'model_calls.model': 1, evidence_type: 1,
      metrics: 1, promotion: 1, 'candidate.policy': 1,
    }, maxTimeMS: 5000, ...options },
  ));
  if (!experiment) return { experiment: null, proposal: null, review: { url: null, ready: false } };
  const proposal = await evidenceRead((db, options) => db.collection('harness_proposals').findOne(
    { experiment_id: experiment.experiment_id },
    { sort: { version: -1 }, projection: {
      version: 1, status: 1, policy_hash: 1, policy: 1, evidence_summary: 1,
      review_url: 1, review_state: 1,
    }, maxTimeMS: 5000, ...options },
  ));
  const hasCandidate = !!experiment.candidate?.policy;
  const rerun = await evidenceRead((db, options) => db.collection('harness_reruns').findOne({ experiment_id: experiment.experiment_id }, { sort: { finished_at: -1 }, maxTimeMS: 5000, ...options }));
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
      effect: typeof experiment.metrics.train.avoidable_recalls_before === 'number' ? {
        before: experiment.metrics.train.avoidable_recalls_before + experiment.metrics.heldout.avoidable_recalls_before,
        after: experiment.metrics.train.avoidable_recalls_after + experiment.metrics.heldout.avoidable_recalls_after,
        turnsBefore: experiment.metrics.train.recorded_turns_before + experiment.metrics.heldout.recorded_turns_before,
        turnsAfter: experiment.metrics.train.recorded_turns_after + experiment.metrics.heldout.recorded_turns_after,
      } : null,
    },
    proposal: proposal ? {
      _id: String(proposal._id), version: proposal.version, status: proposal.status,
      policy_hash: proposal.policy_hash, policy: proposal.policy, evidence_summary: proposal.evidence_summary,
    } : null,
    review: { url: ready ? proposal!.review_url : null, ready },
    rerun: rerun ? { id: String(rerun._id), passed: rerun.passed, policy_hash: rerun.policy_hash, evidence_type: rerun.evidence_type } : null,
  };
}
