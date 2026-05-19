import type { BackendFactory, BackendProtocol } from "deepagents";

import { createProjectSearchTool } from "../../agent/tools/project-search.js";
import type { CucumberMcpTool } from "../types.js";
import { wrapLegacyStructuredToolAsMcpTool } from "./legacy-tool-wrapper.js";

export function createProjectSearchMcpTool(
  backend: BackendProtocol | BackendFactory,
): CucumberMcpTool {
  return wrapLegacyStructuredToolAsMcpTool(createProjectSearchTool(backend));
}
