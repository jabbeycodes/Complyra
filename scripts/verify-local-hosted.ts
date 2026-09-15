/** Real HostedApi → PostgREST → PostgreSQL checks, restricted to a seeded local backend. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { HostedApi } from '../src/data/hostedApi';
const config = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
assert.match(config.API_URL, /^http:\/\/(127\.0\.0\.1|localhost):/, 'Only the disposable local backend may be tested');
const usernames = ['sarah.mitchell', 'james.wilson', 'alex.morgan', 'cameron.price'];
for (const username of usernames) {
  const client = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const api = new HostedApi(client);
  const session = await api.signIn({ agencyCode: 'EVERGREEN-MO', username, password: 'Evergreen!demo1' });
  assert.ok(session);
  const workspace = await api.loadWorkspace(session);
  assert.ok(workspace.individuals.length > 0, `${username}: visible assigned people`);
  if (session.siteId) assert.ok(workspace.individuals.every((p) => p.siteId === session.siteId), `${username}: site isolation`);
  await api.listNotifications();
  if (session.permissions['audit.read']) {
    await api.listQaAudits();
    await api.listCorrectiveActions();
    for (const site of workspace.sites) await api.listQaAuditHistory(site.id);
  }
  console.log(`PASS ${username}: workspace, scope, notifications${session.permissions['audit.read'] ? ', audits and actions' : ''}`);
  await client.auth.signOut();
}

const client = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const api = new HostedApi(client);
const session = await api.signIn({ agencyCode: 'EVERGREEN-MO', username: 'sarah.mitchell', password: 'Evergreen!demo1' });
const suffix = Date.now();
const site = await api.createSite({ name: `Audit test ${suffix}`, address: '100 Fictional Lane', programName: 'Audit verification' });
const person = await api.createIndividual({ fullName: `Fictional audit ${suffix}`, dateOfBirth: '1990-03-01', siteId: site.id });
await api.saveSiteFacts(site.id, { sitePhone: '555-0101', city: 'Test City', wellWater: true });
await api.createRequirementDraft({ individualId: person.id, title: `Verify safety ${suffix}`, category: 'Required forms', ownerUserId: session.userId, source: 'Audit verification', sourcePage: 1, dueOn: '2026-10-01', frequency: 'One time' });
let workspace = await api.loadWorkspace(session);
assert.equal(workspace.sites.find(s => s.id === site.id)?.sitePhone, '555-0101', 'site facts persist through workspace reload');
const req = workspace.requirements.find(r => r.title === `Verify safety ${suffix}`)!;
assert.ok(req, 'saved requirement appears');
await api.approveRequirement(req.id);
await api.completeRequirement(req.id, 'Fictional evidence recorded during local verification');
workspace = await api.loadWorkspace(session);
assert.equal(workspace.requirements.find(r => r.id === req.id)?.status, 'Compliant');
const qa = await api.createQaAudit(site.id, 2026, 3);
const items = await api.getQaAuditItems(qa.id);
assert.ok(items.length > 0, 'audit expands site and person items');
const manual = items.find(i => !i.locked)!;
await api.scoreQaItem(qa.id, manual.key, 'yes', 'Fictional verification');
assert.equal((await api.getQaAuditItems(qa.id)).find(i => i.key === manual.key)?.result, 'yes');
const photo = { id: crypto.randomUUID(), name: 'fixture.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', capturedAt: new Date().toISOString(), capturedBy: session.userId };
await api.raiseQaDispute(qa.id, manual.key, 'Fictional follow-up evidence', [photo]);
assert.equal((await api.resolveQaDispute(qa.id, manual.key, true, 'Evidence reviewed')).status, 'resolved');
assert.ok((await api.listQaAuditHistory(site.id)).some(a => a.id === qa.id), 'site history connected');
const action = await api.addCorrectiveAction({ title: `Audit action ${suffix}`, assignedToUserId: session.userId, dueOn: '2026-10-01' });
await api.resolveCorrectiveAction(action.id);
assert.equal((await api.listCorrectiveActions()).find(a => a.id === action.id)?.storedStatus, 'resolved');
const template = await api.createDelegationTemplate({ name: `Verification ${suffix}`, category: 'Health monitoring', sections: { purpose: 'Fictional test', steps: ['Observe'], safetyWarnings: [], documentation: ['Record'] }, individualizationNote: 'Test only' });
const activation = await api.activateDelegationTemplate(template.id, site.id);
const assignment = await api.assignDelegationToIndividual(activation.id, person.id);
const material = await api.getDelegationTrainingMaterial(assignment.id);
assert.ok(material);
await api.updateDelegationTrainingDraft(assignment.id, { ...material.draftContent, individualNotes: 'Fictional individualized instructions' });
await api.submitDelegationForReview(assignment.id);
await api.approveDelegationTrainingMaterial(assignment.id, { ...material.draftContent, individualNotes: 'Fictional individualized instructions' });
await api.openDelegationMaterial(assignment.id);
await api.signDelegationAcknowledgment(assignment.id, session.fullName, 'Test signature');
assert.ok((await api.getMyDelegationAck(assignment.id))?.signedAt);
assert.equal((await api.getDelegationTrainingMaterial(assignment.id))?.publishedContent?.individualNotes, 'Fictional individualized instructions');
console.log('PASS hosted delegation template → activation → individual assignment → draft → review → publish → open → acknowledgment');
console.log('PASS hosted setup → site facts → individual → requirement draft → approval → evidence → QA scoring/history → corrective action resolution');
await client.auth.signOut();

const service = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// Always revoke temporary memberships; a local database reset clears all fixtures.
for (const roleKey of ['compliance_admin','degreed_professional_manager','program_manager','hr','auditor']) {
  const username = `audit.${roleKey.replaceAll('_','')}.${suffix}`;
  const email = `${username}@example.invalid`;
  const { data: auth, error } = await service.auth.admin.createUser({ email, password: 'AuditVerify!123', email_confirm: true, user_metadata: { username, full_name: 'Fictional verification', home_agency_id: session.agencyId, must_change_password: false } });
  assert.ifError(error);
  const id = auth.user!.id;
  try {
    const { error: profileError } = await service.from('profiles').update({ username, home_agency_id: session.agencyId, must_change_password: false }).eq('id', id);
    assert.ifError(profileError);
    const { ROLE_TEMPLATE_BY_KEY } = await import('../src/data/permissions');
    const template = ROLE_TEMPLATE_BY_KEY[roleKey as keyof typeof ROLE_TEMPLATE_BY_KEY];
    const { error: memberError } = await service.from('memberships').insert({ user_id: id, agency_id: session.agencyId, role: template.capability, role_key: roleKey });
    assert.ifError(memberError);
    const roleSession = await api.signIn({ agencyCode: 'EVERGREEN-MO', username, password: 'AuditVerify!123' });
    const view = await api.loadWorkspace(roleSession);
    assert.equal(view.individuals.length === 0, roleKey === 'hr', `${roleKey}: care data access`);
    await api.listNotifications();
    console.log(`PASS hosted ${roleKey}: sign-in, workspace, care-data permission`);
    await client.auth.signOut();
  } finally {
    const { error: cleanupError } = await service.from('memberships').delete().eq('user_id', id);
    assert.ifError(cleanupError);
    await service.auth.admin.deleteUser(id);
  }
}
await api.signIn({ agencyCode: 'EVERGREEN-MO', username: 'sarah.mitchell', password: 'Evergreen!demo1' });
const med = { id: crypto.randomUUID() };
const { error: medError } = await service.from('medications').insert({ id: med.id, agency_id: session.agencyId, individual_id: person.id, name: 'Fictional PRN verification', strength: 'Test only', kind: 'prn', pills_per_day: 0, remaining_pills: 0 });
assert.ifError(medError);
await api.recordMedDelivery({ medicationId: med.id, remainingPills: 10, pillsPerDay: 0 });
await Promise.all([api.logPrnDose(med.id, 1), api.logPrnDose(med.id, 1)]);
const { data: count } = await client.from('medications').select('remaining_pills').eq('id', med.id).single();
assert.equal(Number(count!.remaining_pills), 8, 'simultaneous PRN doses do not overwrite one another');
await assert.rejects(() => api.logPrnDose(med.id, 99), /exceeds/);
const { data: logs } = await client.from('prn_dose_logs').select('id').eq('medication_id', med.id);
assert.ok(logs && logs.length >= 2, 'each successful dose has an audit log');
console.log('PASS hosted medication count, concurrent PRN doses, overdraw rejection, evidence logs');
await client.auth.signOut();
