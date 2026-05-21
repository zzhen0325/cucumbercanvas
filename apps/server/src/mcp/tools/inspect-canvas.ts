import { createInspectCanvasTool } from "../../agent/tools/inspect-canvas.js";
import type { CucumberMcpTool } from "../types.js";
import { wrapLegacyStructuredToolAsMcpTool } from "./legacy-tool-wrapper.js";

export function createInspectCanvasMcpTool(deps: {
  createUserClient: (accessToken: string) => any;
}): CucumberMcpTool {
  return wrapLegacyStructuredToolAsMcpTool(createInspectCanvasTool(deps));
}
