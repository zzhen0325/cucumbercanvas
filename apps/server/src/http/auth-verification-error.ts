import type { FastifyReply } from "fastify";

import { applicationErrorResponseSchema } from "@cucumber/shared";

import { AuthVerificationUnavailableError } from "../supabase/user.js";

export function sendAuthVerificationUnavailable(
  error: unknown,
  reply: FastifyReply,
): boolean {
  if (!(error instanceof AuthVerificationUnavailableError)) {
    return false;
  }

  reply.code(503).send(
    applicationErrorResponseSchema.parse({
      error: {
        code: "service_unavailable",
        message:
          "Authentication service is temporarily unavailable. Check local certificate trust or configure server-side JWT verification.",
      },
    }),
  );
  return true;
}
