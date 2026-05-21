type StorageUploadClient = {
  storage: {
    from: (bucket: string) => {
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
      upload: (
        path: string,
        data: Buffer,
        options: {
          contentType: string;
          upsert: boolean;
        },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

const DATA_URI_PATTERN = /^data:([^;]+);base64,(.+)$/i;
const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function persistInlineInputImages(options: {
  admin: StorageUploadClient;
  inputImages?: string[];
  jobId: string;
  loggerTag?: string;
  workspaceId: string;
}): Promise<string[] | undefined> {
  if (!options.inputImages?.length) {
    return options.inputImages;
  }

  const normalized: string[] = [];

  for (const [index, image] of options.inputImages.entries()) {
    if (!/^data:/i.test(image)) {
      normalized.push(image);
      continue;
    }

    const parsed = decodeDataUri(image);
    const extension = MIME_EXTENSION_MAP[parsed.mimeType] ?? "bin";
    const objectPath = `${options.workspaceId}/generated/${Date.now()}-${options.jobId}-input-${index + 1}.${extension}`;
    const { error } = await options.admin.storage
      .from("project-assets")
      .upload(objectPath, parsed.buffer, {
        contentType: parsed.mimeType,
        upsert: false,
      });

    if (error) {
      throw new Error(
        `Failed to upload inline input image ${index + 1}: ${error.message}`,
      );
    }

    const { data } = options.admin.storage
      .from("project-assets")
      .getPublicUrl(objectPath);
    normalized.push(data.publicUrl);

    if (options.loggerTag) {
      console.log(
        `${options.loggerTag} inline_input_uploaded #${index + 1} -> ${objectPath}`,
      );
    }
  }

  return normalized;
}

export function decodeDataUri(dataUri: string): {
  buffer: Buffer;
  mimeType: string;
} {
  const match = DATA_URI_PATTERN.exec(dataUri);
  if (!match) {
    throw new Error("Invalid data URI. Expected base64-encoded inline image.");
  }

  const [, mimeType, base64] = match;
  if (!mimeType || !base64) {
    throw new Error("Invalid data URI. Missing mime type or payload.");
  }

  return {
    buffer: Buffer.from(base64, "base64"),
    mimeType,
  };
}
