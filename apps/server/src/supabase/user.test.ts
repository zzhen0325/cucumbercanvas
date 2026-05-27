import { type JWK, SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseRequestAuthenticator } from "./user.js";

describe("createSupabaseRequestAuthenticator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verifies asymmetric Supabase JWTs with the project JWKS before remote auth.getUser", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = (await exportJWK(publicKey)) as JWK;
    publicJwk.alg = "ES256";
    publicJwk.kid = "test-key";
    publicJwk.key_ops = ["verify"];

    const accessToken = await new SignJWT({
      email: "user@cucumber.studio",
      user_metadata: { display_name: "Cucumber User" },
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject("00000000-0000-0000-0000-000000000123")
      .setAudience("authenticated")
      .setIssuer("https://example.supabase.co/auth/v1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const authenticator = createSupabaseRequestAuthenticator({
      supabaseAnonKey: "unused-by-jwks-verification",
      supabaseUrl: "https://example.supabase.co",
    });

    const user = await authenticator.authenticate({
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(user).toEqual({
      accessToken,
      email: "user@cucumber.studio",
      id: "00000000-0000-0000-0000-000000000123",
      userMetadata: { display_name: "Cucumber User" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/.well-known/jwks.json",
    );
  });
});
