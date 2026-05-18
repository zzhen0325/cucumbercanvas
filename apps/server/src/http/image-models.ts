import type { FastifyInstance } from "fastify";

import { getAvailableImageModels } from "../generation/providers/registry.js";

export async function registerImageModelRoutes(app: FastifyInstance) {
  app.get("/api/image-models", async (request, reply) => {
    const models = getAvailableImageModels();

    const annotated = models.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      description: m.description,
      iconUrl: m.iconUrl,
      provider: m.provider,
      accessible: true,
    }));

    return reply.code(200).send({ models: annotated });
  });
}
