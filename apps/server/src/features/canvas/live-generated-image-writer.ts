import type {
  AuthenticatedUser,
  UserSupabaseClient,
} from "../../supabase/user.js";
import {
  type ImageInsertOpts,
  buildGeneratedImageInsertPlan,
} from "./canvas-element-writer.js";
import type { LiveCanvasService } from "./live-canvas-service.js";

type Placement = { x: number; y: number; width: number; height: number };

type StorageDownloadQuery = {
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
};

export async function insertGeneratedImageIntoLiveCanvas(args: {
  canvasId: string;
  image: ImageInsertOpts;
  liveCanvasService: LiveCanvasService;
  placement?: Placement;
  storageClient: UserSupabaseClient;
  transactionId: string;
  user: AuthenticatedUser;
}): Promise<{
  elementId: string;
  nextVersion: number;
  operationCount: number;
}> {
  const liveState = await args.liveCanvasService.getDocumentState(
    args.user,
    args.canvasId,
  );
  const { data: urlData } = (
    args.storageClient.storage.from("project-assets") as StorageDownloadQuery
  ).getPublicUrl(args.image.objectPath);
  const plan = buildGeneratedImageInsertPlan({
    doc: liveState.document,
    ...(args.placement ? { explicitPlacement: args.placement } : {}),
    imageUrl: urlData.publicUrl,
    opts: args.image,
  });
  const patchResult = await args.liveCanvasService.patchDocument(
    args.user,
    args.canvasId,
    {
      baseVersion: liveState.version,
      operations: plan.operations,
      selection: [plan.elementId],
      transactionId: args.transactionId,
    },
  );
  return {
    elementId: plan.elementId,
    nextVersion: patchResult.version,
    operationCount: plan.operations.length,
  };
}
