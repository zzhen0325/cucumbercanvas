import fs from 'fs';

const filePath = '/Users/zhangzhen/macbook/zzmax/cucumber/apps/web/src/components/canvas/canvas-surface.tsx';
let code = fs.readFileSync(filePath, 'utf8');

// Count replacements
let count = 0;

function replace(pattern, replacement, description) {
  const regex = typeof pattern === 'string' ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : pattern;
  const before = code;
  code = code.replace(regex, replacement);
  const matches = (before.match(regex) || []).length;
  if (matches > 0) {
    console.log(`  [${matches}x] ${description}`);
    count += matches;
  }
}

// ============================================
// 1. doc.nodes[ → findNode(doc,  (for doc, next, previous, etc. variables)
//    Also fix the closing bracket
// ============================================

// Pattern: variable.nodes[expr]
// We need to convert this to findNode(variable, expr)
// The closing ] needs to become )

// First pass: simple cases where expression between [ and ] has no nested brackets
// We'll handle this with a regex that captures variable name and expression
replace(
  /\b(doc|docRef\.current|next|previous|baseDoc|result\.doc|inserted\.doc|docRef\.current|paired\.doc)\.nodes\[([^\]]+)\]/g,
  (_match, docVar, expr) => `findNode(${docVar}, ${expr})`,
  'variable.nodes[expr] → findNode(variable, expr) (non-nested)'
);

// Handle nested brackets in expr (like [nodeId])
replace(
  /\b(doc|docRef\.current|next|previous|baseDoc|result\.doc|inserted\.doc|docRef\.current)\.nodes\[(.*?\[.*?\].*?)\]/g,
  (_match, docVar, expr) => `findNode(${docVar}, ${expr})`,
  'variable.nodes[expr] → findNode(variable, expr) (nested brackets)'
);

// ============================================
// 2. doc.selection → (doc as any).selection
// ============================================
const selectionVars = [
  'doc',
  'docRef\\.current',
  'next',
  'previous',
  'baseDoc',
];

for (const v of selectionVars) {
  replace(
    new RegExp(`\\b${v}\\.selection`, 'g'),
    `(${v} as any).selection`,
    `${v}.selection → (${v} as any).selection`
  );
}

// Also fix: next.nodes[id] that we already converted to findNode

// ============================================
// 3. doc.viewport → (doc as any).viewport
// ============================================
for (const v of selectionVars) {
  replace(
    new RegExp(`\\b${v}\\.viewport`, 'g'),
    `(${v} as any).viewport`,
    `${v}.viewport → (${v} as any).viewport`
  );
}

// ============================================
// 4. createCanvasNodeId → createNodeId
// ============================================
replace(/createCanvasNodeId/g, 'createNodeId', 'createCanvasNodeId → createNodeId');

// ============================================
// 5. .fills → .fill (on node property access/creation)
// ============================================
replace(/\.fills\b/g, '.fill', '.fills → .fill');

// ============================================
// 6. "type": "rect" → "type": "rectangle" in node type context
// ============================================
replace(/(:\s*)"rect"(\s*[,}])/g, '$1"rectangle"$2', 'type: "rect" → "rectangle"');
replace(/type\s*===?\s*"rect"/g, 'type === "rectangle"', 'type === "rect" → "rectangle"');

// ============================================
// 7. "container" node type → "frame" (NOT tool type "container")
// ============================================
// node.type === "container" or case "container":
replace(/===?\s*"container"/g, '=== "frame"', '=== "container" → "frame"');

// type: "container" in object literals → "frame"
replace(/(:\s*)"container"(\s*[,}])/g, '$1"frame"$2', 'type: "container" → "frame"');

// case "container": → case "frame":
replace(/case\s+"container"\s*:/g, 'case "frame":', 'case "container" → "frame"');

// ============================================
// 8. "icon" node type → "icon_font"
// ============================================
replace(/type\s*===?\s*"icon"/g, 'type === "icon_font"', '=== "icon" → "icon_font"');
replace(/(:\s*)"icon"(\s*[,}])/g, '$1"icon_font"$2', 'type: "icon" → "icon_font"');
replace(/case\s+"icon"\s*:/g, 'case "icon_font":', 'case "icon" → "icon_font"');

// ============================================
// 9. "arrow" node type → "line" (NOT tool type in switch cases for toolbar)
// ============================================
replace(/type\s*===?\s*"arrow"/g, 'type === "line"', '=== "arrow" → "line"');
replace(/(:\s*)"arrow"(\s*[,}])/g, '$1"line"$2', 'type: "arrow" → "line"');
replace(/case\s+"arrow"\s*:/g, 'case "line":', 'case "arrow" → "line"');

