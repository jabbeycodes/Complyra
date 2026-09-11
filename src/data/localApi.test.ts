import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import { DEMO_ADMIN_EMAIL, DEMO_DSP_EMAIL } from "./seed";
import { DEMO_PASSWORD } from "./types";
import { buildAcknowledgmentPdf } from "../pdf/acknowledgmentPdf";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

test("assigned staff appear on one acknowledgment sheet and unsigned rows stay visible", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(DEMO_ADMIN_EMAIL, DEMO_PASSWORD);
  const workspace = await api.loadWorkspace(session);
  const packet = workspace.packets.find((p) =>
    p.individual.fullName.includes("Jodie"),
  );
  assert.ok(packet);
  assert.ok(packet.rows.length >= 3);
  assert.equal(
    packet.rows.some((row) => row.staffName === "Alex Morgan" && !row.signedAt),
    true,
  );
  const pdf = buildAcknowledgmentPdf(session.agencyName, packet);
  const text = pdf.output("datauristring");
  assert.match(text, /application\/pdf/);
});

test("staff must open the document before signing their own row", async () => {
  const api = new LocalApi(store());
  const dsp = await api.signIn(DEMO_DSP_EMAIL, DEMO_PASSWORD);
  const workspace = await api.loadWorkspace(dsp);
  const packet = workspace.packets.find((p) =>
    p.rows.some((row) => row.userId === dsp.userId && !row.signedAt),
  );
  assert.ok(packet);
  const row = packet.rows.find((item) => item.userId === dsp.userId)!;
  await assert.rejects(
    () => api.signRow(row.id, dsp.fullName, "data:image/png;base64,aaa"),
    /Open and review/,
  );
  await api.markOpened(row.id);
  await api.signRow(row.id, dsp.fullName, "data:image/png;base64,aaa");
  const signed = (await api.loadWorkspace(dsp)).packets
    .flatMap((item) => item.rows)
    .find((item) => item.id === row.id);
  assert.ok(signed?.signedAt);
});

test("a DSP cannot approve a draft or sign another person's row", async () => {
  const memory = store();
  const api = new LocalApi(memory);
  const admin = await api.signIn(DEMO_ADMIN_EMAIL, DEMO_PASSWORD);
  const jodie = (await api.loadWorkspace(admin)).individuals.find((p) =>
    p.name.includes("Jodie"),
  )!;
  await api.createRequirementDraft({
    individualId: jodie.id,
    title: "Review transport instructions",
    category: "PCSP acknowledgments",
    ownerUserId: admin.userId,
    source: "Jodie Williams · PCSP 2026 · v2",
    sourcePage: 4,
    dueOn: "2026-09-20",
    frequency: "On plan update",
  });
  await api.signOut();
  const dsp = await api.signIn(DEMO_DSP_EMAIL, DEMO_PASSWORD);
  const draft = (await api.loadWorkspace(dsp)).requirements.find(
    (r) => r.title === "Review transport instructions",
  )!;
  await assert.rejects(() => api.approveRequirement(draft.id), /permission/);
  const foreign = (await api.loadWorkspace(dsp)).packets
    .flatMap((p) => p.rows)
    .find((row) => row.userId !== dsp.userId)!;
  await assert.rejects(
    () => api.signRow(foreign.id, "No", "data:image/png;base64,aaa"),
    /own acknowledgment/,
  );
});
