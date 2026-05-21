import React, { useCallback, useState } from 'react';
import type { ContainerNode, ContainerManager, ContextSlots, InheritPolicy } from '@cucumber/container';

export interface ContextSlotsPanelProps {
  container: ContainerNode;
  containerManager: ContainerManager;
}

export function ContextSlotsPanel({ container, containerManager }: ContextSlotsPanelProps) {
  const [newRule, setNewRule] = useState('');
  const slots = container.contextSlots;
  const effectiveContext = containerManager.resolveContext(container.id);

  const handlePolicyChange = useCallback((policy: InheritPolicy) => {
    containerManager.setInheritPolicy(container.id, policy);
  }, [container.id, containerManager]);

  const handleStyleChange = useCallback((key: string, value: string) => {
    containerManager.updateContextSlots(container.id, {
      style: { [key]: value },
    });
  }, [container.id, containerManager]);

  const handleTokenChange = useCallback((key: string, value: string) => {
    containerManager.updateContextSlots(container.id, {
      tokens: { [key]: value },
    });
  }, [container.id, containerManager]);

  const handleAddRule = useCallback(() => {
    if (!newRule.trim()) return;
    const currentRules = slots.rules ?? [];
    containerManager.updateContextSlots(container.id, {
      rules: [...currentRules, newRule.trim()],
    });
    setNewRule('');
  }, [container.id, containerManager, slots.rules, newRule]);

  const handleRemoveRule = useCallback((index: number) => {
    const currentRules = [...(slots.rules ?? [])];
    currentRules.splice(index, 1);
    containerManager.updateContextSlots(container.id, { rules: currentRules });
  }, [container.id, containerManager, slots.rules]);

  const handleConstraintChange = useCallback((key: string, value: string) => {
    containerManager.updateContextSlots(container.id, {
      constraints: { [key]: value },
    });
  }, [container.id, containerManager]);

  return React.createElement('div', { className: 'context-slots-panel' },
    React.createElement('h4', { className: 'panel-title' }, '上下文配置'),

    React.createElement('div', { className: 'section' },
      React.createElement('label', null, '继承策略'),
      React.createElement('select', {
        value: container.inheritPolicy,
        onChange: (e: any) => handlePolicyChange(e.target.value as InheritPolicy),
      },
        React.createElement('option', { value: 'merge' }, 'Merge (合并父级)'),
        React.createElement('option', { value: 'override' }, 'Override (覆盖父级)'),
        React.createElement('option', { value: 'block' }, 'Block (阻断继承)'),
      ),
    ),

    React.createElement('div', { className: 'section' },
      React.createElement('label', null, '视觉风格 (Style)'),
      React.createElement(StyleEditor, {
        styles: slots.style ?? {},
        onChange: handleStyleChange,
      }),
    ),

    React.createElement('div', { className: 'section' },
      React.createElement('label', null, '设计 Token'),
      React.createElement(TokenEditor, {
        tokens: slots.tokens ?? {},
        onChange: handleTokenChange,
      }),
    ),

    React.createElement('div', { className: 'section' },
      React.createElement('label', null, '设计规则'),
      React.createElement('div', { className: 'rules-list' },
        (slots.rules ?? []).map((rule, i) =>
          React.createElement('div', { key: i, className: 'rule-item' },
            React.createElement('span', null, rule),
            React.createElement('button', {
              className: 'remove-btn',
              onClick: () => handleRemoveRule(i),
            }, '×'),
          )
        ),
      ),
      React.createElement('div', { className: 'add-rule' },
        React.createElement('input', {
          type: 'text',
          value: newRule,
          onChange: (e: any) => setNewRule(e.target.value),
          placeholder: '添加规则，如"只用品牌紫"',
          onKeyDown: (e: any) => { if (e.key === 'Enter') handleAddRule(); },
        }),
        React.createElement('button', { onClick: handleAddRule }, '+'),
      ),
    ),

    React.createElement('div', { className: 'section' },
      React.createElement('label', null, '约束 (Constraints)'),
      React.createElement(ConstraintEditor, {
        constraints: slots.constraints ?? {},
        onChange: handleConstraintChange,
      }),
    ),

    React.createElement('div', { className: 'section effective-context' },
      React.createElement('label', null, '生效上下文 (只读)'),
      React.createElement('pre', { className: 'context-preview' },
        JSON.stringify(effectiveContext, null, 2),
      ),
    ),
  );
}

