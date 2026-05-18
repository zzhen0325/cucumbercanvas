import { describe, expect, it } from "vitest";

import {
  createPostgresPoolConfig,
  describePostgresConnection,
  inspectPostgresConnectionString,
  normalizeSupabaseConnectionString,
} from "./postgres-connection.js";

describe("postgres connection helpers", () => {
  const poolerUrl =
    "postgresql://postgres.hklmtqyoalsktjbjvrpj:secret@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require";

  it("normalizes Supabase sslmode for pg TLS configuration", () => {
    expect(normalizeSupabaseConnectionString(poolerUrl)).toBe(
      "postgresql://postgres.hklmtqyoalsktjbjvrpj:secret@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
    );
  });

  it("adds pg tuning and application name without leaking credentials", () => {
    const config = createPostgresPoolConfig(poolerUrl, {
      application_name: "cucumber_test",
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });

    expect(config.application_name).toBe("cucumber_test");
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    expect(String(config.connectionString)).not.toContain("sslmode=require");
  });

  it("describes the connection target with a masked Supabase pooler user", () => {
    expect(describePostgresConnection(poolerUrl)).toBe(
      "host=aws-1-ap-northeast-1.pooler.supabase.com port=5432 database=postgres user=postgres.hklm...vrpj mode=supabase-pooler-session",
    );
  });

  it("flags placeholder database passwords before the worker starts polling", () => {
    const issues = inspectPostgresConnectionString(
      "postgresql://postgres.hklmtqyoalsktjbjvrpj:%3Cpassword%3E@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
    );

    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("placeholder password"),
      }),
    );
  });
});
