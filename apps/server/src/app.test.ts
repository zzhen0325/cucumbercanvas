import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { AuthVerificationUnavailableError } from "./supabase/user.js";

describe("buildApp CORS", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("allows equivalent loopback browser origins for local development", async () => {
    const app = buildApp({
      env: {
        webOrigin: "http://localhost:3000",
      },
    });
    apps.push(app);

    const response = await app.inject({
      headers: {
        host: "localhost:3001",
        origin: "http://127.0.0.1:3000",
      },
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it("rejects loopback origins on a different frontend port", async () => {
    const app = buildApp({
      env: {
        webOrigin: "http://localhost:3000",
      },
    });
    apps.push(app);

    const response = await app.inject({
      headers: {
        host: "localhost:3001",
        origin: "http://127.0.0.1:3002",
      },
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ message: "Origin not allowed" });
  });
});

describe("buildApp auth verification errors", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("does not report remote auth verifier failures as invalid sessions", async () => {
    const app = buildApp({
      auth: {
        authenticate: async () =>
          Promise.reject(
            new AuthVerificationUnavailableError(new Error("fetch failed")),
          ),
      },
      env: {
        webOrigin: "http://localhost:3000",
      },
    });
    apps.push(app);

    const response = await app.inject({
      headers: {
        authorization: "Bearer token",
        host: "localhost:3001",
        origin: "http://localhost:3000",
      },
      method: "GET",
      url: "/api/projects",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "service_unavailable",
        message:
          "Authentication service is temporarily unavailable. Check local certificate trust or configure server-side JWT verification.",
      },
    });
  });
});
