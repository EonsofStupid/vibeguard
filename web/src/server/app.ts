import { startApp } from 'modelence/server';
import exampleModule from '@/server/example';
import harnessModule from '@/server/harness';
import chatModule from '@/server/chat';
import reviewModule from '@/server/review';
import improvementModule from '@/server/improvement';
import { createDemoUser } from '@/server/migrations/createDemoUser';

startApp({
  modules: [exampleModule, harnessModule, chatModule, reviewModule, improvementModule],

  email: {
    // Without this the reset link redirects to the site root and dead-ends.
    passwordReset: {
      redirectUrl: '/reset-password',
    },
  },

  security: {
    frameAncestors: ['https://modelence.com', 'https://*.modelence.com', 'http://localhost:*', 'https://*.exp.direct'],
  },

  migrations: [{
    version: 1,
    description: 'Create demo user',
    handler: createDemoUser,
  }],
});
