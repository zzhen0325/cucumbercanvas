"use client";

import type { AgentRecipeTemplate } from "@cucumber/canvas-core";
import { useCallback, useEffect, useState } from "react";

export const CUSTOM_AGENT_RECIPE_TEMPLATES_STORAGE_KEY =
  "cucumber.agentRecipeTemplates.v1";
const CUSTOM_AGENT_RECIPE_TEMPLATES_EVENT = "cucumber:agent-recipe-templates";
const MAX_CUSTOM_TEMPLATES = 24;

export function useCustomAgentRecipeTemplates(): AgentRecipeTemplate[] {
  const [templates, setTemplates] = useState<AgentRecipeTemplate[]>(() =>
    readCustomAgentRecipeTemplates(),
  );

  useEffect(() => {
    const handleChange = () => setTemplates(readCustomAgentRecipeTemplates());
    window.addEventListener("storage", handleChange);
    window.addEventListener(CUSTOM_AGENT_RECIPE_TEMPLATES_EVENT, handleChange);
    return () => {
      window.removeEventListener("storage", handleChange);
      window.removeEventListener(
        CUSTOM_AGENT_RECIPE_TEMPLATES_EVENT,
        handleChange,
      );
    };
  }, []);

  return templates;
}

export function saveCustomAgentRecipeTemplate(
  template: AgentRecipeTemplate,
): AgentRecipeTemplate[] {
  const current = readCustomAgentRecipeTemplates();
  const next = [
    template,
    ...current.filter((item) => item.id !== template.id),
  ].slice(0, MAX_CUSTOM_TEMPLATES);
  window.localStorage.setItem(
    CUSTOM_AGENT_RECIPE_TEMPLATES_STORAGE_KEY,
    JSON.stringify(next),
  );
  window.dispatchEvent(new Event(CUSTOM_AGENT_RECIPE_TEMPLATES_EVENT));
  console.info("[agent-recipe-template] saved", {
    savedFromNodeId: template.savedFromNodeId,
    templateId: template.id,
  });
  return next;
}

export function removeCustomAgentRecipeTemplate(templateId: string): void {
  const next = readCustomAgentRecipeTemplates().filter(
    (template) => template.id !== templateId,
  );
  window.localStorage.setItem(
    CUSTOM_AGENT_RECIPE_TEMPLATES_STORAGE_KEY,
    JSON.stringify(next),
  );
  window.dispatchEvent(new Event(CUSTOM_AGENT_RECIPE_TEMPLATES_EVENT));
  console.info("[agent-recipe-template] removed", {
    remainingCount: next.length,
    templateId,
  });
}

export function useRemoveCustomAgentRecipeTemplate() {
  return useCallback((templateId: string) => {
    removeCustomAgentRecipeTemplate(templateId);
  }, []);
}

export function readCustomAgentRecipeTemplates(): AgentRecipeTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(
      CUSTOM_AGENT_RECIPE_TEMPLATES_STORAGE_KEY,
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAgentRecipeTemplate);
  } catch (error) {
    console.warn("[agent-recipe-template] read.failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function isAgentRecipeTemplate(value: unknown): value is AgentRecipeTemplate {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.defaultPrompt === "string" &&
    typeof value.deliverableFormat === "string" &&
    isStringArray(value.nodeStructure) &&
    isStringArray(value.toolSequence) &&
    isStringArray(value.inputSlots) &&
    isStringArray(value.validationRules)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
