import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalApi, MemoryStore } from './localApi';
import { createEvergreenSeed, DEMO_AGENCY_CODE, DEMO_NURSE_USERNAME } from './seed';
import { DEMO_PASSWORD } from './types';
import { screeningStatus, validateCareDraft, validateScreening, type CareDraft } from './careScreening';
const draft: CareDraft = {
  title: 'Hydration support',
  items: [{
    need: 'Dehydration risk',
    goal: 'Maintain usual hydration',
    interventions: 'Offer fluids at planned intervals and record concerns.',
    roles: ['nurse', 'dsp'],
    review_on: '2020-01-01'
  }]
};
const login = (username: string) => ({
  agencyCode: DEMO_AGENCY_CODE,
  username,
  password: DEMO_PASSWORD
});
async function fixture() {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const api = new LocalApi(store);
  const session = await api.signIn(login(DEMO_NURSE_USERNAME));
  const person = store.db.individuals.find(p => p.siteId === session.siteId)!;
  assert.ok(person);
  return {
    store,
    api,
    session,
    person
  };
}
test('care plan revisions preserve the active plan until approval and retain version acknowledgements', async () => {
  const {
    api,
    store,
    session,
    person
  } = await fixture();
  await api.mutateCareScreening({
    action: 'draft',
    individual_id: person.id,
    draft
  });
  let data = await api.getCareScreeningData(person.id);
  const first = data.plans[0];
  await api.mutateCareScreening({
    action: 'approve',
    id: first.id
  });
  await api.mutateCareScreening({
    action: 'acknowledge',
    id: first.id
  });
  await api.mutateCareScreening({
    action: 'acknowledge',
    id: first.id
  });
  await api.mutateCareScreening({
    action: 'draft',
    individual_id: person.id,
    previous_id: first.id,
    draft: {
      ...draft,
      title: 'Updated hydration support'
    }
  });
  data = await api.getCareScreeningData(person.id);
  assert.equal(data.plans.find(p => p.id === first.id)?.status, 'active');
  assert.equal(data.acknowledgements.length, 1);
  const revision = data.plans.find(p => p.status === 'draft')!;
  await assert.rejects(() => api.mutateCareScreening({
    action: 'draft',
    individual_id: person.id,
    previous_id: first.id,
    draft
  }));
  await api.mutateCareScreening({
    action: 'approve',
    id: revision.id
  });
  data = await api.getCareScreeningData(person.id);
  assert.equal(data.plans.find(p => p.id === first.id)?.status, 'revised');
  assert.equal(data.plans.find(p => p.id === revision.id)?.approved_by, session.userId);
  assert.equal(data.acknowledgements.some(a => a.plan_id === revision.id), false);
  await api.mutateCareScreening({
    action: 'retire',
    id: revision.id
  });
  assert.equal(store.db.careScreening?.plans.find(p => p.id === revision.id)?.status, 'retired');
});
test('DSP sees active plan only; auditors read history but cannot mutate; foreign sites are denied', async () => {
  const {
    api,
    store,
    person,
    session
  } = await fixture();
  await api.mutateCareScreening({
    action: 'draft',
    individual_id: person.id,
    draft
  });
  const id = (await api.getCareScreeningData(person.id)).plans[0].id;
  const membership = store.db.memberships.find(m => m.userId === session.userId)!;
  // Exercise each role with the same known membership/site and existing scope rules.
  for (const role of ['dsp', 'auditor', 'house_manager', 'program_manager']) {
    membership.roleKey = role;
    await api.signIn(login(DEMO_NURSE_USERNAME));
    if (role === 'dsp') store.db.assignments.push({
      id: crypto.randomUUID(),
      agencyId: person.agencyId,
      userId: session.userId,
      siteId: person.siteId,
      individualId: person.id,
      startsOn: '2020-01-01',
      endsOn: null
    });
    const data = await api.getCareScreeningData(person.id);
    assert.equal(data.plans.length, role === 'dsp' ? 0 : 1);
    await assert.rejects(() => api.mutateCareScreening({
      action: 'draft',
      individual_id: person.id,
      draft
    }));
    if (role === 'program_manager') await api.mutateCareScreening({
      action: 'approve',
      id
    });else await assert.rejects(() => api.mutateCareScreening({
      action: 'approve',
      id
    }));
  }
  membership.roleKey = 'dsp';
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const activeForDsp = await api.getCareScreeningData(person.id);
  assert.equal(activeForDsp.plans.length, 1);
  assert.equal(activeForDsp.plans[0].status, 'active');
  assert.equal(activeForDsp.screenings.length, 0);
  await api.mutateCareScreening({action:'acknowledge',id});
  membership.roleKey = 'auditor';
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await assert.rejects(() => api.mutateCareScreening({action:'acknowledge',id}));
  await assert.rejects(() => api.mutateCareScreening({action:'retire',id}));
  membership.roleKey = 'nurse';
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const outside = store.db.individuals.find(p => p.siteId !== person.siteId)!;
  await assert.rejects(() => api.getCareScreeningData(outside.id));
  await assert.rejects(() => api.mutateCareScreening({
    action: 'screening',
    individual_id: outside.id,
    draft: {
      type_id: 'x',
      last_completed_on: null,
      due_on: '2020-01-01',
      completed_on: null,
      result_note: '',
      follow_up: ''
    }
  }));
});
test('agency-configurable screening windows, completion and recipient deduplication', async () => {
  const {
    api,
    store,
    person
  } = await fixture();
  await api.mutateCareScreening({
    action: 'type',
    name: 'Custom lab panel',
    due_soon_days: 14,
    enabled: true
  });
  const type = (await api.getCareScreeningData(person.id)).types[0];
  const screening = {
    type_id: type.id,
    last_completed_on: null,
    due_on: '2020-01-01',
    completed_on: null,
    result_note: '',
    follow_up: 'Arrange review'
  };
  await api.mutateCareScreening({
    action: 'screening',
    individual_id: person.id,
    draft: screening
  });
  await api.mutateCareScreening({
    action: 'draft',
    individual_id: person.id,
    draft
  });
  const plan = (await api.getCareScreeningData(person.id)).plans[0];
  await api.mutateCareScreening({
    action: 'approve',
    id: plan.id
  });
  await api.sweepCareScreening();
  await api.sweepCareScreening();
  const notices = store.db.notifications.filter(n => n.type.startsWith('screening.') || n.type.startsWith('care.'));
  assert.ok(notices.length > 0);
  assert.equal(new Set(notices.map(n => n.dedupeKey)).size, notices.length);
  for (const notice of notices) {
    const member = store.db.memberships.find(m => m.userId === notice.userId)!;
    assert.ok(['nurse', 'house_manager', 'program_manager'].includes(member.roleKey));
    if (member.roleKey === 'program_manager') assert.ok(notice.type.startsWith('screening.'));else assert.equal(member.siteId, person.siteId);
  }
  const row = (await api.getCareScreeningData(person.id)).screenings[0];
  await api.mutateCareScreening({
    action: 'screening',
    id: row.id,
    individual_id: person.id,
    draft: {
      ...screening,
      completed_on: '2020-01-01',
      last_completed_on: '2020-01-01',
      result_note: 'Reviewed by nurse'
    }
  });
  assert.equal(screeningStatus((await api.getCareScreeningData(person.id)).screenings[0], type), 'completed');
  await api.mutateCareScreening({
    action: 'type',
    id: type.id,
    name: type.name,
    due_soon_days: 7,
    enabled: false
  });
  await assert.rejects(() => api.mutateCareScreening({
    action: 'screening',
    individual_id: person.id,
    draft: screening
  }));
});
test('screening status date boundaries and invalid records', () => {
  const s = {
    type_id: 'x',
    last_completed_on: null,
    due_on: '2026-11-10',
    completed_on: null,
    result_note: '',
    follow_up: ''
  };
  assert.equal(screeningStatus(s, {
    due_soon_days: 14
  }, '2026-10-27'), 'due soon');
  assert.equal(screeningStatus(s, {
    due_soon_days: 13
  }, '2026-10-27'), 'upcoming');
  assert.equal(screeningStatus({
    ...s,
    due_on: '2026-10-27'
  }, {
    due_soon_days: 0
  }, '2026-10-27'), 'due soon');
  assert.equal(screeningStatus({
    ...s,
    due_on: '2026-10-26'
  }, {
    due_soon_days: 14
  }, '2026-10-27'), 'overdue');
  assert.throws(() => validateCareDraft({
    ...draft,
    items: [{
      ...draft.items[0],
      roles: []
    }]
  }));
  assert.throws(() => validateCareDraft({
    ...draft,
    items: [{
      ...draft.items[0],
      review_on: '2026-02-30'
    }]
  }));
  assert.throws(() => validateScreening({
    ...s,
    completed_on: '2099-01-01'
  }, '2026-10-27'));
  assert.throws(() => validateScreening({
    ...s,
    completed_on: '2026-10-27'
  }, '2026-10-27'));
});
