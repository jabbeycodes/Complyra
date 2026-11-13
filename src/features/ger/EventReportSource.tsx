import { useState, type ReactNode } from 'react';
import { Modal } from '../../components';
import { deriveGerResolutionDisplay, type GerReport } from '../../data/ger';

/** The source is passed by the already-scoped list, never fetched by an untrusted ID. */
export default function EventReportSource({report,personName,siteName,onOpenPerson,children}:{report:GerReport;personName:string;siteName:string;onOpenPerson:()=>void;children:ReactNode}) {
  const [open,setOpen]=useState(false);
  return <>
    <button type="button" className="record-row-main" onClick={()=>setOpen(true)}>{children}</button>
    {open && <Modal title="Event report source record" onClose={()=>setOpen(false)} wide>
      <h3>{report.eventType} — {personName}</h3><p>Record {report.id} · {siteName} · {report.eventDate} {report.eventTime}</p>
      <p>Status: {report.status} · Severity: {report.severity}</p><p>{report.description}</p>
      <p>Immediate actions: {report.immediateActions || 'Not recorded'}</p><p>Review: {report.reviewNote || 'Not recorded'}</p>
      <p>Follow-up: {deriveGerResolutionDisplay(report)} · due {report.resolutionDueOn || 'Not recorded'}</p>
      <p>Investigation: {report.investigationNotes || 'Not recorded'}</p><p>Closure: {report.closureNote || 'Not recorded'}</p>
      <button type="button" className="button" onClick={()=>{setOpen(false);onOpenPerson();}}>Open Individual chart</button>
    </Modal>}
  </>;
}
