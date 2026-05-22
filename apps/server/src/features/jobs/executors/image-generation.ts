import { generateImage } from "../../../generation/image-generation.js";
import { resolveImageProviderName } from "../../../generation/providers/registry.js";
import type { GeneratedImage } from "../../../generation/types.js";
import {
  insertImageElement,
  markImageGenerationGroupFailed,
  replaceImageGenerationPlaceholder,
} from "../../canvas/canvas-element-writer.js";
import { type ExecutorContext, registerExecutor } from "../job-executor.js";
import { persistInlineInputImages } from "./inline-input-images.js";

registerExecutor(
  "image_generation",
  async (jobId, _rawPayload, ctx: ExecutorContext) => {
    const t0 = Date.now();

    // Read the full job row including payload from the database.
    // The PGMQ message only contains { job_id, job_type, workspace_id },
    // so we must fetch prompt/model/aspect_ratio from background_jobs.payload.
    const admin = ctx.getAdminClient();
    const { data: jobRow } = await admin
      .from("background_jobs")
      .select("created_by, workspace_id, canvas_id, session_id, payload")
      .eq("id", jobId)
      .single();

    if (!jobRow) throw new Error(`Job ${jobId} not found in database`);

    // Build log tag with traceability context: jobId + sessionId (if available)
    const sessionShort =
      (jobRow.session_id as string)?.slice(0, 8) ?? "no-session";
    const tag = `[image-job:${jobId.slice(0, 8)} session:${sessionShort}]`;
    const lap = (label: string) =>
      console.log(`${tag} ${label} +${Date.now() - t0}ms`);
    lap("db_fetch");

    const payload = (jobRow.payload ?? {}) as {
      prompt: string;
      model?: string;
      aspect_ratio?: string;
      title?: string;
      input_images?: string[];
      image_generation_group_id?: string;
      image_placeholder_id?: string;
    };

    if (!payload.prompt)
      throw new Error(`Job ${jobId} has no prompt in payload`);

    const createdBy: string | null = jobRow.created_by ?? null;
    const workspaceId: string = jobRow.workspace_id ?? jobId;

    // Resolve provider dynamically from model ID via registry
    const model = payload.model ?? "bytedance/seedream-4.6";
    const providerName = resolveImageProviderName(model);

    // Renew the task lease every 60s (half of the 120s image worker lease)
    // so another worker does not reclaim the same job mid-flight.
    const IMAGE_LEASE_SECONDS = 120;
    const heartbeatTimer = setInterval(() => {
      ctx.renewLease(IMAGE_LEASE_SECONDS);
    }, 60_000);

    // Log input image format for debugging the data-URI-passthrough pipeline
    if (payload.input_images?.length) {
      const formats = payload.input_images.map((img) =>
        img.startsWith("data:") ? "data-uri" : "url",
      );
      console.log(
        `${tag} input_images formats: [${formats.join(", ")}] (${formats.length} total)`,
      );
    }

    try {
      const normalizedInputImages = await persistInlineInputImages({
        admin,
        ...(payload.input_images ? { inputImages: payload.input_images } : {}),
        jobId,
        loggerTag: tag,
        workspaceId,
      });

      // Generate image via the registered provider
      lap(`${providerName}_call_start`);
      let generated: GeneratedImage;
      try {
        generated = await generateImage(providerName, {
          prompt: payload.prompt,
          model,
          ...(payload.aspect_ratio !== undefined
            ? { aspectRatio: payload.aspect_ratio }
            : {}),
          ...(normalizedInputImages?.length
            ? { inputImages: normalizedInputImages }
            : {}),
        });
      } catch (genError) {
        const detail =
          genError instanceof Error ? genError.message : String(genError);
        const wrapped = new Error(
          `Image generation failed for model ${model}: ${detail}`,
        );
        (wrapped as Error & { code?: string }).code =
          (genError as { code?: string })?.code ?? "executor_error";
        throw wrapped;
      }
      lap(`${providerName}_call_done`);

      // Download the generated image from the provider CDN
      const response = await fetch(generated.url);
      if (!response.ok) {
        throw new Error(
          `Failed to download generated image from ${model}: ${response.status} ${response.statusText}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer: Buffer = Buffer.from(arrayBuffer);
      lap("image_download_done");

      // Upload to Supabase Storage under the project-assets bucket
      const timestamp = Date.now();
      const objectPath = `${workspaceId}/generated/${timestamp}-${jobId}.png`;

      const { error: uploadError } = await admin.storage
        .from("project-assets")
        .upload(objectPath, buffer, {
          contentType: generated.mimeType ?? "image/png",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }
      lap("storage_upload_done");

      // Insert asset_objects record — only include created_by if we have a valid user UUID
      const { data: assetRow, error: assetError } = await admin
        .from("asset_objects")
        .insert({
          workspace_id: workspaceId,
          bucket: "project-assets",
          object_path: objectPath,
          mime_type: generated.mimeType ?? "image/png",
          byte_size: buffer.length,
          ...(createdBy ? { created_by: createdBy } : {}),
        })
        .select("id")
        .single();

      if (assetError || !assetRow) {
        throw new Error(
          `Failed to create asset record: ${assetError?.message ?? "unknown error"}`,
        );
      }

      lap("asset_record_done");

      // Generate a public URL for the result consumer
      const { data: urlData } = admin.storage
        .from("project-assets")
        .getPublicUrl(objectPath);

      let elementId: string | undefined;
      if (jobRow.canvas_id && payload.image_placeholder_id) {
        const replaceResult = await replaceImageGenerationPlaceholder(admin, {
          canvasId: jobRow.canvas_id as string,
          placeholderId: payload.image_placeholder_id,
          ...(payload.image_generation_group_id
            ? { groupId: payload.image_generation_group_id }
            : {}),
          objectPath,
          width: generated.width,
          height: generated.height,
          mimeType: generated.mimeType ?? "image/png",
          title: payload.title ?? payload.prompt.slice(0, 80),
          prompt: payload.prompt,
          model,
          jobId,
          ...(jobRow.session_id
            ? { sessionId: jobRow.session_id as string }
            : {}),
        });
        elementId = replaceResult.elementId;
        lap("canvas_placeholder_replaced");
      } else if (jobRow.canvas_id) {
        const insertResult = await insertImageElement(admin, {
          canvasId: jobRow.canvas_id as string,
          objectPath,
          width: generated.width,
          height: generated.height,
          mimeType: generated.mimeType ?? "image/png",
          title: payload.title ?? payload.prompt.slice(0, 80),
        });
        elementId = insertResult.elementId;
        lap("canvas_image_inserted");
      }

      lap("total");
      return {
        asset_id: (assetRow as { id: string }).id,
        signed_url: urlData.publicUrl,
        object_path: objectPath,
        ...(payload.image_generation_group_id
          ? { group_id: payload.image_generation_group_id }
          : {}),
        ...(payload.image_placeholder_id
          ? { placeholder_id: payload.image_placeholder_id }
          : {}),
        ...(elementId ? { element_id: elementId } : {}),
        width: generated.width,
        height: generated.height,
        mime_type: generated.mimeType ?? "image/png",
      };
    } catch (err) {
      if (jobRow.canvas_id && payload.image_placeholder_id) {
        const detail = err instanceof Error ? err.message : String(err);
        try {
          await markImageGenerationGroupFailed(admin, {
            canvasId: jobRow.canvas_id as string,
            placeholderId: payload.image_placeholder_id,
            ...(payload.image_generation_group_id
              ? { groupId: payload.image_generation_group_id }
              : {}),
            errorMessage: detail,
          });
          lap("canvas_placeholder_marked_failed");
        } catch (markErr) {
          console.error(
            `${tag} failed to mark canvas placeholder as failed:`,
            markErr,
          );
        }
      }
      throw err;
    } finally {
      clearInterval(heartbeatTimer);
    }
  },
);
