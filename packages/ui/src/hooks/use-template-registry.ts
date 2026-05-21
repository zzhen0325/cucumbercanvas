import { useEffect, useState, useCallback } from 'react';
import type { TemplateRegistry, ContainerTemplate } from '@cucumber/container';

export function useTemplateRegistry(registry: TemplateRegistry) {
  const [templates, setTemplates] = useState<ContainerTemplate[]>([]);

  const refresh = useCallback(() => {
    setTemplates(registry.getAll());
  }, [registry]);

  useEffect(() => {
    refresh();
    const u1 = registry.on('template:add', refresh);
    const u2 = registry.on('template:remove', refresh);
    const u3 = registry.on('template:update', refresh);
    return () => { u1(); u2(); u3(); };
  }, [registry, refresh]);

  const instantiate = useCallback((templateId: string, x: number, y: number) => {
    return registry.instantiate(templateId, x, y);
  }, [registry]);

  const search = useCallback((query: string) => {
    return registry.search(query);
  }, [registry]);

  return { templates, instantiate, search, refresh };
}
