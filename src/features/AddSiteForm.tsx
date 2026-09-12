import { useState } from "react";
import { useData } from "../data/DataProvider";

const DEFAULT_PROGRAMS = ["Residential services", "Supported living"];

export default function AddSiteForm({
  onCreated,
}: {
  onCreated?: (name: string) => void;
}) {
  const { api, workspace, refresh } = useData();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [programName, setProgramName] = useState(DEFAULT_PROGRAMS[0]);
  const [managerUserId, setManagerUserId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const programs = Array.from(
    new Set([
      ...DEFAULT_PROGRAMS,
      ...(workspace?.sites.map((site) => site.program).filter(Boolean) ?? []),
    ]),
  );
  const managers =
    workspace?.staff.filter((member) =>
      ["house_manager", "administrator", "degreed_professional_manager"].includes(
        member.roleKey,
      ),
    ) ?? [];

  return (
    <form
      className="setup-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api.createSite({
            name,
            address,
            programName,
            managerUserId: managerUserId || null,
          });
          await refresh();
          onCreated?.(name.trim());
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <p className="form-help">
        Add a home or program site first. People and PCSPs attach to a site.
      </p>
      <label className="form-label">
        Site name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Willow House"
          required
        />
      </label>
      <label className="form-label">
        Address
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Street, city, state"
          required
        />
      </label>
      <label className="form-label">
        Program
        <select
          value={programName}
          onChange={(e) => setProgramName(e.target.value)}
        >
          {programs.map((program) => (
            <option key={program}>{program}</option>
          ))}
        </select>
      </label>
      <label className="form-label">
        House manager (optional)
        <select
          value={managerUserId}
          onChange={(e) => setManagerUserId(e.target.value)}
        >
          <option value="">Assign later</option>
          {managers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" type="submit" disabled={busy}>
        Create site
      </button>
    </form>
  );
}
