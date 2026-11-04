import { FunctionsHttpError } from "@supabase/supabase-js";

/**
 * Finding F-1: functions.invoke answers every non-2xx with a generic "Edge
 * Function returned a non-2xx status code" and leaves `data` null, so the
 * reason the server sent never reached the applicant. Read it from the
 * response body. Only the two codes the applicant can act on carry server
 * text; anything else, including a dropped connection, is the safe retry
 * message, so no raw backend error can reach the screen.
 */
export type AgencySetupErrorCode = "invalid_input" | "code_in_use" | "server_error";

export const AGENCY_SETUP_RETRY_MESSAGE =
  "We couldn’t finish setting up your agency because of a problem on our side. Please try again in a few minutes.";

export const AGENCY_SETUP_UNREACHABLE_MESSAGE =
  "We couldn’t reach Complyrer to set up your agency. Check your connection and try again.";

export class AgencySetupError extends Error {
  constructor(
    message: string,
    readonly code: AgencySetupErrorCode,
  ) {
    super(message);
    this.name = "AgencySetupError";
  }
}

export function agencySetupErrorFromBody(body: unknown): AgencySetupError {
  const { error, code } = (body ?? {}) as { error?: unknown; code?: unknown };
  if ((code === "invalid_input" || code === "code_in_use") && typeof error === "string" && error) {
    return new AgencySetupError(error, code);
  }
  return new AgencySetupError(AGENCY_SETUP_RETRY_MESSAGE, "server_error");
}

export async function agencySetupErrorFromInvoke(error: unknown): Promise<AgencySetupError> {
  if (!(error instanceof FunctionsHttpError)) {
    return new AgencySetupError(AGENCY_SETUP_UNREACHABLE_MESSAGE, "server_error");
  }
  try {
    return agencySetupErrorFromBody(JSON.parse(await (error.context as Response).text()));
  } catch {
    return new AgencySetupError(AGENCY_SETUP_RETRY_MESSAGE, "server_error");
  }
}
