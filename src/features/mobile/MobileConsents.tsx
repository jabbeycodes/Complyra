import { useCallback, useEffect, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  canManageConsents,
  canSeeConsents,
  type ConsentRegister,
} from "../../data/consents";
import {
  evidenceBlob,
  packetOutstanding,
  packetStatus,
  type ConsentPacket,
  type PacketChoices,
  type PacketSignature,
} from "../../data/consentPackets";
import { buildConsentPacketPdf } from "../../pdf/consentPacketPdf";
import { buildRightsPacketPdf } from "../../pdf/rightsPacketPdf";
import { downloadBlob, openPrintable } from "../../data/openFile";
import { todayStamp } from "../../data/status";
import PacketForm from "../consents/PacketForm";
import RightsPacketForm from "../consents/RightsPacketForm";
import {
  type RightsPacket,
  type RightsPacketCompletion,
} from "../../data/rightsPackets";
import { PersonHeader } from "./MobileMar";
import {
  consentRecordStatus,
  consentTypeRows,
  rightsHistoryLine,
  rightsPacketSummary,
} from "./chartSections";
import type { WorkspaceIndividual } from "./types";

const emptyRightsCompletion = (): RightsPacketCompletion => ({
  reviewedBy: "",
  // Deliberately empty: the manager types the packet date.
  packetOn: "",
  signer: {
    printedName: "",
    authority: "Self",
    authorityOther: "",
    signature: "",
    witness: "",
    accepted: false,
  },
});

/**
 * Mobile Consents — the chart's consents register and consent packets
 * for one Individual, over the same register (getConsents) and packet
 * API the desktop chart uses. The register renders cell-for-cell what
 * the chart shows (including the DSP masking of a Missing status).
 * Packets keep their desktop doors: generate, print/download the
 * packet, issue the secure signing link, download filed evidence, and
 * file a signed paper copy — the filing reuses the desktop PacketForm,
 * typed signer signature included. Creating register drafts, renewals,
 * revocations, and consent-type configuration stay on the desktop
 * chart. Gates mirror the chart: canSeeConsents to see the section
 * (auditors read-only), packets hidden from DSPs exactly as the chart
 * hides them, writes follow canManageConsents.
 */
