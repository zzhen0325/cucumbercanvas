import type { FastifyInstance } from "fastify";

import { getAvailableVideoModels } from "../generation/providers/registry.js";

export async function registerVideoModelRoutes(app: FastifyInstance) {
  app.get("/api/video-models", async (request, reply) => {
    const models = getAvailableVideoModels();

    const annotated = models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      description: m.description,
      iconUrl: m.iconUrl,
      provider: m.provider,
      capabilities: m.capabilities,
      limits: m.limits,
      accessible: true,
    }));

    return reply.code(200).send({ models: annotated });
  });
}
