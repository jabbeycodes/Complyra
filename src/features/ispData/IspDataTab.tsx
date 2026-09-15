import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  ClipboardList,
  LayoutGrid,
  NotebookPen,
  ScrollText,
} from "lucide-react";
import { Empty } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import ShiftNoteForm from "./ShiftNoteForm";
import PlanSetup from "./PlanSetup";
import ShiftBoard from "./ShiftBoard";
import ShiftAssignments from "./ShiftAssignments";
import MonthlyWorkspace from "./MonthlyWorkspace";
import type { IspNote } from "../../data/types";
import "./ispData.css";

type IspSubView = "notes" | "schedule" | "board" | "plan" | "monthly";

const SUB_VIEWS: { id: IspSubView; label: string; icon: typeof NotebookPen }[] =
  [
    { id: "notes", label: "Shift notes", icon: NotebookPen },
    { id: "schedule", label: "Scheduling", icon: CalendarClock },
    { id: "board", label: "Shift board", icon: LayoutGrid },
    { id: "plan", label: "Plan setup", icon: ClipboardList },
    { id: "monthly", label: "Monthly reports", icon: ScrollText },
  ];

export default function IspDataTab({ siteId }: { siteId: string }) {
  const { session, workspace } = useData();
  const [view, setView] = useState<IspSubView>("notes");
  const [individualId, setIndividualId] = useState("");
  const [lastSubmitted, setLastSubmitted] = useState<IspNote | null>(null);

  const site = useMemo(
    () => (workspace?.sites ?? []).find((s) => s.id === siteId),
    [workspace, siteId],
  );
  const individuals = useMemo(
    () => (workspace?.individuals ?? []).filter((i) => i.siteId === siteId),
    [workspace, siteId],
  );
  const siteStaff = useMemo(
    () =>
      (workspace?.staff ?? [])
        .filter((s) => s.siteId === siteId)
        .map((s) => ({ id: s.id, name: s.name })),
    [workspace, siteId],
  );
  const individual = individuals.find((i) => i.id === individualId);
  const canManagePlan = !!session && can(session, "isp.manage_plan");

  useEffect(() => {
    if (!individualId && individuals.length > 0) {
      setIndividualId(individuals[0].id);
    }
  }, [individuals, individualId]);

  const visibleViews = SUB_VIEWS.filter(
    (v) => v.id !== "plan" || canManagePlan,
  );

  return (
    <div className="isp-wrap">
      <div className="isp-picker-row">
        <label>
          Individual
          <select
            value={individualId}
            onChange={(e) => {
              setIndividualId(e.target.value);
              setLastSubmitted(null);
            }}
            aria-label="Individual"
          >
            {individuals.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        {view === "monthly" && individual && (
          <span className="isp-hint" style={{ alignSelf: "center" }}>
            Monthly reports are per individual.
          </span>
        )}
      </div>

      <div className="isp-subnav" role="tablist" aria-label="ISP data views">
        {visibleViews.map((v) => {
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
            >
              <Icon size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
              {v.label}
            </button>
          );
        })}
      </div>

      {individuals.length === 0 ? (
        <Empty
          title="No individuals"
          text="No one is placed at this home yet."
        />
      ) : (
        <>
          {view === "notes" && individual && (
            <>
              {lastSubmitted && (
                <div
                  className="isp-panel"
                  style={{ borderColor: "#3f5c3b" }}
                  role="status"
                >
                  <strong style={{ color: "#3f5c3b" }}>
                    Note submitted{lastSubmitted.status === "late" ? " (late)" : ""}.
                  </strong>{" "}
                  {lastSubmitted.workDate} · {lastSubmitted.serviceTitle}
                </div>
              )}
              <ShiftNoteForm
                key={individual.id}
                siteId={siteId}
                individualId={individual.id}
                individualName={individual.name}
                individualDob={individual.dateOfBirth}
                onSubmitted={setLastSubmitted}
              />
            </>
          )}

          {view === "schedule" && (
            <ShiftAssignments
              siteId={siteId}
              siteName={site?.name ?? "Home"}
              siteStaff={siteStaff}
            />
          )}

          {view === "board" && (
            <ShiftBoard siteId={siteId} siteName={site?.name ?? "Home"} />
          )}

          {view === "plan" && canManagePlan && individual && (
            <PlanSetup
              key={individual.id}
              individualId={individual.id}
              individualName={individual.name}
              siteStaff={siteStaff}
            />
          )}

          {view === "monthly" && individual && session && (
            <MonthlyWorkspace
              key={individual.id}
              individualId={individual.id}
              individualName={individual.name}
              agencyName={session.agencyName}
            />
          )}
        </>
      )}
    </div>
  );
}
