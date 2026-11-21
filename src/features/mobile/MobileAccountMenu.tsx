import { LogOut, Monitor } from "lucide-react";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@ui-sdk/react/menu";

/**
 * The mobile shell's account menu, on @ui-sdk/react's Menu
 * (UI SDK slice 6). The hand-rolled version was a trigger button
 * with manual aria-haspopup/aria-expanded wiring, a transparent
 * fixed backdrop button for outside-press dismissal, and a
 * role="menu" div whose items were plain buttons: no Escape, no
 * arrow keys, no focus movement at all. This wrapper keeps the
 * house markup and classes — `.msh-avatar-button` on the trigger,
 * `.msh-menu` on the content, the `.msh-menu-head` paragraph and
 * the item buttons the mobile stylesheet styles — and lets the
 * primitive own the popup contract.
 *
 * Two contract choices are deliberate:
 *
 * - presentation="popover" is forced. The SDK's "auto" presents a
 *   menu as a bottom sheet on small touch screens; this menu is an
 *   anchored popover in exactly that context and must stay one.
 * - modal stays at its default ("pointer"): an outside press
 *   closes the menu and is consumed, which is precisely what the
 *   old backdrop button did — a press on the bell or a nav tile
 *   while the menu is open closes the menu instead of firing the
 *   element under the press. The Menu ships no backdrop part, so
 *   the backdrop button itself is gone; Escape, the trigger, and
 *   item selection are the other close paths, as before.
 *
 * Open state stays with the caller (the shell's bell button also
 * force-closes this menu when it navigates to notifications), and
 * each item keeps its old handler order: close first, then act.
 */
export default function MobileAccountMenu({
  open,
  onOpenChange,
  fullName,
  initials,
  roleLine,
  canSwitchHome,
  onSwitchHome,
  onDesktopView,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Signed-in user's full name: trigger label + menu head. */
  fullName: string;
  /** Trigger face: the initials the avatar button shows. */
  initials: string;
  /** Menu head's second line: "{role} · {agency}". */
  roleLine: string;
  /** "Switch home" shows only when there is another home (batch 59). */
  canSwitchHome: boolean;
  onSwitchHome: () => void;
  onDesktopView: () => void;
  onSignOut: () => void;
}) {
  return (
    <Menu
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      presentation="popover"
    >
      <MenuTrigger
        className="msh-avatar-button"
        aria-label={`Account menu for ${fullName}`}
      >
        {initials}
      </MenuTrigger>
      <MenuContent className="msh-menu" side="bottom" align="end" sideOffset={8}>
        <p className="msh-menu-head">
          <strong>{fullName}</strong>
          <small>{roleLine}</small>
        </p>
        {canSwitchHome && (
          <MenuItem
            render={<button type="button" />}
            onSelect={() => {
              onOpenChange(false);
              onSwitchHome();
            }}
          >
            Switch home
          </MenuItem>
        )}
        <MenuItem
          render={<button type="button" />}
          onSelect={() => {
            onOpenChange(false);
            onDesktopView();
          }}
        >
          <Monitor size={17} aria-hidden="true" /> Desktop view
        </MenuItem>
        <MenuItem
          render={<button type="button" />}
          onSelect={() => {
            onOpenChange(false);
            onSignOut();
          }}
        >
          <LogOut size={17} aria-hidden="true" /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
