// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockOnAuthStateChange, mockReplace } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockOnAuthStateChange: vi.fn(),
    mockReplace: vi.fn(),
  }),
);

vi.mock("../src/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: vi.fn(() => ({
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
    },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: mockReplace })),
}));

import RootPage from "../src/app/page";
import { AuthProvider } from "../src/lib/auth-context";

describe("Root page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("redirects anonymous visitors to login instead of rendering the landing page", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    render(
      <AuthProvider>
        <RootPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });

  it("redirects authenticated visitors to the workspace home", async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: "session-token",
          user: { id: "u1", email: "user@example.com" },
        },
      },
      error: null,
    });

    render(
      <AuthProvider>
        <RootPage />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/home");
    });
  });
});
