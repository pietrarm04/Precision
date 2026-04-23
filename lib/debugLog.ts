import { appendFileSync } from "node:fs";

type DebugPayload = {
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
  timestamp: number;
};

export function appendDebugLog(payload: DebugPayload): void {
  // #region agent log
  appendFileSync(
    "/opt/cursor/logs/debug.log",
    `${JSON.stringify({
      hypothesisId: payload.hypothesisId,
      location: payload.location,
      message: payload.message,
      data: payload.data,
      timestamp: payload.timestamp,
    })}\n`,
  );
  // #endregion
}
