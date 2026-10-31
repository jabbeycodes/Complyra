import { useState } from "react";
import type { OperatorAgency } from "../../data/operator";
import { useData } from "../../data/DataProvider";
export default function AgencyLifecycleControl({ agency, onSaved }: { agency: OperatorAgency; onSaved: () => void }) {
 const { api, session } = useData(); const [reason,setReason]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 const next=agency.status === "active" ? "suspended" : agency.status === "suspended" ? "active" : null;
 if (!session?.platformAdmin || !next || agency.agencyCode === "COMPLYRER-MO") return null;
 return <section aria-label="Agency lifecycle"><h3>{next === "suspended" ? "Suspend agency access" : "Reactivate agency"}</h3>
 <p>Suspension blocks tenant data access for existing sessions. It does not delete records or cancel a subscription.</p>
 <form onSubmit={async(e)=>{e.preventDefault();setBusy(true);setError("");try {await api.setAgencyStatus(agency.id,next,reason,agency.status);setReason("");onSaved();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
 <label className="form-label">Reason (required)<input required maxLength={1000} value={reason} onChange={(e)=>setReason(e.target.value)} /></label>
 <button className="button" disabled={busy || !reason.trim()}>{busy ? "Updating…" : next === "suspended" ? "Confirm suspension" : "Confirm reactivation"}</button>
 {error && <p role="alert">{error}</p>}</form></section>;
}
