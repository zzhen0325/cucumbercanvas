import type { ContainerTemplate } from './types.js';

export const PRESET_TEMPLATES: ContainerTemplate[] = [
  {
    id: 'preset_image-generation-pipeline',
    name: 'Image Generation Pipeline',
    description: 'Prompt生成器 → 图片渲染器：从文字描述生成图片的标准流水线',
    category: 'generation',
    version: '1.0.0',
    icon: '🎨',
    tags: ['image', 'generation', 'pipeline', 'ai'],
    nodes: [
      {
        refId: 'prompt-generator',
        role: ['task', 'dataflow'],
        label: 'Prompt Generator',
        relativePosition: { x: 0, y: 0, width: 280, height: 180 },
        contextSlots: {
          rules: ['Generate detailed image prompts based on input text'],
        },
        ioPorts: [
          { direction: 'input', dataType: 'text', label: 'User Input' },
          { direction: 'output', dataType: 'prompt', label: 'Generated Prompt' },
        ],
        agentBinding: {
          agentType: 'composer',
          role: 'designer',
          permissions: ['read', 'write'],
        },
      },
      {
        refId: 'image-renderer',
        role: ['visual', 'task', 'dataflow'],
        label: 'Image Renderer',
        relativePosition: { x: 400, y: 0, width: 320, height: 240 },
        contextSlots: {
          tokens: { outputFormat: 'png', resolution: '1024x1024' },
        },
        ioPorts: [
          { direction: 'input', dataType: 'prompt', label: 'Prompt Input' },
          { direction: 'output', dataType: 'image', label: 'Generated Image' },
        ],
        agentBinding: {
          agentType: 'designer',
          role: 'designer',
          permissions: ['read', 'write'],
        },
      },
    ],
    edges: [
      { sourceRef: 'prompt-generator', sourcePortIndex: 0, targetRef: 'image-renderer', targetPortIndex: 0 },
    ],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'preset_text-refiner',
    name: 'Text Refiner',
    description: '文本输入 → 多轮润色 → 输出：迭代优化文本内容的工作流',
    category: 'text',
    version: '1.0.0',
    icon: '✍️',
    tags: ['text', 'refine', 'iteration', 'ai'],
    nodes: [
      {
        refId: 'text-input',
        role: ['context', 'dataflow'],
        label: 'Text Input',
        relativePosition: { x: 0, y: 0, width: 240, height: 160 },
        ioPorts: [
          { direction: 'input', dataType: 'text', label: 'Raw Text' },
          { direction: 'output', dataType: 'text', label: 'Text to Refine' },
        ],
      },
      {
        refId: 'refiner-round-1',
        role: ['task', 'dataflow'],
        label: 'Refiner Round 1',
        relativePosition: { x: 340, y: 0, width: 260, height: 160 },
        contextSlots: {
          rules: ['Focus on clarity and grammar correction'],
        },
        ioPorts: [
          { direction: 'input', dataType: 'text', label: 'Input Text' },
          { direction: 'output', dataType: 'text', label: 'Refined Text' },
        ],
        agentBinding: {
          agentType: 'critic',
          role: 'reviewer',
          permissions: ['read', 'write'],
        },
      },
      {
        refId: 'refiner-round-2',
        role: ['task', 'dataflow'],
        label: 'Refiner Round 2',
        relativePosition: { x: 680, y: 0, width: 260, height: 160 },
        contextSlots: {
          rules: ['Focus on style, tone, and conciseness'],
        },
        ioPorts: [
          { direction: 'input', dataType: 'text', label: 'Input Text' },
          { direction: 'output', dataType: 'text', label: 'Final Text' },
        ],
        agentBinding: {
          agentType: 'critic',
          role: 'reviewer',
          permissions: ['read', 'write'],
        },
      },
    ],
    edges: [
      { sourceRef: 'text-input', sourcePortIndex: 0, targetRef: 'refiner-round-1', targetPortIndex: 0 },
      { sourceRef: 'refiner-round-1', sourcePortIndex: 0, targetRef: 'refiner-round-2', targetPortIndex: 0 },
    ],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'preset_multi-agent-review',
    name: 'Multi-Agent Review',
    description: '多个 Agent 并行审阅同一内容，汇总反馈后输出最终结果',
    category: 'collaboration',
    version: '1.0.0',
    icon: '👥',
    tags: ['multi-agent', 'review', 'parallel', 'collaboration'],
    nodes: [
      {
        refId: 'content-source',
        role: ['context', 'dataflow'],
        label: 'Content Source',
        relativePosition: { x: 0, y: 100, width: 240, height: 160 },
        ioPorts: [
          { direction: 'input', dataType: 'text', label: 'Content' },
          { direction: 'output', dataType: 'text', label: 'To Review A' },
          { direction: 'output', dataType: 'text', label: 'To Review B' },
          { direction: 'output', dataType: 'text', label: 'To Review C' },
        ],
      },
      {
        refId: 'reviewer-a',
        role: ['task', 'dataflow'],
        label: 'Reviewer A (Design)',
        relativePosition: { x: 380, y: 0, width: 240, height: 140 },
        contextSlots: {
          rules: ['Review from a visual design perspective'],
        },
        ioPorts: [
          { direction: 'input', dataType: 'text', label: 'Content' },
          { direction: 'output', dataType: 'json', label: 'Feedback' },
        ],
        agentBinding: {
          agentType: 'critic',
          role: 'reviewer',
          permissions: ['read', 'write'],
        },
      },
      {
        refId: 'reviewer-b',
        role: ['task', 'dataflow'],
        label: 'Reviewer B (Copy)',
        relativePosition: { x: 380, y: 160, width: 240, height: 140 },
        contextSlots: {
          rules: ['Review from a copywriting perspective'],
        },
        ioPorts: [
          { direction: 'input', dataType: 'text', label: 'Content' },
          { direction: 'output', dataType: 'json', label: 'Feedback' },
        ],
        agentBinding: {
          agentType: 'critic',
          role: 'reviewer',
          permissions: ['read', 'write'],
        },
      },
      {
        refId: 'reviewer-c',
        role: ['task', 'dataflow'],
        label: 'Reviewer C (UX)',
        relativePosition: { x: 380, y: 320, width: 240, height: 140 },
        contextSlots: {
          rules: ['Review from a user experience perspective'],
        },
        ioPorts: [
          { direction: 'input', dataType: 'text', label: 'Content' },
          { direction: 'output', dataType: 'json', label: 'Feedback' },
        ],
        agentBinding: {
          agentType: 'critic',
          role: 'reviewer',
          permissions: ['read', 'write'],
        },
      },
      {
        refId: 'aggregator',
        role: ['task', 'dataflow'],
        label: 'Feedback Aggregator',
        relativePosition: { x: 740, y: 100, width: 260, height: 180 },
        contextSlots: {
          rules: ['Aggregate all reviewer feedback and produce unified summary'],
        },
        ioPorts: [
          { direction: 'input', dataType: 'json', label: 'Feedback A' },
          { direction: 'input', dataType: 'json', label: 'Feedback B' },
          { direction: 'input', dataType: 'json', label: 'Feedback C' },
          { direction: 'output', dataType: 'json', label: 'Aggregated Result' },
        ],
        agentBinding: {
          agentType: 'composer',
          role: 'assistant',
          permissions: ['read', 'write'],
        },
      },
    ],
    edges: [
      { sourceRef: 'content-source', sourcePortIndex: 0, targetRef: 'reviewer-a', targetPortIndex: 0 },
      { sourceRef: 'content-source', sourcePortIndex: 1, targetRef: 'reviewer-b', targetPortIndex: 0 },
      { sourceRef: 'content-source', sourcePortIndex: 2, targetRef: 'reviewer-c', targetPortIndex: 0 },
      { sourceRef: 'reviewer-a', sourcePortIndex: 0, targetRef: 'aggregator', targetPortIndex: 0 },
      { sourceRef: 'reviewer-b', sourcePortIndex: 0, targetRef: 'aggregator', targetPortIndex: 1 },
      { sourceRef: 'reviewer-c', sourcePortIndex: 0, targetRef: 'aggregator', targetPortIndex: 2 },
    ],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];
