import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import type { FastifyRequest } from "fastify";
import { type JWK, decodeProtectedHeader, importJWK, jwtVerify } from "jose";

import type { Database } from "@cucumber/shared";

import type { ServerEnv } from "../config/env.js";

export type UserSupabaseClient = SupabaseClient<Database>;

export type AuthenticatedUser = {
  accessToken: string;
  email: string;
  id: string;
  userMetadata: Record<string, unknown>;
};

export type RequestAuthenticator = {
  authenticate(
    request: Pick<FastifyRequest, "headers">,
  ): Promise<AuthenticatedUser | null>;
};

export class AuthVerificationUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      "Authentication service is temporarily unavailable. Check the Supabase URL, local CA trust, or configure CUCUMBER_SUPABASE_JWT_SECRET for local JWT verification.",
      { cause },
    );
    this.name = "AuthVerificationUnavailableError";
  }
}

// Dev auth bypass token — must match the frontend.
const DEV_ACCESS_TOKEN = "dev-skip-auth-token";
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEV_EMAIL = "dev@cucumber.studio";

const DEV_USER: AuthenticatedUser = {
  accessToken: DEV_ACCESS_TOKEN,
  email: DEV_EMAIL,
  id: DEV_USER_ID,
  userMetadata: { display_name: "Dev User" },
};

// --- In-memory auth cache (keyed by token, TTL 5 min) ---

const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedAuth = { user: AuthenticatedUser; expiresAt: number };
const authCache = new Map<string, CachedAuth>();

function getCachedAuth(token: string): AuthenticatedUser | null {
  const entry = authCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    authCache.delete(token);
    return null;
  }
  return entry.user;
}

function setCachedAuth(token: string, user: AuthenticatedUser): void {
  authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });

  // Lazy eviction: remove expired entries when cache grows large
  if (authCache.size > 500) {
    const now = Date.now();
    for (const [key, val] of authCache) {
      if (now > val.expiresAt) authCache.delete(key);
    }
  }
}

// --- Authenticator factory ---

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

type JwtVerificationKey = Awaited<ReturnType<typeof importJWK>> | Uint8Array;
type JwtKeyProvider = (token: string) => Promise<JwtVerificationKey | null>;
type CachedJwks = { fetchedAt: number; keys: JWK[] };

function createConfiguredJwtKeyProvider(
  env: Pick<ServerEnv, "supabaseJwtSecret">,
): JwtKeyProvider | null {
  if (!env.supabaseJwtSecret) return null;

  let jwkPromise: Promise<{
    alg?: string;
    key: Awaited<ReturnType<typeof importJWK>>;
  }> | null = null;
  let hmacKey: Uint8Array | null = null;

  return async (token) => {
    const header = readJwtProtectedHeader(token);
    const alg = header?.alg;
    if (!alg) return null;

    try {
      const jwk = JSON.parse(env.supabaseJwtSecret ?? "") as JWK;
      jwkPromise ??= importJWK(jwk, jwk.alg ?? alg).then((key) => ({
        alg: typeof jwk.alg === "string" ? jwk.alg : undefined,
        key,
      }));

      const imported = await jwkPromise;
      if (imported.alg && imported.alg !== alg) return null;
      return imported.key;
    } catch {
      if (!isSymmetricJwtAlgorithm(alg)) return null;
      hmacKey ??= new TextEncoder().encode(env.supabaseJwtSecret);
      return hmacKey;
    }
  };
}

function createSupabaseJwksKeyProvider(
  env: Pick<ServerEnv, "supabaseUrl">,
): JwtKeyProvider | null {
  if (!env.supabaseUrl) return null;

  const supabaseUrl = env.supabaseUrl;
  let cache: CachedJwks | null = null;

  return async (token) => {
    const header = readJwtProtectedHeader(token);
    const alg = header?.alg;
    const kid = header?.kid;
    if (!alg || !kid || !isAsymmetricJwtAlgorithm(alg)) return null;

    const keys = await loadJwks();
    const jwk = keys.find(
      (key) =>
        key.kid === kid &&
        (!key.alg || key.alg === alg) &&
        isVerificationJwk(key),
    );

    if (!jwk) return null;
    return importJWK(jwk, alg);
  };

  async function loadJwks(): Promise<JWK[]> {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < JWKS_CACHE_TTL_MS) {
      return cache.keys;
    }

    const response = await fetch(buildSupabaseJwksUrl(supabaseUrl));
    if (!response.ok) {
      throw new Error(`Supabase JWKS request failed with ${response.status}`);
    }

    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) {
      throw new Error("Supabase JWKS response did not include a keys array.");
    }

    const keys = body.keys.filter(isJwk);
    cache = { fetchedAt: now, keys };
    return keys;
  }
}

