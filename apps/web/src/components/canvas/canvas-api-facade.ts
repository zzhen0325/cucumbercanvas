import type { CanvasApi } from "./canvas-api";

export function createCanvasApiFacade(getLiveApi: () => CanvasApi): CanvasApi {
  return {
    getDocument: () => getLiveApi().getDocument(),
    getDocumentVersion: () => getLiveApi().getDocumentVersion(),
    applyDocumentPatch: (patch) => getLiveApi().applyDocumentPatch(patch),
    setDocument: (doc, opts) => getLiveApi().setDocument(doc, opts),
    getActivePageId: () => getLiveApi().getActivePageId(),
    setActivePage: (pageId) => getLiveApi().setActivePage(pageId),
    getPages: () => getLiveApi().getPages(),
    addPage: (name) => getLiveApi().addPage(name),
    renamePage: (pageId, name) => getLiveApi().renamePage(pageId, name),
    duplicatePage: (pageId) => getLiveApi().duplicatePage(pageId),
    deletePage: (pageId) => getLiveApi().deletePage(pageId),
    reorderPage: (pageId, direction) =>
      getLiveApi().reorderPage(pageId, direction),
    applyBooleanOperation: (operation) =>
      getLiveApi().applyBooleanOperation(operation),
    getActiveTool: () => getLiveApi().getActiveTool(),
    setActiveTool: (tool) => getLiveApi().setActiveTool(tool),
    createContainer: (opts) => getLiveApi().createContainer(opts),
    createSection: (opts) => getLiveApi().createSection(opts),
    createSticky: (opts) => getLiveApi().createSticky(opts),
    createAgentUserGoal: (opts) => getLiveApi().createAgentUserGoal(opts),
    createConnector: (opts) => getLiveApi().createConnector(opts),
    detachConnectorEndpoint: (nodeId, endpoint) =>
      getLiveApi().detachConnectorEndpoint(nodeId, endpoint),
    insertNode: (node, containerId) =>
      getLiveApi().insertNode(node, containerId),
    updateNode: (nodeId, updates) => getLiveApi().updateNode(nodeId, updates),
    deleteNode: (nodeId) => getLiveApi().deleteNode(nodeId),
    bindAgentToContainer: (containerId, binding) =>
      getLiveApi().bindAgentToContainer(containerId, binding),
    setSelection: (nodeIds) => getLiveApi().setSelection(nodeIds),
    flushPendingSave: () => getLiveApi().flushPendingSave(),
    exportImage: (opts) => getLiveApi().exportImage(opts),
    getViewportBounds: () => getLiveApi().getViewportBounds(),
    getSceneElements: () => getLiveApi().getSceneElements(),
    getFiles: () => getLiveApi().getFiles(),
    getAppState: () => getLiveApi().getAppState(),
    updateScene: (scene) => getLiveApi().updateScene(scene),
    addFiles: (files) => getLiveApi().addFiles(files),
    onChange: (listener) => getLiveApi().onChange(listener),
    scrollToContent: () => getLiveApi().scrollToContent(),
    undo: () => getLiveApi().undo(),
    redo: () => getLiveApi().redo(),
    canUndo: () => getLiveApi().canUndo(),
    canRedo: () => getLiveApi().canRedo(),
    copySelection: () => getLiveApi().copySelection(),
    pasteClipboard: () => getLiveApi().pasteClipboard(),
    duplicateSelection: () => getLiveApi().duplicateSelection(),
    deleteSelection: () => getLiveApi().deleteSelection(),
    groupSelection: () => getLiveApi().groupSelection(),
    ungroupSelection: () => getLiveApi().ungroupSelection(),
    alignSelection: (alignment) => getLiveApi().alignSelection(alignment),
    reorderNode: (nodeId, direction) =>
      getLiveApi().reorderNode(nodeId, direction),
    moveNodeToIndex: (nodeId, targetParentId, targetIndex) =>
      getLiveApi().moveNodeToIndex(nodeId, targetParentId, targetIndex),
    toggleNodeLocked: (nodeId) => getLiveApi().toggleNodeLocked(nodeId),
    toggleNodeVisible: (nodeId) => getLiveApi().toggleNodeVisible(nodeId),
    pasteFromSystemClipboard: () => getLiveApi().pasteFromSystemClipboard(),
    importSvgMarkup: (svgMarkup) => getLiveApi().importSvgMarkup(svgMarkup),
    insertImageArtifact: (artifact) =>
      getLiveApi().insertImageArtifact(artifact),
    insertVideoArtifact: (artifact) =>
      getLiveApi().insertVideoArtifact(artifact),
  };
}
