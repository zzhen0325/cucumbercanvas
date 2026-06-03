import type { BackendProtocol } from "deepagents";
import { describe, expect, it } from "vitest";

import type { ConnectionManager } from "../../ws/connection-manager.js";
import { createMainAgentTools } from "./index.js";

describe("createMainAgentTools", () => {
  it("registers screenshot_canvas once through the MCP bridge", () => {
    const tools = createMainAgentTools({} as BackendProtocol, {
      connectionManager: {
        rpc: async () => {
          throw new Error("not used");
        },
      } as unknown as ConnectionManager,
      createUserClient: () => ({}) as never,
    });

    const screenshotTools = tools.filter(
      (tool) => tool.name === "screenshot_canvas",
    );

    expect(screenshotTools).toHaveLength(1);
  });
});
