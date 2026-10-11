import { MongoClient, MongoNetworkError, MongoServerSelectionError, MongoOperationTimeoutError, type Db } from 'mongodb';

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
      const failure = new Error('The evidence database could not be reached. Check the Atlas connection and network access.') as Error & { cause?: unknown };
      failure.cause = error;
      throw failure;
    });
  }
  return (await connection).db(process.env.VIBEGUARD_ATLAS_DATABASE || 'vibeguard');
}

function transientReadFailure(error: unknown): boolean {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  return error instanceof MongoNetworkError || error instanceof MongoServerSelectionError ||
    error instanceof MongoOperationTimeoutError ||
    (cause !== undefined && transientReadFailure(cause));
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

