import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, Search } from 'lucide-react';

type SkillPhase = 'planning' | 'generation' | 'validation' | 'maintenance';

interface SkillMetaView {
  name: string;
  description: string;
  phase: SkillPhase[];
  priority: number;
  budget: number;
  category: 'base' | 'domain' | 'knowledge';
  triggerType: 'always' | 'keywords' | 'flags';
  triggerValues: string[];
}

interface SkillsResponse {
  skills: SkillMetaView[];
  counts: {
    total: number;
    byPhase: Record<SkillPhase, number>;
  };
}

export function SkillsTab() {
  const { t } = useTranslation();
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillsResponse, setSkillsResponse] = useState<SkillsResponse | null>(null);

  useEffect(() => {
    setSkillsLoading(true);
    setSkillsError(null);
    fetch('/api/ai/skills')
      .then((r) => r.json())
      .then((data: SkillsResponse) => {
        setSkillsResponse(data);
      })
      .catch(() => {
        setSkillsError(
          t('agents.skillsLoadFailed', {
            defaultValue: 'Failed to load skills metadata',
          }),
        );
      })
      .finally(() => setSkillsLoading(false));
  }, [t]);

  const filteredSkills = useMemo(() => {
    const list = skillsResponse?.skills ?? [];
    const query = skillQuery.trim().toLowerCase();
    if (!query) return list;
    return list.filter((skill) => {
      const inName = skill.name.toLowerCase().includes(query);
      const inDescription = skill.description.toLowerCase().includes(query);
      const inTriggerValues = skill.triggerValues.some((value) => value.toLowerCase().includes(query));
      return inName || inDescription || inTriggerValues;
    });
  }, [skillsResponse, skillQuery]);

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-foreground mb-1">
        {t('agents.skillsTitle', { defaultValue: 'OpenPencil Skills' })}
      </h3>
      <p className="text-[11px] text-muted-foreground mb-3">
        {t('agents.skillsDesc', {
          defaultValue: 'Built-in prompt skills available to the agent engine.',
        })}
      </p>

      {skillsLoading ? (
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
          <span>
            {t('agents.skillsLoading', {
              defaultValue: 'Loading skills...',
            })}
          </span>
        </div>
      ) : skillsError ? (
        <div className="flex items-center gap-1.5 px-1">
          <AlertCircle size={11} className="text-destructive shrink-0" />
          <p className="text-[11px] text-destructive">{skillsError}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[11px] px-2 py-1 rounded border border-border bg-secondary/20 text-foreground">
              total {skillsResponse?.counts.total ?? 0}
            </span>
            <span className="text-[11px] px-2 py-1 rounded border border-border bg-secondary/10 text-muted-foreground">
              planning {skillsResponse?.counts.byPhase.planning ?? 0}
            </span>
            <span className="text-[11px] px-2 py-1 rounded border border-border bg-secondary/10 text-muted-foreground">
              generation {skillsResponse?.counts.byPhase.generation ?? 0}
            </span>
            <span className="text-[11px] px-2 py-1 rounded border border-border bg-secondary/10 text-muted-foreground">
              validation {skillsResponse?.counts.byPhase.validation ?? 0}
            </span>
            <span className="text-[11px] px-2 py-1 rounded border border-border bg-secondary/10 text-muted-foreground">
              maintenance {skillsResponse?.counts.byPhase.maintenance ?? 0}
            </span>
          </div>

          <div className="relative mb-2.5">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              placeholder={t('agents.skillsSearch', { defaultValue: 'Search skills...' })}
              className="w-full h-8 pl-7 pr-2.5 rounded border border-input bg-background text-[12px] text-foreground outline-none focus:border-ring"
            />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-secondary/10">
            {filteredSkills.length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-3 py-2.5">
                {t('agents.skillsNoMatch', { defaultValue: 'No skills matched your search.' })}
              </p>
            ) : (
              <div className="divide-y divide-border/80">
                {filteredSkills.map((skill) => (
                  <div key={skill.name} className="px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[12px] font-medium text-foreground">{skill.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                        {skill.category}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                        p{skill.priority}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{skill.description}</p>
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {skill.phase.map((phase) => (
                        <span
                          key={`${skill.name}-${phase}`}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground"
                        >
                          {phase}
                        </span>
                      ))}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                        trigger: {skill.triggerType}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                        budget: {skill.budget}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
