import { createManipulateCanvasTool } from "../../agent/tools/manipulate-canvas.js";
import type { UserSupabaseClient } from "../../supabase/user.js";
import type { CucumberMcpTool } from "../types.js";
import { wrapLegacyStructuredToolAsMcpTool } from "./legacy-tool-wrapper.js";

export function createManipulateCanvasMcpTool(deps: {
  createUserClient: (accessToken: string) => UserSupabaseClient;
}): CucumberMcpTool {
  return wrapLegacyStructuredToolAsMcpTool(createManipulateCanvasTool(deps));
}
