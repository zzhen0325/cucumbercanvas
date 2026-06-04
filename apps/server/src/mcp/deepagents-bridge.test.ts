import type { BackendProtocol } from "deepagents";
import { describe, expect, it } from "vitest";

import type { AvailableModel } from "../generation/providers/registry.js";
import { bridgeMcpToolToDeepAgent } from "./deepagents-bridge.js";
import { createCucumberMcpServer } from "./server.js";
import { createGenerateImageMcpTool } from "./tools/generate-image.js";

const availableModels: AvailableModel[] = [
  {
    id: "bytedance/seedream-4.6",
    displayName: "Seedream 4.6",
    description: "Seedream image generation",
    provider: "seedream",
  },
];

describe("createCucumberMcpServer", () => {
  it("registers the Cucumber MCP tools", () => {
    const server = createCucumberMcpServer({} as BackendProtocol, {
      createUserClient: () => ({}),
    });

    expect(server.listTools().map((toolDef) => toolDef.name)).toEqual([
      "project_search",
      "inspect_canvas",
      "inspect_canvas_semantic",
      "get_selection_context",
      "canvas_diff_preview",
      "apply_canvas_transaction",
      "query_canvas_assets",
      "replace_asset_in_node",
      "connect_nodes",
      "resize_container_to_fit",
      "create_agent_output_container",
      "create_agent_execution_flow",
      "create_agent_ask_user_more",
      "create_agent_evidence",
      "record_agent_tool_call",
      "create_agent_variant_branches",
      "select_agent_variant_branch",
      "create_agent_canvas_flow",
      "layout_canvas",
      "validate_canvas",
      "canvas_memory_index",
      "critique_canvas",
      "record_agent_critique",
      "record_agent_final_deliverable",
      "export_canvas_deliverable",
      "canvas_run_trace",
      "screenshot_canvas",
      "manipulate_canvas",
      "batch_design",
      "batch_get",
      "snapshot_layout",
      "find_empty_space",
      "add_page",
      "remove_page",
      "rename_page",
      "reorder_page",
      "duplicate_page",
      "design_skeleton",
      "design_content",
      "design_refine",
      "import_figma_clipboard",
      "read_nodes",
      "search_all_unique_properties",
      "replace_all_matching_properties",
      "get_variables",
      "set_variables",
      "set_themes",
      "prompt_canvas_plan",
      "prompt_canvas_execute",
      "codegen_plan",
      "codegen_submit_chunk",
      "codegen_assemble",
      "codegen_export",
      "codegen_clean",
      "generate_image",
      "generate_video",
      "persist_sandbox_file",
    ]);
  });
});

describe("bridgeMcpToolToDeepAgent", () => {
  it("keeps generate_image usable through the MCP bridge", async () => {
    let submittedModel: string | undefined;
    const bridgedTool = bridgeMcpToolToDeepAgent(
      createGenerateImageMcpTool({
        availableModels,
        submitImageJob: async (input) => {
          submittedModel = input.model;
          return { jobId: "job_bridge", error: "stubbed failure" };
        },
      }),
    );

    const result = await bridgedTool.invoke({
      prompt: "3d Christmas villain",
      title: "Christmas villain",
      model: "Seedream 4.6",
    });

    expect(submittedModel).toBe("bytedance/seedream-4.6");
    expect(result).toMatchObject({
      jobId: "job_bridge",
      jobType: "image_generation",
    });
  });
});
