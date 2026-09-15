import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalApi, MemoryStore } from './localApi';
import { createEvergreenSeed } from './seed';
import { assertCalendarDate } from './access';
import { validateCorrectiveActionInput } from './correctiveActions';
import { buildScoreFactsForData, type CommandCenterData } from '../components/CommandCenter';
const login = (username: string) => ({ agencyCode: 'EVERGREEN-MO', username, password: 'Evergreen!demo1' });
function setup() { const store = new MemoryStore(structuredClone(createEvergreenSeed())); return { store, api: new LocalApi(store) }; }

test('audit: invalid calendar dates cannot silently roll into another month', () => {
  for (const date of ['2026-02-30', '2026-09-31', 'invalid', '2026-13-01']) {
    assert.throws(() => assertCalendarDate(date));
    assert.ok(validateCorrectiveActionInput({ title: 'Review', dueOn: date }).length > 0);
  }
  assert.doesNotThrow(() => assertCalendarDate('2024-02-29'));
});
test('audit: medication writes and files reject another home', async () => {
  const { store, api } = setup();
  const session = await api.signIn(login('james.wilson'));
  const person = store.db.individuals.find(p => p.siteId !== session.siteId)!;
  const med = store.db.medications.find(m => m.individualId === person.id)!;
  await assert.rejects(() => api.recordMedDelivery({ medicationId: med.id, remainingPills: 10, pillsPerDay: 1 }), /assigned access/);
  const doc = store.db.documents.find(d => d.individualId === person.id)!;
  const version = store.db.versions.find(v => v.documentId === doc.id)!;
  await assert.rejects(() => api.getDocumentFile(version.id), /assigned access/);
  await assert.rejects(() => api.getMedInventory(person.id), /assigned access/);
  await assert.rejects(() => api.listMileageTrips(person.siteId, '2026-09'), /Home not found/);
});
test('audit: invalid medication quantities never mutate stored stock', async () => {
  const { store, api } = setup();
  await api.signIn(login('sarah.mitchell'));
  const med = store.db.medications.find(m => m.kind === 'prn')!;
  const before = med.remainingPills;
  for (const count of [NaN, Infinity, -1]) {
    await assert.rejects(() => api.recordMedDelivery({ medicationId: med.id, remainingPills: count, pillsPerDay: 0 }));
  }
  await assert.rejects(() => api.logPrnDose(med.id, before + 1), /exceeds/);
  assert.equal(med.remainingPills, before);
});
test('audit: private corrective actions are visible only to management and assigned staff', async () => {
  const { store, api } = setup();
  await api.signIn(login('sarah.mitchell'));
  const privateAction = await api.addCorrectiveAction({ title: 'Private agency review' });
  const dsp = store.db.profiles.find(p => p.username === 'alex.morgan')!;
  const assigned = await api.addCorrectiveAction({ title: 'Assigned review', assignedToUserId: dsp.id });
  await api.signIn(login('alex.morgan'));
  const rows = await api.listCorrectiveActions();
  assert.equal(rows.some(r => r.id === privateAction.id), false);
  assert.equal(rows.some(r => r.id === assigned.id), true);
});
test('audit: site history uses saved quarterly audits and omits other homes', async () => {
  const { store, api } = setup();
  await api.signIn(login('sarah.mitchell'));
  const site = store.db.sites.find(s => s.name === 'Maple House')!;
  const audit = await api.createQaAudit(site.id, 2026, 3);
  assert.equal((await api.listQaAuditHistory(site.id))[0].id, audit.id);
  await api.signIn(login('james.wilson'));
  assert.deepEqual(await api.listQaAuditHistory(site.id), []);
});
test('audit: expired requirements and medication risks contribute to one site score', async () => {
  const { api } = setup();
  const session = await api.signIn(login('sarah.mitchell'));
  const workspace = await api.loadWorkspace(session);
  const meds = (await Promise.all(workspace.individuals.map(p => api.getMedInventory(p.id)))).flat();
  const data: CommandCenterData = { ...workspace, actions: [], certs: [], clearance: [], checklists: [], snapshots: [], medications: meds };
  const facts = buildScoreFactsForData(data);
  assert.equal(new Set(facts.map(f => f.siteId)).size, facts.length);
  assert.equal(facts.reduce((n,f) => n + f.medications.length, 0), meds.length);
  assert.ok(facts.some(f => f.requirements.includes('overdue')));
});
