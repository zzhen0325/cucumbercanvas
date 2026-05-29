import { tool } from "langchain";
import { z } from "zod";

import type { Database } from "@cucumber/shared";

import type { UserSupabaseClient } from "../../supabase/user.js";

const brandKitSchema = z.object({});

type BrandKitAsset = Pick<
  Database["public"]["Tables"]["brand_kit_assets"]["Row"],
  | "asset_type"
  | "display_name"
  | "file_url"
  | "metadata"
  | "role"
  | "text_content"
>;

type SignedUrlEntry = {
  path?: string | null;
  signedUrl?: string | null;
};

type BrandKitToolConfig = {
  configurable?: {
    access_token?: unknown;
  };
};

export function createBrandKitTool(
  deps: { createUserClient: (accessToken: string) => UserSupabaseClient },
  brandKitId: string,
) {
  return tool(
    async (_input, config) => {
      const accessToken = readAccessToken(config);
      if (!accessToken) {
        return JSON.stringify({ error: "No access token available" });
      }

      const client = deps.createUserClient(accessToken);

      // Fetch kit
      const { data: kit } = await client
        .from("brand_kits")
        .select("id, name, guidance_text")
        .eq("id", brandKitId)
        .maybeSingle();

      if (!kit) {
        return JSON.stringify({ error: "Brand kit not found" });
      }

      // Fetch assets
      const { data: assets } = await client
        .from("brand_kit_assets")
        .select(
          "asset_type, display_name, role, text_content, file_url, metadata",
        )
        .eq("kit_id", brandKitId)
        .order("sort_order", { ascending: true });

      const safeAssets = assets ?? [];

      // Resolve signed URLs for file-based assets (logo/image)
      const fileAssets = safeAssets.filter(hasFileUrl);
      if (fileAssets.length > 0) {
        const paths = fileAssets.map((asset) => asset.file_url);
        const { data: signedData } = await client.storage
          .from("brand-kit-assets")
          .createSignedUrls(paths, 3600);

        if (signedData) {
          const urlByPath = new Map(
            signedData
              .filter(isSignedUrlEntry)
              .map((entry) => [entry.path, entry.signedUrl]),
          );
          for (const asset of fileAssets) {
            const url = urlByPath.get(asset.file_url);
            if (url) asset.file_url = url;
          }
        }
      }

      const result = {
        kit_name: kit.name,
        design_guidance: kit.guidance_text ?? "",
        colors: safeAssets
          .filter((a) => a.asset_type === "color")
          .map((a) => ({
            name: a.display_name,
            hex: a.text_content,
            role: a.role,
          })),
        fonts: safeAssets
          .filter((a) => a.asset_type === "font")
          .map((a) => ({
            name: a.display_name,
            family: a.text_content,
            weight: readFontWeight(a.metadata),
            role: a.role,
          })),
        logos: safeAssets
          .filter((a) => a.asset_type === "logo")
          .map((a) => ({
            name: a.display_name,
            url: a.file_url,
            role: a.role,
          })),
        images: safeAssets
          .filter((a) => a.asset_type === "image")
          .map((a) => ({
            name: a.display_name,
            url: a.file_url,
          })),
      };

      return JSON.stringify(result, null, 2);
    },
    {
      name: "get_brand_kit",
      description:
        "查询当前项目绑定的品牌套件信息，包含设计指南、颜色、字体、Logo等品牌资产。当用户提到品牌、风格、设计规范时使用此工具。",
      schema: brandKitSchema,
    },
  );
}

function readAccessToken(config: unknown): string | null {
  if (!isRecord(config)) {
    return null;
  }

  const toolConfig = config as BrandKitToolConfig;
  const accessToken = toolConfig.configurable?.access_token;
  return typeof accessToken === "string" && accessToken.length > 0
    ? accessToken
    : null;
}

function hasFileUrl(
  asset: BrandKitAsset,
): asset is BrandKitAsset & { file_url: string } {
  return typeof asset.file_url === "string" && asset.file_url.length > 0;
}

function isSignedUrlEntry(entry: SignedUrlEntry): entry is {
  path: string;
  signedUrl: string;
} {
  return (
    typeof entry.path === "string" &&
    entry.path.length > 0 &&
    typeof entry.signedUrl === "string" &&
    entry.signedUrl.length > 0
  );
}

function readFontWeight(metadata: BrandKitAsset["metadata"]): string {
  if (!isRecord(metadata)) {
    return "400";
  }

  const weight = metadata.weight;
  if (typeof weight === "string" && weight.length > 0) {
    return weight;
  }
  if (typeof weight === "number" && Number.isFinite(weight)) {
    return String(weight);
  }

  return "400";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
