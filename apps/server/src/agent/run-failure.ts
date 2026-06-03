import type { StreamEvent } from "@cucumber/shared";

import { describeErrorForClient } from "../utils/error-sanitizer.js";

type RunFailureSource = "run-event-pump" | "runtime" | "stream-adapter";

type CreateRunFailedEventOptions = {
  error: unknown;
  now: () => string;
  runId: string;
  source: RunFailureSource;
};

/**
 * Centralizes failed-run event creation so every stream path sends the same
 * client-safe shape and leaves enough server-side breadcrumbs for diagnosis.
 */
export function createRunFailedEvent({
  error,
  now,
  runId,
  source,
}: CreateRunFailedEventOptions): StreamEvent {
  const clientError = describeErrorForClient(error);
  const errorName = error instanceof Error ? error.name : typeof error;

  console.error(`[${source}] Agent run failed for run ${runId}:`, error);
  console.info(
    `[${source}] Emitting run.failed`,
    JSON.stringify({
      errorName,
      message: clientError.message,
      reason: clientError.details.reason,
      runId,
    }),
  );

  return {
    error: {
      code: "run_failed",
      details: {
        ...clientError.details,
        errorName,
        source,
      },
      message: clientError.message,
    },
    runId,
    timestamp: now(),
    type: "run.failed",
  };
}
