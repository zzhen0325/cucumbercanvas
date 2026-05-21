import React, { useEffect, useState, useCallback } from 'react';
import type { TemplateRegistry, ContainerTemplate } from '@cucumber/container';

interface TemplateSelectorProps {
  registry: TemplateRegistry;
  onInstantiate: (templateId: string) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({ registry, onInstantiate }) => {
  const [templates, setTemplates] = useState<ContainerTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [previewId, setPreviewId] = useState<string | null>(null);

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

  const categories = ['all', ...new Set(templates.map(t => t.category))];

  const filtered = templates.filter(t => {
    if (selectedCategory !== 'all' && t.category !== selectedCategory) return false;
    if (search) {
      const lower = search.toLowerCase();
      return t.name.toLowerCase().includes(lower) || t.description.toLowerCase().includes(lower);
    }
    return true;
  });

  const previewTemplate = previewId ? templates.find(t => t.id === previewId) : null;

  return (
    <div className="template-selector">
      <div className="template-selector__header">
        <h3>模板库</h3>
      </div>

      <div className="template-selector__search">
        <input
          type="text"
          placeholder="搜索模板..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="template-selector__search-input"
        />
      </div>

      <div className="template-selector__categories">
        {categories.map(cat => (
          <button
            key={cat}
            className={`template-selector__category ${selectedCategory === cat ? 'template-selector__category--active' : ''}`}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat === 'all' ? '全部' : cat}
          </button>
        ))}
      </div>

      <div className="template-selector__grid">
        {filtered.map(tpl => (
          <div
            key={tpl.id}
            className={`template-selector__card ${previewId === tpl.id ? 'template-selector__card--selected' : ''}`}
            onClick={() => setPreviewId(tpl.id)}
          >
            <div className="template-selector__card-icon">{tpl.icon ?? '📋'}</div>
            <div className="template-selector__card-info">
              <span className="template-selector__card-name">{tpl.name}</span>
              <span className="template-selector__card-desc">{tpl.description}</span>
              <div className="template-selector__card-meta">
                <span>{tpl.nodes.length} 容器</span>
                <span>{tpl.edges.length} 连线</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {previewTemplate && (
        <div className="template-selector__preview">
          <div className="template-selector__preview-header">
            <span>{previewTemplate.icon} {previewTemplate.name}</span>
            <span className="template-selector__preview-version">v{previewTemplate.version}</span>
          </div>
          <p className="template-selector__preview-desc">{previewTemplate.description}</p>
          <div className="template-selector__preview-nodes">
            {previewTemplate.nodes.map(node => (
              <div key={node.refId} className="template-selector__preview-node">
                <span className="template-selector__preview-node-label">{node.label}</span>
                <span className="template-selector__preview-node-ports">
                  {node.ioPorts.length} ports
                </span>
              </div>
            ))}
          </div>
          {previewTemplate.tags && (
            <div className="template-selector__preview-tags">
              {previewTemplate.tags.map(tag => (
                <span key={tag} className="template-selector__preview-tag">#{tag}</span>
              ))}
            </div>
          )}
          <button
            className="template-selector__instantiate-btn"
            onClick={() => onInstantiate(previewTemplate.id)}
          >
            实例化模板
          </button>
        </div>
      )}
    </div>
  );
};
