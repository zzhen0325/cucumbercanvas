import type { PoolConfig } from "pg";

type PoolTuning = Pick<
  PoolConfig,
  | "application_name"
  | "connectionTimeoutMillis"
  | "idleTimeoutMillis"
  | "keepAlive"
  | "keepAliveInitialDelayMillis"
  | "max"
>;

/**
 * Build pg connection options for Supabase-backed pools.
 *
 * Supabase direct database hosts are IPv6-only for many projects; production
 * services should prefer the pooler URL in CUCUMBER_SUPABASE_DB_URL. This helper
 * keeps pooler URLs from failing locally when dashboard-provided URLs include
 * sslmode=require but the Node process lacks the expected CA chain.
 *
 * TODO(db): replace rejectUnauthorized=false with Supabase's root CA once certs
 * are checked into deployment secrets/config.
 */
export function createPostgresPoolConfig(
  connectionString: string,
  tuning: PoolTuning,
): PoolConfig {
  const normalizedConnectionString =
    normalizeSupabaseConnectionString(connectionString);

  return {
    connectionString: normalizedConnectionString,
    ...tuning,
    ...(isSupabasePostgresUrl(normalizedConnectionString)
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  };
}

export type PostgresConnectionIssue = {
  severity: "error" | "warning";
  message: string;
};

export function describePostgresConnection(connectionString: string) {
  try {
    const url = new URL(normalizeSupabaseConnectionString(connectionString));
    const user = safeDecodeURIComponent(url.username || "postgres");
    const database = safeDecodeURIComponent(
      url.pathname.replace(/^\//, "") || "postgres",
    );

    return [
      `host=${url.hostname || "unknown"}`,
      `port=${url.port || defaultPostgresPort(url.protocol)}`,
      `database=${database}`,
      `user=${maskPostgresUser(user)}`,
      `mode=${inferConnectionMode(url)}`,
    ].join(" ");
  } catch {
    return "invalid postgres connection string";
  }
}

export function inspectPostgresConnectionString(
  connectionString: string,
): PostgresConnectionIssue[] {
  const issues: PostgresConnectionIssue[] = [];

  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      issues.push({
        severity: "error",
        message:
          "CUCUMBER_SUPABASE_DB_URL must start with postgres:// or postgresql://.",
      });
    }

    const password = safeDecodeURIComponent(url.password);
    if (!password) {
      issues.push({
        severity: "error",
        message: "CUCUMBER_SUPABASE_DB_URL is missing the database password.",
      });
    } else if (looksLikePlaceholderPassword(password)) {
      issues.push({
        severity: "error",
        message:
          "CUCUMBER_SUPABASE_DB_URL still looks like it contains the dashboard placeholder password. Replace it with the real Supabase database password.",
      });
    }

    const user = safeDecodeURIComponent(url.username);
    if (
      isSupabasePoolerHost(url.hostname) &&
      url.port === "5432" &&
      !user.includes(".")
    ) {
      issues.push({
        severity: "warning",
        message:
          "Supabase shared pooler session mode usually expects a user like postgres.<project-ref>.",
      });
    }
  } catch {
    issues.push({
      severity: "error",
      message: "CUCUMBER_SUPABASE_DB_URL is not a valid URL.",
    });
  }

  return issues;
}

export function normalizeSupabaseConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString);
    if (!isSupabasePostgresHost(url.hostname)) {
      return connectionString;
    }

    // pg-connection-string currently treats sslmode=require as strict CA
    // verification. We set pg's TLS object explicitly above instead.
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function isSupabasePostgresUrl(connectionString: string) {
  try {
    return isSupabasePostgresHost(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

function isSupabasePostgresHost(hostname: string) {
  return (
    hostname.endsWith(".supabase.co") ||
    hostname === "pooler.supabase.com" ||
    hostname.endsWith(".pooler.supabase.com")
  );
}

function isSupabasePoolerHost(hostname: string) {
  return (
    hostname === "pooler.supabase.com" ||
    hostname.endsWith(".pooler.supabase.com")
  );
}

function inferConnectionMode(url: URL) {
  if (isSupabasePoolerHost(url.hostname)) {
    if (url.port === "5432") return "supabase-pooler-session";
    if (url.port === "6543") return "supabase-pooler-transaction";
    return "supabase-pooler";
  }

  if (url.hostname.startsWith("db.") && url.hostname.endsWith(".supabase.co")) {
    return "supabase-direct";
  }

  return "postgres";
}

function defaultPostgresPort(protocol: string) {
  return protocol === "postgres:" || protocol === "postgresql:"
    ? "5432"
    : "unknown";
}

function maskPostgresUser(user: string) {
  if (!user) return "unknown";

  const projectUserMatch = /^(?<role>[^.]+)\.(?<projectRef>[a-z0-9]{20})$/.exec(
    user,
  );
  const role = projectUserMatch?.groups?.role;
  const projectRef = projectUserMatch?.groups?.projectRef;
  if (role && projectRef) {
    return `${role}.${projectRef.slice(0, 4)}...${projectRef.slice(-4)}`;
  }

  if (user.length <= 12) return user;
  return `${user.slice(0, 6)}...${user.slice(-4)}`;
}

function looksLikePlaceholderPassword(password: string) {
  return /your[-_\s]?password|^\[.*password.*\]$|^<.*password.*>$/i.test(
    password,
  );
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