export default function MobileConsents({
  api,
  session,
  person,
  onOpenChart,
  onBack,
}: {
  api: ComplyraApi;
  session: SessionUser;
  person: WorkspaceIndividual;
  onOpenChart: (name: string) => void;
  onBack: () => void;
}) {
  const [register, setRegister] = useState<ConsentRegister | null>(null);
  const [packets, setPackets] = useState<ConsentPacket[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [expiry, setExpiry] = useState(14);
  const [paper, setPaper] = useState<ConsentPacket | null>(null);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [choices, setChoices] = useState<PacketChoices>({});
  const [signer, setSigner] = useState<PacketSignature>({
    printedName: "",
    authority: "Self",
    authorityOther: "",
    signature: "",
    witness: "",
    signedOn: todayStamp(),
    accepted: false,
  });
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [openAudit, setOpenAudit] = useState<string | null>(null);
  const [rights, setRights] = useState<RightsPacket[]>([]);
  const [rightsCompleting, setRightsCompleting] = useState<{
    packet: RightsPacket;
    paper: boolean;
  } | null>(null);
  const [rightsCompletion, setRightsCompletion] =
    useState<RightsPacketCompletion>(emptyRightsCompletion());
  const [rightsFile, setRightsFile] = useState<File | undefined>(undefined);
  const [rightsStart, setRightsStart] = useState(false);
  const [rightsSignerName, setRightsSignerName] = useState("");

  const visible = canSeeConsents(session.roleKey);
  const manage = canManageConsents(session.roleKey);
  const packetsVisible = visible && session.roleKey !== "dsp";

  const load = useCallback(async () => {
    if (!visible) return;
    try {
      const [reg, packs, rightsPacks] = await Promise.all([
        api.getConsents(),
        packetsVisible ? api.listConsentPackets() : Promise.resolve([]),
        packetsVisible ? api.listRightsPackets() : Promise.resolve([]),
      ]);
      setRegister(reg);
      setPackets(packs.filter((packet) => packet.individualId === person.id));
      setRights(rightsPacks.filter((packet) => packet.individualId === person.id));
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load consents.",
      );
    }
  }, [api, person.id, visible, packetsVisible]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!visible) {
    return <p className="msh-empty">Consents are not part of your role.</p>;
  }

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update consents.");
    } finally {
      setBusy(false);
    }
  };

  const rows = register ? consentTypeRows(register, person.id, session.roleKey) : [];
  const rightsSummary = rightsPacketSummary(rights);
  const rightsPrintable = rightsSummary.latest ?? rightsSummary.awaiting;

  const beginRightsComplete = (packet: RightsPacket, paper: boolean) => {
    setRightsCompleting({ packet, paper });
    setRightsFile(undefined);
    setRightsCompletion({
      ...emptyRightsCompletion(),
      signer: { ...emptyRightsCompletion().signer, printedName: packet.signerName },
    });
  };

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ Back
      </button>
      <PersonHeader person={person} onOpenChart={onOpenChart} />

      {packetsVisible && (
        <>
          <h3 className="msh-pass-title">Rights packet</h3>
          <div className="msh-list">
            <div className="msh-row static">
              <span className="msh-row-main">
                <strong>{rightsSummary.trackingText}</strong>
                {rightsSummary.latest ? (
                  <>
                    <small>
                      Packet date {rightsSummary.packetOn} · Renews{" "}
                      {rightsSummary.renewalOn}
                    </small>
                    <small>
                      Rights reviewed with the signer by{" "}
                      {rightsSummary.latest.reviewedBy}. Signed by{" "}
                      {rightsSummary.latest.signer?.printedName}; authority{" "}
                      {rightsSummary.latest.signer?.authority}
                      {rightsSummary.latest.signer?.authorityOther
                        ? `: ${rightsSummary.latest.signer.authorityOther}`
                        : ""}
                      ; witness {rightsSummary.latest.signer?.witness}.
                    </small>
                    <small>
                      Status:{" "}
                      {rightsSummary.latest.status === "filed"
                        ? "Signed paper copy filed"
                        : "Signed"}
                      .
                    </small>
                  </>
                ) : (
                  <small>
                    {rightsSummary.awaiting
                      ? `A packet is started and awaiting signature. Expected signer ${rightsSummary.awaiting.signerName}.`
                      : "No completed rights packet on file."}
                  </small>
                )}
                {rightsSummary.history.map((packet) => (
                  <small key={packet.id}>{rightsHistoryLine(packet)}</small>
                ))}
                <span className="msh-row-actions">
                  {rightsPrintable && (
                    <>
                      <button
                        type="button"
                        className="msh-chip-button"
                        onClick={() =>
                          downloadBlob(
                            "Rights packet.pdf",
                            buildRightsPacketPdf(
                              rightsPrintable,
                              person.name,
                              session.agencyName,
                            ).output("blob") as Blob,
                          )
                        }
                      >
                        Download packet
                      </button>
                      <button
                        type="button"
                        className="msh-chip-button"
                        onClick={() =>
                          void openPrintable(
                            "Rights packet.pdf",
                            buildRightsPacketPdf(
                              rightsPrintable,
                              person.name,
                              session.agencyName,
                            ).output("blob") as Blob,
                            "print",
                          )
                        }
                      >
                        Print packet
                      </button>
                    </>
                  )}
                  {rightsSummary.latest?.status === "filed" && (
                    <button
                      type="button"
                      className="msh-chip-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const evidence = await api.getRightsPacketEvidence(
                            rightsSummary.latest!.id,
                          );
                          downloadBlob(evidence.name, evidenceBlob(evidence));
                        })
                      }
                    >
                      Download filed signed evidence
                    </button>
                  )}
                  {manage && rightsSummary.awaiting && (
                    <>
                      <button
                        type="button"
                        className="msh-chip-button"
                        disabled={busy}
                        onClick={() => beginRightsComplete(rightsSummary.awaiting!, false)}
                      >
                        Record signature
                      </button>
                      <button
                        type="button"
                        className="msh-chip-button"
                        disabled={busy}
                        onClick={() => beginRightsComplete(rightsSummary.awaiting!, true)}
                      >
                        File signed paper copy
                      </button>
                    </>
                  )}
                  {manage && !rightsSummary.awaiting && (
                    <button
                      type="button"
                      className="msh-chip-button"
                      disabled={busy}
                      onClick={() => {
                        setRightsStart(true);
                        setRightsSignerName("");
                      }}
                    >
                      Start a new Rights packet
                    </button>
                  )}
                </span>
                {manage && rightsStart && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await api.createRightsPacket({
                          individualId: person.id,
                          signerName: rightsSignerName,
                        });
                        setRightsStart(false);
                      });
                    }}
                  >
                    <label className="msh-field">
                      <span>Expected signer</span>
                      <input
                        required
                        value={rightsSignerName}
                        onChange={(event) => setRightsSignerName(event.target.value)}
                      />
                    </label>
                    <span className="msh-form-actions">
                      <button
                        type="button"
                        className="msh-button secondary"
                        onClick={() => setRightsStart(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="msh-button primary"
                        disabled={busy}
                      >
                        Start packet
                      </button>
                    </span>
                  </form>
                )}
              </span>
            </div>
          </div>
        </>
      )}

      <h3 className="msh-pass-title">Consents and version history</h3>
      <p className="msh-section-note">
        Signed versions stay on the Individual&rsquo;s chart. Renewing adds
        a version; revoking records who, when, and why — both stay on the
        desktop chart for now.
      </p>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {!register && !error && <p className="msh-empty">Loading consents…</p>}
      {register && (
        <div className="msh-list">
          {rows.map((row) => (
            <div key={row.type.id} className="msh-row static">
              <span className="msh-row-main">
                <strong>
                  {row.type.label}
                  {row.type.required ? " (required)" : ""}
                </strong>
                <small className="msh-status-text">
                  {row.status} · {row.decision}
                </small>
                <small>Expiry/review: {row.reviewOn ?? "—"}</small>
                <button
                  type="button"
                  className="msh-text-button"
                  aria-expanded={openHistory === row.type.id}
                  onClick={() =>
                    setOpenHistory(openHistory === row.type.id ? null : row.type.id)
                  }
                >
                  {row.historyLabel}
                </button>
                {openHistory === row.type.id &&
                  (row.history.length === 0 ? (
                    <small>No versions on file.</small>
                  ) : (
                    row.history.map((record) => (
                      <span key={record.id} className="msh-record-version">
                        <small>
                          <strong>
                            {consentRecordStatus(register, record)}
                          </strong>{" "}
                          · Version {record.id}
                        </small>
                        <small>{record.covers}</small>
                        {record.outcome && (
                          <small>
                            Recorded choice: {record.outcome}
                            {["no", "none"].includes(record.outcome)
                              ? " — Permission not given"
                              : ""}
                          </small>
                        )}
                        <small>
                          Given by {record.giverName} — {record.giver};{" "}
                          {record.relationship}
                        </small>
                        <small>
                          Signed {record.signedOn || "Not signed"}; effective{" "}
                          {record.effectiveOn}; expiry/review {record.reviewOn}
                        </small>
                        <small>
                          Recorded by {record.createdBy};{" "}
                          {record.activatedAt
                            ? `activated ${record.activatedAt.slice(0, 10)} by ${record.activatedBy ?? record.giverName}`
                            : "Draft"}
                        </small>
                        {record.supersedesId && (
                          <small>Renews version {record.supersedesId}</small>
                        )}
                        {register.revocations
                          .filter((rev) => rev.consentId === record.id)
                          .map((rev) => (
                            <small key={rev.consentId}>
                              Revoked {rev.revokedOn} by {rev.revokedByName}:{" "}
                              {rev.reason}
                            </small>
                          ))}
                      </span>
                    ))
                  ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {packetsVisible && (
        <>
          <h3 className="msh-pass-title">Consent packets</h3>
          <p className="msh-section-note">
            Share a secure signing link directly with the signer, or file a
            signed paper copy. Issuing a replacement link closes the
            previous link. New packets are prepared on the desktop chart.
          </p>
          {link && (
            <div className="msh-record-card" role="status">
              <p>
                Signing link issued. Share it only with the intended
                signer; anyone holding it can sign this packet until it
                expires.
              </p>
              <label className="msh-field">
                <span>Secure signing link</span>
                <input readOnly value={link} />
              </label>
              <div className="msh-form-actions">
                <button
                  type="button"
                  className="msh-button secondary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(link)
                      .catch(() => setError("Copy the signing link from the field."))
                  }
                >
                  Copy signing link
                </button>
                <button
                  type="button"
                  className="msh-button secondary"
                  onClick={() => setLink("")}
                >
                  Hide link
                </button>
              </div>
            </div>
          )}
          {packets.length === 0 && (
            <p className="msh-empty">No packets for {person.name} yet.</p>
          )}
          <div className="msh-list">
            {packets.map((packet) => (
              <div key={packet.id} className="msh-row static">
                <span className="msh-row-main">
                  <strong>
                    {packetStatus(packet)}
                    {packetOutstanding(packet) ? " — Outstanding" : ""}
                  </strong>
                  <small>
                    Expected signer {packet.snapshot.signerName}. Follow up
                    after {packet.outstandingAfterDays} days.
                  </small>
                  <small>
                    Generated {packet.generatedAt?.slice(0, 10) ?? "—"}; sent{" "}
                    {packet.sentAt?.slice(0, 10) ?? "—"}; opened{" "}
                    {packet.openedAt?.slice(0, 10) ?? "—"}; signed{" "}
                    {packet.signedAt?.slice(0, 10) ?? "—"}; filed{" "}
                    {packet.filedAt?.slice(0, 10) ?? "—"}
                  </small>
                  {packet.signer && (
                    <small>
                      Signed by {packet.signer.printedName}; authority{" "}
                      {packet.signer.authority} {packet.signer.authorityOther};
                      witness {packet.signer.witness}; date{" "}
                      {packet.signer.signedOn}.
                    </small>
                  )}
                  {packet.audit && packet.audit.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="msh-text-button"
                        aria-expanded={openAudit === packet.id}
                        onClick={() =>
                          setOpenAudit(openAudit === packet.id ? null : packet.id)
                        }
                      >
                        Packet audit trail
                      </button>
                      {openAudit === packet.id &&
                        packet.audit.map((entry, index) => (
                          <small key={index}>
                            {entry.event} — {entry.at.slice(0, 10)}
                            {entry.signerName
                              ? ` — ${entry.signerName}; ${entry.authority ?? ""}`
                              : ""}
                          </small>
                        ))}
                    </>
                  )}
                  <span className="msh-row-actions">
                    {manage && packet.status === "draft" && (
                      <button
                        type="button"
                        className="msh-chip-button"
                        disabled={busy}
                        onClick={() =>
                          void run(() => api.generateConsentPacket(packet.id))
                        }
                      >
                        Generate packet
                      </button>
                    )}
                    {packet.generatedAt && (
                      <>
                        <button
                          type="button"
                          className="msh-chip-button"
                          onClick={() =>
                            downloadBlob(
                              "Consent packet.pdf",
                              buildConsentPacketPdf(
                                packet.snapshot,
                                packet.choices,
                                packet.signer,
                              ).output("blob") as Blob,
                            )
                          }
                        >
                          Download packet
                        </button>
                        <button
                          type="button"
                          className="msh-chip-button"
                          onClick={() =>
                            void openPrintable(
                              "Consent packet.pdf",
                              buildConsentPacketPdf(
                                packet.snapshot,
                                packet.choices,
                                packet.signer,
                              ).output("blob") as Blob,
                              "print",
                            )
                          }
                        >
                          Print packet
                        </button>
                      </>
                    )}
                    {manage && packet.generatedAt && !packet.signedAt && (
                      <>
                        <label className="msh-field">
                          <span>Signing link expires in days</span>
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={expiry}
                            onChange={(event) => setExpiry(Number(event.target.value))}
                          />
                        </label>
                        <button
                          type="button"
                          className="msh-chip-button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const token = await api.sendConsentPacket(
                                packet.id,
                                expiry,
                              );
                              setLink(
                                `${window.location.origin}${window.location.pathname}#/consent-sign/${token}`,
                              );
                            })
                          }
                        >
                          Issue secure link for sharing
                        </button>
                        <button
                          type="button"
                          className="msh-chip-button"
                          disabled={busy}
                          onClick={() => {
                            setPaper(packet);
                            setChoices({});
                            setFile(undefined);
                            setSigner({
                              printedName: "",
                              authority: "Self",
                              authorityOther: "",
                              signature: "",
                              witness: "",
                              signedOn: todayStamp(),
                              accepted: false,
                            });
                          }}
                        >
                          File signed paper copy
                        </button>
                      </>
                    )}
                    {packet.signedAt && (
                      <button
                        type="button"
                        className="msh-chip-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const evidence = await api.getConsentPacketEvidence(
                              packet.id,
                            );
                            downloadBlob(evidence.name, evidenceBlob(evidence));
                          })
                        }
                      >
                        Download filed signed evidence
                      </button>
                    )}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {paper && (
        <>
          <button
            type="button"
            className="msh-sheet-backdrop"
            aria-label="Close paper packet form"
            onClick={() => setPaper(null)}
          />
          <div className="msh-sheet msh-packet-sheet" role="dialog" aria-label="File signed paper packet">
            <h3 className="msh-sheet-title">
              Confirm paper packet choices and signatures
            </h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!file || busy) return;
                void run(async () => {
                  await api.filePaperConsentPacket(paper.id, choices, signer, file);
                  setPaper(null);
                });
              }}
            >
              <PacketForm
                paper
                snapshot={paper.snapshot}
                choices={choices}
                signer={signer}
                onChoices={setChoices}
                onSigner={setSigner}
              />
              <label className="msh-field">
                <span>Signed copy (PDF, PNG, JPEG; up to 10 MB)</span>
                <input
                  required
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(event) => setFile(event.target.files?.[0])}
                />
              </label>
              {error && (
                <p className="msh-alert" role="alert">
                  {error}
                </p>
              )}
              <div className="msh-form-actions">
                <button
                  type="button"
                  className="msh-button secondary"
                  onClick={() => setPaper(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="msh-button primary"
                  disabled={busy || !file}
                >
                  File signed packet
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {rightsCompleting && (
        <>
          <button
            type="button"
            className="msh-sheet-backdrop"
            aria-label="Close rights packet form"
            onClick={() => setRightsCompleting(null)}
          />
          <div className="msh-sheet msh-packet-sheet" role="dialog" aria-label="Complete rights packet">
            <h3 className="msh-sheet-title">
              {rightsCompleting.paper
                ? "File the signed paper Rights packet"
                : "Record the Rights packet signature"}
            </h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (busy) return;
                void run(async () => {
                  if (rightsCompleting.paper) {
                    if (!rightsFile)
                      throw new Error("Attach the signed copy.");
                    await api.filePaperRightsPacket(
                      rightsCompleting.packet.id,
                      rightsCompletion,
                      rightsFile,
                    );
                  } else {
                    await api.signRightsPacket(
                      rightsCompleting.packet.id,
                      rightsCompletion,
                    );
                  }
                  setRightsCompleting(null);
                });
              }}
            >
              <RightsPacketForm
                paper={rightsCompleting.paper}
                value={rightsCompletion}
                onChange={setRightsCompletion}
              />
              {rightsCompleting.paper && (
                <label className="msh-field">
                  <span>Signed copy (PDF, PNG, JPEG; up to 10 MB)</span>
                  <input
                    required
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    onChange={(event) => setRightsFile(event.target.files?.[0])}
                  />
                </label>
              )}
              {error && (
                <p className="msh-alert" role="alert">
                  {error}
                </p>
              )}
              <div className="msh-form-actions">
                <button
                  type="button"
                  className="msh-button secondary"
                  onClick={() => setRightsCompleting(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="msh-button primary"
                  disabled={busy || (rightsCompleting.paper && !rightsFile)}
                >
                  {rightsCompleting.paper ? "File signed packet" : "Complete packet"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
