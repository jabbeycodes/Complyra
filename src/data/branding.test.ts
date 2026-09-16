import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import {
  evergreenDemoLogoBytes,
  evergreenDemoLogoDataUrl,
  validateLogoFile,
} from "./branding";
import { buildAcknowledgmentPdf } from "../pdf/acknowledgmentPdf";
import { startBrandedDoc } from "../pdf/brandHeader";

function api() {
  return new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
}

test("logo uploads are limited to PNG or JPEG under 1.5 MB", () => {
  assert.throws(
    () => validateLogoFile(new File([new Uint8Array([1])], "x.gif", { type: "image/gif" })),
    /PNG or JPEG/,
  );
  validateLogoFile(
    new File([evergreenDemoLogoBytes()], "logo.png", { type: "image/png" }),
  );
});

test("Evergreen seed exposes a logo and branded PDFs accept it", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(session);
  assert.ok(workspace.branding.logoUrl?.startsWith("data:image/png"));
  const { doc } = startBrandedDoc("Test report", {
    agencyName: session.agencyName,
    logoDataUrl: workspace.branding.logoUrl,
  });
  assert.match(doc.output("datauristring"), /application\/pdf/);
  const packet = workspace.packets[0];
  const sheet = buildAcknowledgmentPdf(
    session.agencyName,
    packet,
    evergreenDemoLogoDataUrl(),
  );
  assert.match(sheet.output("datauristring"), /application\/pdf/);
});

test("PM can replace or remove the logo; a DSP cannot", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  await client.uploadAgencyLogo(
    new File([evergreenDemoLogoBytes()], "custom.png", { type: "image/png" }),
  );
  const afterUpload = await client.loadWorkspace(admin);
  assert.ok(afterUpload.branding.logoUrl);

  const dspClient = api();
  await dspClient.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  await assert.rejects(
    () =>
      dspClient.uploadAgencyLogo(
        new File([evergreenDemoLogoBytes()], "nope.png", { type: "image/png" }),
      ),
    /administrator/,
  );

  await client.removeAgencyLogo();
  const afterRemove = await client.loadWorkspace(admin);
  assert.equal(afterRemove.branding.logoUrl, null);
});
