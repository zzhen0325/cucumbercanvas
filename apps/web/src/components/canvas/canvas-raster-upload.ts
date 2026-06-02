import type {
  ClipboardImportFile,
  ClipboardImportPayload,
} from "@cucumber/canvas-core";

import { uploadFile } from "@/lib/server-api";

export async function uploadRasterFilesInPayload(
  payload: ClipboardImportPayload,
  options: { accessToken?: string; projectId?: string },
): Promise<ClipboardImportPayload> {
  const files = payload.files ?? [];
  const rasterFiles = files.filter(shouldUploadClipboardRasterFile);
  if (rasterFiles.length === 0) return payload;
  if (!options.accessToken || !options.projectId) {
    throw new Error(
      "图片导入需要有效的项目和登录上下文，无法将本地图片上传到画布资产库。",
    );
  }

  const uploadedFiles = await Promise.all(
    files.map(async (file) => {
      if (!shouldUploadClipboardRasterFile(file)) return file;
      const upload = await uploadFile(
        options.accessToken as string,
        dataUrlToFile(file),
        options.projectId as string,
      );
      console.info("[skia-canvas] clipboard.raster-uploaded", {
        assetId: upload.asset.id,
        mimeType: file.type,
        name: file.name,
        projectId: options.projectId,
      });
      return { ...file, dataUrl: upload.url };
    }),
  );

  return { ...payload, files: uploadedFiles };
}

export function shouldUploadClipboardRasterFile(
  file: ClipboardImportFile,
): boolean {
  return (
    typeof file.dataUrl === "string" &&
    file.dataUrl.startsWith("data:") &&
    file.type.startsWith("image/") &&
    file.type !== "image/svg+xml"
  );
}

function dataUrlToFile(file: ClipboardImportFile): File {
  if (!file.dataUrl) {
    throw new Error(`图片 ${file.name ?? file.type} 缺少可上传的数据内容。`);
  }
  const match = file.dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match?.[1] || !match[2]) {
    throw new Error(`图片 ${file.name ?? file.type} 的 data URL 格式无效。`);
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File(
    [bytes],
    file.name ?? `canvas-import.${mimeToExt(match[1])}`,
    {
      type: match[1],
    },
  );
}

function mimeToExt(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}
