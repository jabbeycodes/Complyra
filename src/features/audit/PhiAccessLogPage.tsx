import { useCallback, useEffect, useState } from "react";
import { PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import type { PhiAccessAction, PhiAccessRecord } from "../../data/types";
import type { StepUpReason } from "../../security/useStepUp";

const ACTIONS: Array<"" | PhiAccessAction> = ["", "view", "create", "update", "delete", "export"];

const RECORD_TYPES = [
  "",
  "individuals",
  "individual_profiles",
  "chart_files",
  "medications",
  "medication_deliveries",
  "med_dose_exceptions",
  "prn_dose_logs",
  "med_inventory",
  "training_checklists",
  "training_signoffs",
  "training_countersignatures",
  "training_requirements",
  "staff_certificates",
  "obligations",
  "obligation_signatures",
  "delegation_acknowledgments",
  "delegation_training_materials",
  "individual_delegation_assignments",
  "documents",
  "document_uploads",
  "home_safety_reports",
  "site_reviews",
  "emergency_drills",
  "hm_weekly_checklists",
  "mileage_trips",
  "hm_dsp_reviews",
  "adaptive_equipment",
  "equipment_month_logs",
  "clinical_renewals",
  "site_facts",
];

/**
 * HIPAA application-level PHI audit trail: who accessed what, when, and how.
 * Filtered by staff member, action, record type, and date range. Reads are
 * RLS-gated to administrator / compliance_admin / auditor; exporting the
 * filtered log itself requires step-up reauthentication and is logged.
 */
export default function PhiAccessLogPage({
  staff,
  requireStepUp,
  notify,
}: {
  staff: Array<{ id: string; name: string }>;
  requireStepUp: (reason: StepUpReason) => Promise<boolean>;
  notify: (message: string) => void;
}) {
  const { api, session } = useData();
  const [rows, setRows] = useState<PhiAccessRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState<"" | PhiAccessAction>("");
  const [recordType, setRecordType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.listPhiAccessLog({
        userId: userId || undefined,
        action: action || undefined,
        recordType: recordType || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        limit: 200,
      });
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the access log.");
    } finally {
      setLoading(false);
    }
  }, [api, userId, action, recordType, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const staffName = useCallback(
    (id: string | null) =>
      staff.find((s) => s.id === id)?.name ?? (id ? id.slice(0, 8) : "—"),
    [staff],
  );

  async function exportCsv() {
    if (!(await requireStepUp("export"))) return;
    const header = "time,user,action,record type,record id,individual id,ip,device";
    const lines = rows.map((r) =>
      [
        r.createdAt,
        `"${staffName(r.userId).replaceAll('"', '""')}"`,
        r.action,
        r.recordType,
        r.recordId,
        r.individualId ?? "",
        r.ipAddress ?? "",
        r.deviceId ?? "",
      ].join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `complyrer-phi-access-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify("The filtered access log has been downloaded.");
    // The export itself is a data export: record it.
    void api
      .logPhiAccess({
        action: "export",
        recordType: "phi_access_log",
        recordId: "filtered-export",
        agencyId: session?.agencyId ?? null,
        details: { filters: { userId, action, recordType, from, to }, rows: rows.length },
      })
      .catch(() => {});
  }

  return (
    <>
      <PageHeading
        eyebrow="WHO SAW WHAT."
        title="A clear record of record access."
        description="Every view, change, and export of individual-related records — who, what, and when. Views and exports are reported by the app; creates, updates, and deletes are written automatically by the database."
      >
        <button type="button" className="button" onClick={() => void exportCsv()}>
          Export filtered log
        </button>
      </PageHeading>

      <section className="panel audit-filters">
        <label>
          Staff
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Everyone</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select value={action} onChange={(e) => setAction(e.target.value as "" | PhiAccessAction)}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a === "" ? "All actions" : a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Record type
          <select value={recordType} onChange={(e) => setRecordType(e.target.value)}>
            {RECORD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "" ? "All types" : t}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="button primary" onClick={() => void load()}>
          Apply filters
        </button>
      </section>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">Loading the access log…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No access events match these filters.</p>
      ) : (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Record</th>
                <th>IP</th>
                <th>Device</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{staffName(r.userId)}</td>
                  <td>{r.action}</td>
                  <td>
                    {r.recordType}
                    <span className="muted"> · {r.recordId.slice(0, 8)}</span>
                  </td>
                  <td>{r.ipAddress ?? "—"}</td>
                  <td>{r.deviceId ? r.deviceId.slice(0, 8) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
