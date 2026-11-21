import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  createConfirm,
} from "@ui-sdk/react/alert-dialog";

export interface ConfirmDialogOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

// One shared confirm behind confirmDialog(): the SDK queues calls, so
// questions are asked one at a time and each promise resolves once —
// true only for the confirm answer; Cancel and Escape resolve false.
const ask = createConfirm<ConfirmDialogOptions>();

export function confirmDialog(
  options: ConfirmDialogOptions,
): Promise<boolean> {
  return ask(options);
}

// Mount once per app shell. The markup reuses the shared Modal's classes
// and structure, so a confirm looks like every other platform dialog.
export function ConfirmDialogHost() {
  return (
    <AlertDialog controller={ask.controller}>
      <AlertDialogBackdrop className="modal-backdrop" />
      <AlertDialogContent<ConfirmDialogOptions> className="modal">
        {(state) => {
          const request = state.payload;
          if (!request) return null;
          return (
            <>
              <div className="modal-head">
                <AlertDialogTitle>{request.title}</AlertDialogTitle>
              </div>
              <div className="modal-body">
                {request.body ? (
                  <AlertDialogDescription className="confirm-body">
                    {request.body}
                  </AlertDialogDescription>
                ) : null}
                <div className="confirm-actions">
                  <AlertDialogClose className="button">
                    {request.cancelLabel ?? "Cancel"}
                  </AlertDialogClose>
                  <AlertDialogClose className="button primary" value="confirm">
                    {request.confirmLabel ?? "OK"}
                  </AlertDialogClose>
                </div>
              </div>
            </>
          );
        }}
      </AlertDialogContent>
    </AlertDialog>
  );
}
