import { useEffect, useMemo, useState } from "react";
import { useData } from "../../data/DataProvider";
import { filterOperatorAgencies, type OperatorAgency } from "../../data/operator";
import { createRulesStore } from "../../data/rulesStore";
import { AgencyRulesPanel } from "../AgencyRulesPanel";
import { PageHeading } from "../../components";
import AgencyLifecycleControl from "./AgencyLifecycleControl";
import "./operator.css";
export default function OperatorDirectory({ onSaved }: { onSaved: (message: string) => void }) {
  const { api, session, usingHostedBackend } = useData();
  const [rows, setRows] = useState<OperatorAgency[]>([]);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all"); const [selected, setSelected] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    if (!session?.platformAdmin) { setLoading(false); return; }
    api.operatorDirectory().then((data) => { if (!cancelled) setRows(data); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, session?.platformAdmin, reload]);
  const store = useMemo(() => createRulesStore({ userId: session?.userId ?? "", fullName: session?.fullName ?? "",
    isOperator: Boolean(session?.platformAdmin), adminOfAgencyId: null, memberOfAgencyIds: session ? [session.agencyId] : [] }), [session]);
  if (!session?.platformAdmin) return <p role="alert">Operator access required.</p>;
  const detail = rows.find((a) => a.id === selected);
  const filtered = filterOperatorAgencies(rows, query, status, category);
  return <div className="operator-console"><PageHeading title="Operator Control Center · Agencies" />
    <p>{usingHostedBackend ? "Hosted agency directory" : "Local demonstration agencies — seeded records, not production customers"}</p>
    <p>Customer reporting excludes agencies classified as demo or internal. Classification is persisted; provider provisioning source does not imply customer status.</p>
    <div className="operator-filters">
      <label>Search name, provider code or state<input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{["all", "pending", "active", "rejected", "suspended", "disabled"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label>Reporting group<select value={category} onChange={(e) => setCategory(e.target.value)}>{["all", "customer", "demo", "internal"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <button className="button" onClick={() => setReload((v) => v + 1)}>Refresh</button>
    </div>
    {loading && <p role="status">Loading agencies…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && <section className="panel"><p>{filtered.length} agencies</p><div className="table-scroll"><table>
      <thead><tr><th>Agency</th><th>Provider code</th><th>State</th><th>Status</th><th>Created</th><th>Source</th><th>Reporting</th></tr></thead>
      <tbody>{filtered.map((a) => <tr key={a.id}><td><button className="button" onClick={() => setSelected(a.id)}>{a.name}</button></td><td>{a.agencyCode}</td><td>{a.stateCode}</td><td>{a.status}{!a.active ? " · disabled" : ""}</td><td>{a.createdAt?.slice(0,10) ?? "Not recorded"}</td><td>{a.provisionedBy}</td><td>{a.reportingCategory}</td></tr>)}</tbody>
    </table></div>{!filtered.length && <p>No agencies match these filters.</p>}</section>}
    {detail && <section className="panel" aria-label="Agency detail"><h2>{detail.name} · {detail.agencyCode}</h2><p>Agency status: {detail.status}. Access: {detail.active ? "enabled" : "disabled"}.</p><button className="button" onClick={() => setSelected(null)}>Close detail</button><AgencyLifecycleControl agency={detail} onSaved={() => { setReload((v) => v+1); onSaved("Agency lifecycle updated."); }} /><AgencyRulesPanel key={detail.id} agencies={[detail]} store={store} onSaved={onSaved} /></section>}
  </div>;
}
