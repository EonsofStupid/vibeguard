import { Module } from 'modelence/server';
import { improvementStatus } from './status';

/** Canonical read surface for the measured improvement lifecycle. */
export default new Module('improvement', {
  queries: { status: improvementStatus },
});
