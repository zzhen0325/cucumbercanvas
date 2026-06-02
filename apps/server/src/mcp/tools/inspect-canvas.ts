import { createInspectCanvasTool } from "../../agent/tools/inspect-canvas.js";
import type { LiveCanvasService } from "../../features/canvas/live-canvas-service.js";
import type { UserSupabaseClient } from "../../supabase/user.js";
import type { CucumberMcpTool } from "../types.js";
import { wrapLegacyStructuredToolAsMcpTool } from "./legacy-tool-wrapper.js";

export function createInspectCanvasMcpTool(deps: {
  createUserClient: (accessToken: string) => UserSupabaseClient;
  liveCanvasService?: LiveCanvasService;
}): CucumberMcpTool {
  return wrapLegacyStructuredToolAsMcpTool(createInspectCanvasTool(deps));
}
