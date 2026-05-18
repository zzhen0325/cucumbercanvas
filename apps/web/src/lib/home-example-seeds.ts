export type InputMention = {
  type: "image" | "tool";
  name: string;
  imgSrc: string;
};

export type HomeExampleCard = {
  title: string;
  prompt: string;
  previewImages: string[];
  inputMentions: InputMention[];
};

export type HomeExampleCategory = {
  key: string;
  label: string;
  dataType: string;
  accent?: "special";
  examples: HomeExampleCard[];
};

export type HomeExampleSelection = {
  categoryKey: string;
  categoryLabel: string;
  title: string;
  prompt: string;
  previewImages: string[];
  inputMentions: InputMention[];
};

function ex(
  title: string,
  prompt: string,
  previewImages: string[],
  inputMentions: InputMention[],
): HomeExampleCard {
  return { title, prompt, previewImages, inputMentions };
}

function cat(
  key: string,
  label: string,
  dataType: string,
  examples: HomeExampleCard[],
  accent?: "special",
): HomeExampleCategory {
  return { key, label, dataType, examples, ...(accent ? { accent } : {}) };
}

function tool(name: string): InputMention {
  return { type: "tool", name, imgSrc: "/favicon.svg" };
}

const previewImages = ["/og-image.png", "/og-image.png", "/og-image.png"];

export const homeExampleSeedCategories: HomeExampleCategory[] = [
  cat(
    "seedream-image",
    "Seedream Image",
    "Image",
    [
      ex(
        "Campaign key visual",
        "Generate a clean campaign key visual for a modern cucumber-flavored sparkling water brand. Use fresh green accents, natural light, realistic product photography, and leave room for a headline.",
        previewImages,
        [tool("Seedream 4.6")],
      ),
      ex(
        "Product poster",
        "Create a premium product poster for a minimalist skincare bottle on a wet stone surface. Soft daylight, crisp shadows, high-end editorial style.",
        previewImages,
        [tool("Seedream 4.6")],
      ),
    ],
    "special",
  ),
  cat("seedream-video", "Seedream Video", "Video", [
    ex(
      "Launch teaser",
      "Create a short product launch teaser: the bottle rotates slowly on a clean studio plinth, condensation beads catch the light, camera pushes in smoothly.",
      previewImages,
      [tool("Seedream Video")],
    ),
  ]),
];
