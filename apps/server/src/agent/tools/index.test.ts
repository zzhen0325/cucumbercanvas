import type { BackendProtocol } from "deepagents";
import { describe, expect, it } from "vitest";

import type { ConnectionManager } from "../../ws/connection-manager.js";
import * as agentToolsIndex from "./index.js";

const { createMainAgentTools } = agentToolsIndex;

describe("createMainAgentTools", () => {
  it("registers MCP-bridged tools once without legacy duplicate entries", () => {
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
    const names = tools.map((tool) => tool.name);

    expect(screenshotTools).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
    expect(agentToolsIndex).not.toHaveProperty("createPhaseATools");
  });

  it("marks legacy canvas tools with current capability boundaries", () => {
    const tools = createMainAgentTools({} as BackendProtocol, {
      connectionManager: {
        rpc: async () => {
          throw new Error("not used");
        },
      } as unknown as ConnectionManager,
      createUserClient: () => ({}) as never,
    });

    expect(
      tools.find((tool) => tool.name === "inspect_canvas")?.description,
    ).toContain("Legacy compatibility reader");
    expect(
      tools.find((tool) => tool.name === "manipulate_canvas")?.description,
    ).toContain("prefer batch_design");
    expect(
      tools.find((tool) => tool.name === "screenshot_canvas")?.description,
    ).toContain("not the structured canvas reader");
  });
});
