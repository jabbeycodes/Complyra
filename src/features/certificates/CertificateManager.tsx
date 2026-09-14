import { useEffect, useState } from "react";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Modal, PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import { hasPermission } from "../../data/permissions";
import { todayIso } from "../../data/chart";
import {
  CERTIFICATE_KINDS,
  certCountdownLabel,
  daysRemaining,
} from "../../data/certificates";
import StatusBadge from "../../components/StatusBadge";
import { certificateStatus } from "../../data/complianceStatus";
import type {
  ExpiringCertificate,
  StaffCertificate,
} from "../../data/types";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";

// LIFEPATH-P4 (certificates): HR certificate management page — per-staff
// certificate lists with the days-remaining countdown, file upload + manual
// entry, edit/delete, and the agency-wide "expiring soon" panel.

// WS3 (accessible status system): the expiry verdict goes through the shared
// <StatusBadge> — icon shape + text label + color, never color alone. The
// existing days-remaining countdown stays as supporting detail text.
function CertBadge({ expiresOn }: { expiresOn: string }) {
  const remaining = daysRemaining(expiresOn);
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <StatusBadge status={certificateStatus(expiresOn)} size="sm" />
      <span className="muted">{certCountdownLabel(remaining)}</span>
    </span>
  );
}

function CertRow({
  cert,
  staffName,
  canManage,
  onDownload,
  onEdit,
  onDelete,
}: {
  cert: StaffCertificate;
  staffName?: string;
  canManage: boolean;
  onDownload: (cert: StaffCertificate) => void;
  onEdit: (cert: StaffCertificate) => void;
  onDelete: (cert: StaffCertificate) => void;
}) {
  return (
    <div className="cert-row">
      <div className="cert-row-main">
        <strong>{cert.certName}</strong>
        <CertBadge expiresOn={cert.expiresOn} />
      </div>
      <div className="cert-row-meta muted">
        {staffName && <span>{staffName} · </span>}
        <span>
          Issued {cert.issuedOn} · Renews {cert.expiresOn}
        </span>
        {cert.fileName && <span> · {cert.fileName}</span>}
      </div>
      <div className="cert-row-actions">
        {cert.filePath && (
          <button
            type="button"
            className="text-button"
            onClick={() => onDownload(cert)}
          >
            <Download size={14} /> File
          </button>
        )}
        {canManage && (
          <>
            <button
              type="button"
              className="text-button"
              onClick={() => onEdit(cert)}
            >
              <Pencil size={14} /> Edit
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => onDelete(cert)}
            >
              <Trash2 size={14} /> Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function CertificateManager() {
  const { api, session, workspace } = useData();
  const staff = workspace?.staff ?? [];
  const canManage = Boolean(
    session && hasPermission(session, "certificates.manage"),
  );

  const [staffId, setStaffId] = useState(staff[0]?.id ?? "");
  const [certs, setCerts] = useState<StaffCertificate[]>([]);
  const [expiring, setExpiring] = useState<ExpiringCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffCertificate | null>(null);

  const activeStaffId = staff.some((s) => s.id === staffId)
    ? staffId
    : (staff[0]?.id ?? "");

  async function reload() {
    if (!activeStaffId) {
      setCerts([]);
      setExpiring([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [list, soon] = await Promise.all([
        api.listCertificates(activeStaffId),
        api.certificatesExpiringSoon(90),
      ]);
      setCerts(list);
      setExpiring(soon);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStaffId]);

  async function downloadFile(cert: StaffCertificate) {
    try {
      const url = await api.certificateFileUrl(cert.id);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(cert: StaffCertificate) {
    if (
      !window.confirm(
        `Delete ${cert.certName} (renews ${cert.expiresOn})? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteCertificate(cert.id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const selectedStaff = staff.find((s) => s.id === activeStaffId);

  return (
    <div data-tour="certificates">
      <PageHeading title="Certificates" />
      {error && <p className="form-error">{error}</p>}

      <section className="panel cert-expiring-panel">
        <div className="panel-heading">
          <h2>Expiring soon</h2>
          <p>Agency-wide — every certificate renewing within 90 days.</p>
        </div>
        {loading ? (
          <p className="muted">Loading certificates…</p>
        ) : expiring.length === 0 ? (
          <p className="muted">Nothing expiring within 90 days. All clear.</p>
        ) : (
          <div className="cert-list">
            {expiring.map((cert) => (
              <CertRow
                key={cert.id}
                cert={cert}
                staffName={cert.staffName}
                canManage={false}
                onDownload={downloadFile}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading cert-heading">
          <div>
            <h2>Certificates by staff</h2>
            <p>Select a team member to view and manage their certificates.</p>
          </div>
          {canManage && activeStaffId && (
            <button
              type="button"
              className="button primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus size={16} /> Add certificate
            </button>
          )}
        </div>
        <label className="form-label">
          Team member
          <select
            value={activeStaffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.role}
              </option>
            ))}
          </select>
        </label>
        {loading ? (
          <p className="muted">Loading certificates…</p>
        ) : certs.length === 0 ? (
          <p className="muted">
            {selectedStaff
              ? `No certificates on file for ${selectedStaff.name} yet.`
              : "No staff yet."}
          </p>
        ) : (
          <div className="cert-list">
            {certs.map((cert) => (
              <CertRow
                key={cert.id}
                cert={cert}
                canManage={canManage}
                onDownload={downloadFile}
                onEdit={(c) => {
                  setEditing(c);
                  setFormOpen(true);
                }}
                onDelete={remove}
              />
            ))}
          </div>
        )}
        <ComplyrerRecordMark />
      </section>

      {formOpen && canManage && (
        <CertificateForm
          key={editing ? editing.id : "new"}
          staffName={selectedStaff?.name ?? ""}
          userId={activeStaffId}
          editing={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setFormOpen(false);
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function CertificateForm({
  staffName,
  userId,
  editing,
  onClose,
  onSaved,
}: {
  staffName: string;
  userId: string;
  editing: StaffCertificate | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api } = useData();
  const [kind, setKind] = useState(editing?.certName ?? "CPR");
  const [customName, setCustomName] = useState(
    editing && !CERTIFICATE_KINDS.includes(editing.certName as "CPR")
      ? editing.certName
      : "",
  );
  const [issuedOn, setIssuedOn] = useState(
    editing?.issuedOn ?? todayIso().slice(0, 4) + "-01-01",
  );
  const [expiresOn, setExpiresOn] = useState(
    editing?.expiresOn ?? todayIso().slice(0, 4) + "-12-31",
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isCustom = !CERTIFICATE_KINDS.includes(kind as "CPR");
  const certName = isCustom ? customName.trim() : kind;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!certName) {
      setError("Enter the certificate name.");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await api.updateCertificate(editing.id, {
          certName,
          issuedOn,
          expiresOn,
        });
      } else if (file) {
        await api.uploadCertificateFile({
          userId,
          file,
          certName,
          issuedOn,
          expiresOn,
        });
      } else {
        await api.addCertificate({ userId, certName, issuedOn, expiresOn });
      }
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        editing
          ? `Edit certificate — ${staffName}`
          : `Add certificate — ${staffName}`
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p className="form-help">
          Attach a scan of the certificate or enter the details manually —
          either way the renewal countdown starts from the renewal date.
        </p>
        <div className="form-grid">
          <label className="form-label">
            Certificate
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {CERTIFICATE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
              <option value="Other">Other…</option>
            </select>
          </label>
          {isCustom && (
            <label className="form-label">
              Certificate name
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. First Aid"
                required={isCustom}
              />
            </label>
          )}
          <label className="form-label">
            Issue date
            <input
              type="date"
              value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)}
              required
            />
          </label>
          <label className="form-label">
            Renewal date
            <input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              required
            />
          </label>
        </div>
        {!editing && (
          <label className="form-label">
            Certificate scan (optional — PDF or image, up to 10 MB)
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        )}
        {editing?.fileName && (
          <p className="form-help">
            <Upload size={14} /> {editing.fileName} is attached. Editing keeps
            the file.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add certificate"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
