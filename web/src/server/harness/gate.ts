/**
 * The governance gate: a one-way ratchet with human release.
 * Agents may PROPOSE tightening. Only humans APPROVE. Loosening/revert is human-only. Nothing is deleted.
 * Every transition writes the rule and its receipt (ADR-0002: governed durable effects).
 */
import { dbRules, dbAudit } from './db';
import { GuardrailRule, isHuman, type GuardrailRule as Rule } from './schemas';
import { raindrop } from './raindrop';

export class GateError extends Error {}
const now = () => new Date().toISOString();

async function save(rule: Rule, event: string, actor: string, reason?: string) {
  const body = `# ${rule.rule_id} — ${rule.category}\n\n> ${rule.user_message}\n`;
  await dbRules.upsertOne({ _id: rule.rule_id } as any, { $set: { record: rule, body } });
  await dbAudit.insertOne({ at: now(), event, rule_id: rule.rule_id, version: rule.version, status: rule.status, actor, ...(reason ? { reason } : {}) });
}

export async function allRules(): Promise<Rule[]> {
  const docs = await dbRules.fetch({}, { sort: { _id: 1 } });
  return docs.map((d: any) => GuardrailRule.parse(d.record));
}
export async function approvedRules(): Promise<Rule[]> {
  return (await allRules()).filter((r) => r.status === 'approved');
}
export async function nextId(): Promise<string> {
  const nums = (await allRules()).map((r) => parseInt(r.rule_id.split('-')[1], 10));
  return `VG-${String(nums.length ? Math.max(...nums) + 1 : 1).padStart(4, '0')}`;
}
async function load(ruleId: string): Promise<Rule> {
  const d: any = await dbRules.findOne({ _id: ruleId } as any);
  if (!d) throw new GateError(`no rule ${ruleId}`);
  return GuardrailRule.parse(d.record);
}

export async function propose(rule: Rule, actor: string): Promise<Rule> {
  if (rule.direction === 'loosen' && !isHuman(actor)) throw new GateError('Agents may tighten their own leash; only humans loosen it.');
  const r = { ...rule, status: 'proposed' as const, proposed_by: actor, updated_at: now() };
  await save(r, 'propose', actor); void raindrop.proposed(r); return r;
}
export async function approve(ruleId: string, actor: string): Promise<Rule> {
  if (!isHuman(actor)) throw new GateError('Only a human can approve a rule change.');
  const rule = await load(ruleId);
  if (rule.status !== 'proposed') throw new GateError(`${ruleId} is ${rule.status}, not proposed.`);
  const r = { ...rule, status: 'approved' as const, approved_by: actor, version: rule.version + 1, updated_at: now() };
  await save(r, 'approve', actor); void raindrop.decided(r, 'approve', actor); return r;
}
export async function revert(ruleId: string, actor: string, reason = ''): Promise<Rule> {
  if (!isHuman(actor)) throw new GateError('Reverting loosens the leash; only a human can do it.');
  const rule = await load(ruleId);
  const r = { ...rule, status: 'reverted' as const, version: rule.version + 1, updated_at: now() };
  await save(r, 'revert', actor, reason); void raindrop.decided(r, 'revert', actor, reason); return r;
}
