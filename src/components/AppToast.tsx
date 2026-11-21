import {
  Toast,
  ToastClose,
  ToastRegion,
  ToastTitle,
  createToaster,
} from "@ui-sdk/react/toast";
import { CheckCheck, X } from "lucide-react";

export type ToastVariant = "success" | "error" | "info" | "warning" | "default";

// One shared queue behind showToast(): the SDK stacks calls, so a second
// message waits behind the first instead of replacing it (the hand-rolled
// toast's single string did). The 4,500 ms duration is the hand-rolled
// toast's own auto-dismiss, preserved.
const toaster = createToaster({ duration: 4500 });

export const appToaster = toaster;

export interface ShowToastOptions {
  variant?: ToastVariant;
  duration?: number;
}

export function showToast(
  message: string,
  options: ShowToastOptions = {},
): string {
  const { variant = "success", duration } = options;
  const opts = duration === undefined ? undefined : { duration };
  switch (variant) {
    case "error":
      return toaster.error(message, opts);
    case "info":
      return toaster.info(message, opts);
    case "warning":
      return toaster.warning(message, opts);
    case "default":
      return toaster(message, opts);
    case "success":
    default:
      return toaster.success(message, opts);
  }
}

export function dismissToast(id?: string): void {
  toaster.dismiss(id);
}

// Mount once per app shell. The markup reuses the hand-rolled toast's
// exact structure and classes (.toast, its CheckCheck icon, and the
// "Dismiss notification" close button), so a single toast renders with
// the same computed styles as before; the region only adds stacking.
export function ToastHost() {
  return (
    <ToastRegion
      toaster={toaster}
      className="toast-region"
      aria-label="Notifications"
      maxVisible={3}
      expanded
    >
      {() => (
        <Toast className="toast">
          <CheckCheck size={18} />
          <ToastTitle />
          <ToastClose aria-label="Dismiss notification">
            <X size={14} />
          </ToastClose>
        </Toast>
      )}
    </ToastRegion>
  );
}
