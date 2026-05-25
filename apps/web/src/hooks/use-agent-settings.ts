"use client";

import {
  type AgentSettings,
  type BuiltinProviderConfig,
  type ImageGenProfile,
  type MCPCliIntegration,
  DEFAULT_AGENT_SETTINGS,
} from "@cucumber/shared";
import { useCallback, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// localStorage key
// ---------------------------------------------------------------------------

const STORAGE_KEY = "cucumber:agent-settings";

// ---------------------------------------------------------------------------
// Runtime cache + subscription (useSyncExternalStore pattern)
// ---------------------------------------------------------------------------

let cached: AgentSettings | null = null;
const listeners = new Set<() => void>();

function readSnapshot(): AgentSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const result: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, ...parsed };
      cached = result;
      return result;
    }
  } catch {
    // corrupted data — fall through
  }
  cached = { ...DEFAULT_AGENT_SETTINGS };
  return cached;
}

function writeSnapshot(next: AgentSettings): void {
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full or unavailable — ignore
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentSettings() {
  const settings = useSyncExternalStore(subscribe, readSnapshot, readSnapshot);

  const update = useCallback((patch: Partial<AgentSettings>) => {
    const current = readSnapshot();
    writeSnapshot({ ...current, ...patch });
  }, []);

  // -- builtin providers --

  const addBuiltinProvider = useCallback(
    (provider: BuiltinProviderConfig) => {
      const current = readSnapshot();
      writeSnapshot({
        ...current,
        builtinProviders: [...current.builtinProviders, provider],
      });
    },
    [],
  );

  const updateBuiltinProvider = useCallback(
    (id: string, patch: Partial<BuiltinProviderConfig>) => {
      const current = readSnapshot();
      writeSnapshot({
        ...current,
        builtinProviders: current.builtinProviders.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      });
    },
    [],
  );

  const removeBuiltinProvider = useCallback((id: string) => {
    const current = readSnapshot();
    writeSnapshot({
      ...current,
      builtinProviders: current.builtinProviders.filter((p) => p.id !== id),
    });
  }, []);

  // -- MCP integrations --

  const updateMcpIntegration = useCallback(
    (tool: string, patch: Partial<MCPCliIntegration>) => {
      const current = readSnapshot();
      writeSnapshot({
        ...current,
        mcpIntegrations: current.mcpIntegrations.map((m) =>
          m.tool === tool ? { ...m, ...patch } : m,
        ),
      });
    },
    [],
  );

  // -- image gen profiles --

  const addImageGenProfile = useCallback((profile: ImageGenProfile) => {
    const current = readSnapshot();
    writeSnapshot({
      ...current,
      imageGenProfiles: [...current.imageGenProfiles, profile],
    });
  }, []);

  const updateImageGenProfile = useCallback(
    (id: string, patch: Partial<ImageGenProfile>) => {
      const current = readSnapshot();
      writeSnapshot({
        ...current,
        imageGenProfiles: current.imageGenProfiles.map((p) =>
          p.id === id ? { ...p, ...patch } : p,
        ),
      });
    },
    [],
  );

  const removeImageGenProfile = useCallback((id: string) => {
    const current = readSnapshot();
    writeSnapshot({
      ...current,
      imageGenProfiles: current.imageGenProfiles.filter((p) => p.id !== id),
    });
  }, []);

  return {
    settings,
    update,
    addBuiltinProvider,
    updateBuiltinProvider,
    removeBuiltinProvider,
    updateMcpIntegration,
    addImageGenProfile,
    updateImageGenProfile,
    removeImageGenProfile,
  };
}
