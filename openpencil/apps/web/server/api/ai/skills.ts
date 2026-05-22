import { defineEventHandler } from 'h3';
import { getSkillRegistry } from '@zseven-w/pen-ai-skills';
import type { Phase, SkillCategory, SkillTrigger } from '@zseven-w/pen-ai-skills';

type TriggerType = 'always' | 'keywords' | 'flags';

interface SkillMetaView {
  name: string;
  description: string;
  phase: Phase[];
  priority: number;
  budget: number;
  category: SkillCategory;
  triggerType: TriggerType;
  triggerValues: string[];
}

interface SkillsResponse {
  skills: SkillMetaView[];
  counts: {
    total: number;
    byPhase: Record<Phase, number>;
  };
}

let cachedResponse: SkillsResponse | null = null;

function parseTrigger(trigger: SkillTrigger): { triggerType: TriggerType; triggerValues: string[] } {
  if (!trigger) return { triggerType: 'always', triggerValues: [] };
  if ('keywords' in trigger) return { triggerType: 'keywords', triggerValues: trigger.keywords };
  if ('flags' in trigger) return { triggerType: 'flags', triggerValues: trigger.flags };
  return { triggerType: 'always', triggerValues: [] };
}

function buildResponse(): SkillsResponse {
  const registry = getSkillRegistry();
  const byPhase: Record<Phase, number> = {
    planning: 0,
    generation: 0,
    validation: 0,
    maintenance: 0,
  };

  const skills = registry
    .map((entry) => {
      const trigger = parseTrigger(entry.meta.trigger);
      entry.meta.phase.forEach((phase) => {
        byPhase[phase] += 1;
      });

      return {
        name: entry.meta.name,
        description: entry.meta.description,
        phase: entry.meta.phase,
        priority: entry.meta.priority,
        budget: entry.meta.budget,
        category: entry.meta.category,
        triggerType: trigger.triggerType,
        triggerValues: trigger.triggerValues,
      } satisfies SkillMetaView;
    })
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  return {
    skills,
    counts: {
      total: skills.length,
      byPhase,
    },
  };
}

export default defineEventHandler(() => {
  if (!cachedResponse) {
    cachedResponse = buildResponse();
  }
  return cachedResponse;
});
