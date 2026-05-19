import {
  createPersistSandboxFileTool,
  type PersistSandboxFileDeps,
} from "../../agent/tools/persist-sandbox-file.js";
import type { CucumberMcpTool } from "../types.js";
import { wrapLegacyStructuredToolAsMcpTool } from "./legacy-tool-wrapper.js";

export function createPersistSandboxFileMcpTool(
  deps: PersistSandboxFileDeps,
): CucumberMcpTool {
  return wrapLegacyStructuredToolAsMcpTool(createPersistSandboxFileTool(deps));
}
