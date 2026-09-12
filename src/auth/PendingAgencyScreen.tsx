import { Clock3, LogOut } from "lucide-react";
import { useData } from "../data/DataProvider";

export default function PendingAgencyScreen() {
  const { session, signOut } = useData();
  const rejected = session?.agencyStatus === "rejected";

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" />
          <span>
            complyrer<span className="brand-period">.</span>
          </span>
        </div>
        <h1>{rejected ? "This setup was not approved" : "Waiting for Complyrer review"}</h1>
        <p>
          {rejected
            ? `${session?.agencyName} (${session?.agencyCode}) was not activated. Contact Complyrer if you believe this is a mistake.`
            : `${session?.agencyName} is in the review queue. Staff can use care records after Complyrer approves ${session?.agencyCode}.`}
        </p>
        <div className="quiet-note">
          <Clock3 size={16} /> Agency score and individual records stay locked until approval.
        </div>
        <button className="button full" type="button" onClick={() => void signOut()}>
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </div>
  );
}
