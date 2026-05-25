// ---------------------------------------------------------------------------
// Agent settings types — provider config, MCP integrations, model grouping
// Ported from OpenPencil, adapted for Cucumber's agent infrastructure.
// ---------------------------------------------------------------------------

export type AIProviderType =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "opencode"
  | "copilot";

export interface GroupedModel {
  value: string;
  displayName: string;
  description: string;
  provider: AIProviderType | string;
  /** When set, this model came from a user-configured built-in provider. */
  builtinProviderId?: string;
}

export interface ModelGroup {
  provider: AIProviderType | string;
  providerName: string;
  models: GroupedModel[];
}

// ---------------------------------------------------------------------------
// Built-in (API-key based) provider configuration
// ---------------------------------------------------------------------------

export interface BuiltinProviderConfig {
  id: string;
  type: AIProviderType | "openai-compat";
  displayName: string;
  apiKey: string;
  baseURL?: string;
  model: string;
  enabled: boolean;
  region: "global" | "cn";
}

export interface BuiltinProviderPreset {
  id: string;
  label: string;
  type: AIProviderType | "openai-compat";
  baseURL: string;
  altBaseURL?: string;
  altType?: AIProviderType | "openai-compat";
  regions: Array<"global" | "cn">;
  placeholder: string;
  modelPlaceholder: string;
}

// ---------------------------------------------------------------------------
// MCP CLI integration
// ---------------------------------------------------------------------------

export type MCPCliTool =
  | "claude-code"
  | "codex-cli"
  | "gemini-cli"
  | "opencode-cli"
  | "kiro-cli"
  | "copilot-cli";

export type MCPTransportMode = "stdio" | "http" | "both";

export interface MCPCliIntegration {
  tool: MCPCliTool;
  displayName: string;
  enabled: boolean;
  installed: boolean;
  transportMode: MCPTransportMode;
  port?: number;
}

// ---------------------------------------------------------------------------
// Image generation config
// ---------------------------------------------------------------------------

export interface ImageGenConfig {
  provider: "openai" | "google" | "replicate" | "custom";
  apiKey: string;
  model: string;
  baseURL?: string;
}

export interface ImageGenProfile {
  id: string;
  name: string;
  config: ImageGenConfig;
}

// ---------------------------------------------------------------------------
// Agent settings store shape
// ---------------------------------------------------------------------------

export interface AgentSettings {
  /** User-configured built-in providers with API keys. */
  builtinProviders: BuiltinProviderConfig[];
  /** MCP CLI tool integrations. */
  mcpIntegrations: MCPCliIntegration[];
  /** Image generation profiles. */
  imageGenProfiles: ImageGenProfile[];
  /** Active image generation profile ID. */
  activeImageGenProfileId: string | null;
  /** Whether team mode is enabled. */
  teamModeEnabled: boolean;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  builtinProviders: [],
  mcpIntegrations: [],
  imageGenProfiles: [],
  activeImageGenProfileId: null,
  teamModeEnabled: false,
};