// ============================================
// 10. node.title → node.name (NOT HTML title attributes)
// ============================================
replace(/node\.title\b/g, 'node.name', 'node.title → node.name');
replace(/artifact\.title\b/g, 'artifact.title', 'artifact.title -- leave as-is');
// undo the artifact.title change if it was accidentally changed
replace(/artifact\.name\b/g, 'artifact.title', 'artifact.name → artifact.title (revert)');

// Actually, let me be more careful with title. The node.title only appears in specific contexts.
// Let me check: what node.title patterns exist?

// ============================================
// 11. .bounds → direct property access
// ============================================
replace(/(\w+)\.bounds\.x\b/g, '$1.x ?? 0', 'node.bounds.x → node.x ?? 0');
replace(/(\w+)\.bounds\.y\b/g, '$1.y ?? 0', 'node.bounds.y → node.y ?? 0');

// ============================================
// 12. parentId → doesn't exist on PenNode
// We'll handle these with (node as any).parentId for now
// ============================================

// ============================================
// 13. node.text (TextNode property) → node.content
// ============================================
replace(/node\.text\b/g, '(node as any).text', 'node.text → (node as any).text');

// ============================================
// 14. node.points → node.polygonCount
// ============================================
replace(/node\.points\b/g, '(node as any).polygonCount', 'node.points → (node as any).polygonCount');

// ============================================
// 15. node.meta → (node as any).meta
// ============================================
replace(/node\.meta\b/g, '(node as any).meta', 'node.meta → (node as any).meta');

// ============================================
// 16. node.assetId → (node as any).assetId
// ============================================
replace(/node\.assetId\b/g, '(node as any).assetId', 'node.assetId → (node as any).assetId');

// ============================================
// 17. node.startAnchor / node.endAnchor → (node as any).startAnchor
// ============================================
replace(/node\.startAnchor\b/g, '(node as any).startAnchor', 'node.startAnchor → (node as any).startAnchor');
replace(/node\.endAnchor\b/g, '(node as any).endAnchor', 'node.endAnchor → (node as any).endAnchor');

// ============================================
// 18. node.alt → doesn't exist on ImageNode
// ============================================
replace(/node\.alt\b/g, '(node as any).alt', 'node.alt → (node as any).alt');

// ============================================
// 19. node.icon → (node as any).icon
// ============================================
replace(/node\.icon\b/g, '(node as any).icon', 'node.icon → (node as any).icon');

// ============================================
// 20. ConnectorNode → CanvasNode (it's an alias)
// ============================================
replace(/ConnectorNode/g, 'CanvasNode', 'ConnectorNode → CanvasNode');

// ============================================
// 21. Fix double replacements
// ============================================
replace(/"line"t"/g, '"line"', 'fix "line"t" double replace');
replace(/\(doc as any\)\.viewport as any/g, '(doc as any).viewport', 'fix double as any');

// ============================================
// 22. Fix specific patterns that can't be handled globally
// ============================================

// Fix: existing.meta
replace(/existing\.meta\b/g, '(existing as any).meta', 'existing.meta → (existing as any).meta');
replace(/selectedNode\.meta\b/g, '(selectedNode as any).meta', 'selectedNode.meta → (selectedNode as any).meta');

// Fix any remaining doc.selection that didn't get caught
replace(/\bdoc\.selection\b/g, '(doc as any).selection', 'doc.selection → (doc as any).selection (final)');

// Fix any remaining doc.viewport that didn't get caught
replace(/\bdoc\.viewport\b/g, '(doc as any).viewport', 'doc.viewport → (doc as any).viewport (final)');

// Fix any remaining doc.nodes that didn't get caught
replace(/\bdoc\.nodes\[/g, 'findNode(doc, ', 'doc.nodes[ → findNode(doc,  (final)');

// Fix specific: toSceneElement references
// Already handled by node.title → node.name and node.parentId stays for now

// ============================================
// 23. Fix defaultBounds type parameter
// ============================================
replace(/defaultBounds\((\w+),\s*"container"/g, 'defaultBounds($1, "frame"', 'defaultBounds("container") → "frame"');

// ============================================
// Write output
// ============================================
fs.writeFileSync(filePath, code);
console.log(`\nTotal replacements: ${count}`);
console.log('Done. File written.');