interface StyleEditorProps {
  styles: Record<string, unknown>;
  onChange: (key: string, value: string) => void;
}

function StyleEditor({ styles, onChange }: StyleEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const presetKeys = ['colorPalette', 'fontFamily', 'fontSize', 'borderRadius', 'backgroundColor'];

  const handleAdd = () => {
    if (!newKey.trim()) return;
    onChange(newKey.trim(), newValue.trim());
    setNewKey('');
    setNewValue('');
  };

  return React.createElement('div', { className: 'kv-editor' },
    Object.entries(styles).map(([key, val]) =>
      React.createElement('div', { key, className: 'kv-row' },
        React.createElement('span', { className: 'kv-key' }, key),
        React.createElement('input', {
          className: 'kv-value',
          value: String(val ?? ''),
          onChange: (e: any) => onChange(key, e.target.value),
        }),
      )
    ),
    React.createElement('div', { className: 'kv-add' },
      React.createElement('input', {
        list: 'style-keys',
        value: newKey,
        onChange: (e: any) => setNewKey(e.target.value),
        placeholder: 'key',
      }),
      React.createElement('datalist', { id: 'style-keys' },
        presetKeys.map(k => React.createElement('option', { key: k, value: k })),
      ),
      React.createElement('input', {
        value: newValue,
        onChange: (e: any) => setNewValue(e.target.value),
        placeholder: 'value',
      }),
      React.createElement('button', { onClick: handleAdd }, '+'),
    ),
  );
}

interface TokenEditorProps {
  tokens: Record<string, unknown>;
  onChange: (key: string, value: string) => void;
}

function TokenEditor({ tokens, onChange }: TokenEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const presetKeys = ['spacing-sm', 'spacing-md', 'spacing-lg', 'radius', 'shadow', 'primary', 'secondary'];

  const handleAdd = () => {
    if (!newKey.trim()) return;
    onChange(newKey.trim(), newValue.trim());
    setNewKey('');
    setNewValue('');
  };

  return React.createElement('div', { className: 'kv-editor' },
    Object.entries(tokens).map(([key, val]) =>
      React.createElement('div', { key, className: 'kv-row' },
        React.createElement('span', { className: 'kv-key' }, key),
        React.createElement('input', {
          className: 'kv-value',
          value: String(val ?? ''),
          onChange: (e: any) => onChange(key, e.target.value),
        }),
      )
    ),
    React.createElement('div', { className: 'kv-add' },
      React.createElement('input', {
        list: 'token-keys',
        value: newKey,
        onChange: (e: any) => setNewKey(e.target.value),
        placeholder: 'token key',
      }),
      React.createElement('datalist', { id: 'token-keys' },
        presetKeys.map(k => React.createElement('option', { key: k, value: k })),
      ),
      React.createElement('input', {
        value: newValue,
        onChange: (e: any) => setNewValue(e.target.value),
        placeholder: 'value',
      }),
      React.createElement('button', { onClick: handleAdd }, '+'),
    ),
  );
}

interface ConstraintEditorProps {
  constraints: Record<string, unknown>;
  onChange: (key: string, value: string) => void;
}

function ConstraintEditor({ constraints, onChange }: ConstraintEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const presetKeys = ['maxElements', 'aspectRatio', 'minWidth', 'maxWidth', 'gridCols'];

  const handleAdd = () => {
    if (!newKey.trim()) return;
    onChange(newKey.trim(), newValue.trim());
    setNewKey('');
    setNewValue('');
  };

  return React.createElement('div', { className: 'kv-editor' },
    Object.entries(constraints).map(([key, val]) =>
      React.createElement('div', { key, className: 'kv-row' },
        React.createElement('span', { className: 'kv-key' }, key),
        React.createElement('input', {
          className: 'kv-value',
          value: String(val ?? ''),
          onChange: (e: any) => onChange(key, e.target.value),
        }),
      )
    ),
    React.createElement('div', { className: 'kv-add' },
      React.createElement('input', {
        list: 'constraint-keys',
        value: newKey,
        onChange: (e: any) => setNewKey(e.target.value),
        placeholder: 'constraint key',
      }),
      React.createElement('datalist', { id: 'constraint-keys' },
        presetKeys.map(k => React.createElement('option', { key: k, value: k })),
      ),
      React.createElement('input', {
        value: newValue,
        onChange: (e: any) => setNewValue(e.target.value),
        placeholder: 'value',
      }),
      React.createElement('button', { onClick: handleAdd }, '+'),
    ),
  );
}
