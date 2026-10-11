// Production starts must not depend on a hosting provider setting NODE_ENV.
process.env.NODE_ENV = 'production';
await import('../.modelence/build/app.mjs');
