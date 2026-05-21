/**
 * Centralized provider registration.
 *
 * Both the HTTP server (app.ts) and the background worker (worker.ts) need the
 * same set of image/video generation providers. This module is the single
 * source of truth so that adding a new provider only requires a change here.
 */
import type { ServerEnv } from "../../config/env.js";
import { registerImageProvider, registerVideoProvider } from "./registry.js";
import { SeedreamImageProvider, SeedreamVideoProvider } from "./seedream.js";

/**
 * Register all available generation providers based on the provided env config.
 *
 * Each provider is only registered when its required API key is present,
 * keeping the behaviour identical to the previous inline registration while
 * ensuring every process gets the full set.
 */
export function registerAllProviders(env: ServerEnv): void {
  if (!env.seedreamAccessKeyId || !env.seedreamSecretAccessKey) return;

  const config = {
    accessKeyId: env.seedreamAccessKeyId,
    secretAccessKey: env.seedreamSecretAccessKey,
    reqKey: env.seedreamReqKey ?? "jimeng_seedream46_cvtob",
    ...(env.seedreamVideoReqKey
      ? { videoReqKey: env.seedreamVideoReqKey }
      : {}),
    host: env.seedreamHost ?? "visual.volcengineapi.com",
    region: env.seedreamRegion ?? "cn-north-1",
    service: env.seedreamService ?? "cv",
    version: env.seedreamVersion ?? "2022-08-31",
  };

  registerImageProvider(new SeedreamImageProvider(config));
  registerVideoProvider(new SeedreamVideoProvider(config));
}
