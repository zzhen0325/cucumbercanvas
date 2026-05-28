// @ts-nocheck
import type { PenNode } from "@cucumber/pen-types";
import type { ImageFill } from "@cucumber/pen-types";

/**
 * Resolve __blob:N and __hash:<hex> references in the PenNode tree to data URLs
 * using extracted image blobs and ZIP image files from the .fig file.
 */
export function resolveImageBlobs(
  nodes: PenNode[],
  imageBlobs: Map<number, Uint8Array>,
  imageFiles?: Map<string, Uint8Array>,
): number {
  if (imageBlobs.size === 0 && (!imageFiles || imageFiles.size === 0)) return 0;

  // Convert blobs to data URLs
  const dataUrls = new Map<number, string>();
  for (const [index, bytes] of imageBlobs) {
    dataUrls.set(index, blobToDataUrl(bytes));
  }

  // Convert hash-based image files to data URLs
  const hashDataUrls = new Map<string, string>();
  if (imageFiles) {
    for (const [hash, bytes] of imageFiles) {
      hashDataUrls.set(hash, blobToDataUrl(bytes));
    }
  }

  let resolved = 0;
  for (const node of nodes) {
    resolved += patchNode(node, dataUrls, hashDataUrls);
  }
  return resolved;
}

function blobToDataUrl(bytes: Uint8Array): string {
  // Detect MIME type from magic bytes
  let mime = "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = "image/jpeg";
  } else if (bytes[0] === 0x47 && bytes[1] === 0x49) {
    mime = "image/gif";
  } else if (bytes[0] === 0x52 && bytes[1] === 0x49) {
    mime = "image/webp";
  }

  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.byteLength; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  return Buffer.from(bytes).toString("base64");
}

function resolveRef(
  src: string,
  dataUrls: Map<number, string>,
  hashDataUrls: Map<string, string>,
): string | null {
  if (src.startsWith("__blob:")) {
    const index = Number.parseInt(src.slice(7), 10);
    return dataUrls.get(index) ?? null;
  }
  if (src.startsWith("__hash:")) {
    const hash = src.slice(7);
    return hashDataUrls.get(hash) ?? null;
  }
  return null;
}

function isUnresolvedImageRef(url: unknown): url is string {
  return (
    typeof url === "string" &&
    (url.startsWith("__blob:") || url.startsWith("__hash:"))
  );
}

function patchImageFillArray(
  fills: unknown,
  dataUrls: Map<number, string>,
  hashDataUrls: Map<string, string>,
): number {
  if (!Array.isArray(fills)) return 0;

  let resolved = 0;
  for (const fill of fills) {
    if (fill?.type !== "image") continue;
    const imgFill = fill as ImageFill;
    if (!isUnresolvedImageRef(imgFill.url)) continue;

    const url = resolveRef(imgFill.url, dataUrls, hashDataUrls);
    if (url) {
      imgFill.url = url;
      resolved++;
    }
  }
  return resolved;
}

function patchNode(
  node: PenNode,
  dataUrls: Map<number, string>,
  hashDataUrls: Map<string, string>,
): number {
  let resolved = 0;
  const record = node as PenNode & {
    fill?: unknown;
    fills?: unknown;
    stroke?: { fill?: unknown };
    children?: unknown;
  };

  // Patch ImageNode src
  if (
    node.type === "image" &&
    node.src &&
    isUnresolvedImageRef(node.src)
  ) {
    const url = resolveRef(node.src, dataUrls, hashDataUrls);
    if (url) {
      node.src = url;
      resolved++;
    }
  }

  // Patch image fills on node fills, legacy plural fills, and stroke fills.
  resolved += patchImageFillArray(record.fill, dataUrls, hashDataUrls);
  resolved += patchImageFillArray(record.fills, dataUrls, hashDataUrls);
  resolved += patchImageFillArray(record.stroke?.fill, dataUrls, hashDataUrls);

  // Recurse into children
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      resolved += patchNode(child, dataUrls, hashDataUrls);
    }
  }

  return resolved;
}
