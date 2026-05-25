import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

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