export function createSupabaseRequestAuthenticator(
  env: Pick<ServerEnv, "supabaseAnonKey" | "supabaseJwtSecret" | "supabaseUrl">,
): RequestAuthenticator {
  const jwtKeyProviders = [
    createConfiguredJwtKeyProvider(env),
    createSupabaseJwksKeyProvider(env),
  ].filter((provider): provider is JwtKeyProvider => !!provider);

  // Fallback: remote verification for legacy HS256 tokens when no JWT secret is configured.
  const createUserClient = createUserSupabaseClientFactory(env);

  return {
    async authenticate(request) {
      const accessToken = readBearerToken(request.headers.authorization);
      if (!accessToken) return null;

      // Dev auth bypass — skips JWT verification and DB calls.
      if (
        process.env.CUCUMBER_DEV_SKIP_AUTH === "true" &&
        accessToken === DEV_ACCESS_TOKEN
      ) {
        return DEV_USER;
      }

      // 1. Check cache first
      const cached = getCachedAuth(accessToken);
      if (cached) return cached;

      // 2. Local JWT verification (preferred)
      if (jwtKeyProviders.length > 0) {
        try {
          const verifiedUser = await verifyJwtWithProviders(
            accessToken,
            jwtKeyProviders,
            env,
          );

          if (verifiedUser) {
            setCachedAuth(accessToken, verifiedUser);
            return verifiedUser;
          }
        } catch (error) {
          console.warn("[auth] local Supabase JWT verification failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          throw new AuthVerificationUnavailableError(error);
        }
      }

      // 3. Fallback: remote auth.getUser()
      if (createUserClient) {
        const client = createUserClient(accessToken);
        const { data, error } = await client.auth.getUser();

        if (error) {
          if (isRemoteAuthVerificationFailure(error)) {
            console.warn("[auth] remote Supabase user verification failed", {
              errorName: error.name,
              message: error.message,
              status: getErrorStatus(error),
            });
            throw new AuthVerificationUnavailableError(error);
          }

          return null;
        }

        if (!data.user || !data.user.email) return null;

        const user: AuthenticatedUser = {
          accessToken,
          email: data.user.email,
          id: data.user.id,
          userMetadata: isRecord(data.user.user_metadata)
            ? data.user.user_metadata
            : {},
        };

        setCachedAuth(accessToken, user);
        return user;
      }

      return null;
    },
  };
}

async function verifyJwtWithProviders(
  accessToken: string,
  providers: JwtKeyProvider[],
  env: Pick<ServerEnv, "supabaseUrl">,
): Promise<AuthenticatedUser | null> {
  for (const provider of providers) {
    const key = await provider(accessToken);
    if (!key) continue;

    try {
      const { payload } = await jwtVerify(accessToken, key, {
        audience: "authenticated",
        ...(env.supabaseUrl
          ? { issuer: buildSupabaseJwtIssuer(env.supabaseUrl) }
          : {}),
      });

      const userId = payload.sub;
      const email = typeof payload.email === "string" ? payload.email : null;

      if (!userId || !email) return null;

      return {
        accessToken,
        email,
        id: userId,
        userMetadata: isRecord(payload.user_metadata)
          ? (payload.user_metadata as Record<string, unknown>)
          : {},
      };
    } catch {
      // Invalid, expired, or signed by another key. Try the next configured provider.
    }
  }

  return null;
}

export function createUserSupabaseClientFactory(
  env: Pick<
    ServerEnv,
    "supabaseAnonKey" | "supabaseServiceRoleKey" | "supabaseUrl"
  >,
) {
  return (accessToken: string): UserSupabaseClient => {
    if (!env.supabaseUrl || !env.supabaseAnonKey) {
      throw new Error(
        "CUCUMBER_SUPABASE_URL and CUCUMBER_SUPABASE_ANON_KEY are required for user-scoped Supabase access.",
      );
    }

    // Dev auth bypass — use admin client so DB queries succeed without a real JWT.
    if (
      process.env.CUCUMBER_DEV_SKIP_AUTH === "true" &&
      accessToken === DEV_ACCESS_TOKEN &&
      env.supabaseServiceRoleKey
    ) {
      return createClient<Database>(
        env.supabaseUrl,
        env.supabaseServiceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        },
      );
    }

    return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });
  };
}

function readBearerToken(
  authorizationHeader: string | string[] | undefined,
): string | null {
  if (typeof authorizationHeader !== "string") {
    return null;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function readJwtProtectedHeader(
  token: string,
): ReturnType<typeof decodeProtectedHeader> | null {
  try {
    return decodeProtectedHeader(token);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRemoteAuthVerificationFailure(error: Error): boolean {
  const status = getErrorStatus(error);
  const message = error.message.toLowerCase();

  return (
    error.name === "AuthRetryableFetchError" ||
    (typeof status === "number" && status >= 500) ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("certificate") ||
    message.includes("issuer certificate")
  );
}

function getErrorStatus(error: Error): number | undefined {
  const maybeStatus = (error as { status?: unknown }).status;
  return typeof maybeStatus === "number" ? maybeStatus : undefined;
}

function buildSupabaseJwksUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;
}

function buildSupabaseJwtIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

function isSymmetricJwtAlgorithm(alg: string): boolean {
  return alg.startsWith("HS");
}

function isAsymmetricJwtAlgorithm(alg: string): boolean {
  return (
    alg.startsWith("ES") ||
    alg.startsWith("PS") ||
    alg.startsWith("RS") ||
    alg === "EdDSA"
  );
}

function isJwk(value: unknown): value is JWK {
  return isRecord(value) && typeof value.kty === "string";
}

function isVerificationJwk(jwk: JWK): boolean {
  return (
    !Array.isArray(jwk.key_ops) ||
    jwk.key_ops.length === 0 ||
    jwk.key_ops.includes("verify")
  );
}
