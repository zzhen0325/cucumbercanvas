import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createCucumberMcpServer } from "./server.js";
import { schemaToJsonSchema, unwrapMcpToolResult } from "./utils.js";

describe("schemaToJsonSchema", () => {
  it("converts Zod object schemas into MCP-friendly JSON schema", () => {
    const jsonSchema = schemaToJsonSchema(
      z.object({
        prompt: z.string().min(1),
        quality: z.enum(["draft", "final"]).optional(),
      }),
    );

    expect(jsonSchema).toMatchObject({
      type: "object",
      properties: {
        prompt: expect.any(Object),
        quality: expect.any(Object),
      },
    });
  });
});

describe("createCucumberMcpServer", () => {
  it("lists MCP tools with JSON input schemas", () => {
    const server = createCucumberMcpServer({} as never, {
      createUserClient: () => ({}),
    });

    const generateImage = server
      .listTools()
      .find((toolDef) => toolDef.name === "generate_image");

    expect(generateImage).toMatchObject({
      name: "generate_image",
      inputSchema: {
        type: "object",
        properties: expect.objectContaining({
          model: expect.any(Object),
          prompt: expect.any(Object),
          title: expect.any(Object),
        }),
      },
    });
  });

  it("returns a structured tool_not_found error for missing tools", async () => {
    const server = createCucumberMcpServer({} as never, {
      createUserClient: () => ({}),
    });

    await expect(server.callTool("missing_tool", {})).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: "tool_not_found",
        message: "Tool not found: missing_tool",
      },
    });
  });
});

describe("unwrapMcpToolResult", () => {
  it("prefers structured content and falls back to text", () => {
    expect(
      unwrapMcpToolResult({
        content: [{ type: "text", text: "ignored" }],
        structuredContent: { jobId: "job-1", status: "queued" },
      }),
    ).toEqual({ jobId: "job-1", status: "queued" });

    expect(
      unwrapMcpToolResult({
        content: [{ type: "text", text: "plain text result" }],
      }),
    ).toBe("plain text result");
  });
});
