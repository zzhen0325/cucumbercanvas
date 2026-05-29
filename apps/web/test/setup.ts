import { afterEach } from "vitest";

// Vitest inherits NODE_ENV=production in this workspace; force test mode
// before Testing Library resolves React test helpers for React 19.
Object.assign(process.env, { NODE_ENV: "test" });

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

await import("@testing-library/jest-dom/vitest");

const { cleanup } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});
