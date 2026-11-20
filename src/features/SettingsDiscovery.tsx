/**
 * Settings discovery section (agency-admin slice 4): signposts from the
 * Settings page to the agency-level editors that live elsewhere (see
 * settingsDiscovery.ts for the gates). Renders nothing when the session
 * qualifies for no link. Rows follow the Settings page's settings-row
 * pattern; the buttons only navigate — each target re-checks its own
 * gate when it renders.
 */
import { ArrowUpRight } from "lucide-react";
import type { SessionUser } from "../data/types";
import {
  settingsDiscoveryLinks,
  type SettingsDiscoveryTarget,
} from "./settingsDiscovery";

export function SettingsDiscoverySection({
  session,
  onOpen,
}: {
  session: SessionUser;
  onOpen: (target: SettingsDiscoveryTarget) => void;
}) {
  const links = settingsDiscoveryLinks(session);
  if (links.length === 0) return null;
  return (
    <>
      <div className="settings-row">
        <span>
          <strong>Agency configuration</strong>
          <small>
            Some agency settings live with the teams who use them. These
            links open the existing editors — nothing here changes who can
            edit what.
          </small>
        </span>
      </div>
      {links.map((link) => (
        <div
          className="settings-row"
          key={link.id}
          data-discovery-link={link.id}
        >
          <span>
            <strong>{link.label}</strong>
            <small>{link.description}</small>
          </span>
          <button
            className="button"
            onClick={() => onOpen(link.target)}
            aria-label={`Open ${link.label}`}
          >
            Open <ArrowUpRight size={16} />
          </button>
        </div>
      ))}
    </>
  );
}
