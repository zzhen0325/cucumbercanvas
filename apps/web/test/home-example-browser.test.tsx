// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HomeExampleBrowser } from "@/components/home-example-browser";
import { homeExampleSeedCategories } from "@/lib/home-example-seeds";

describe("HomeExampleBrowser", () => {

  it("expands Seedream image examples after clicking the image chip", async () => {
    render(
      <HomeExampleBrowser
        categories={homeExampleSeedCategories}
        onExampleSelect={vi.fn()}
      />,
    );

    expect(
      screen.queryByText("Campaign key visual"),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Seedream Image" }));

    expect(
      await screen.findByText("Campaign key visual"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Product poster"),
    ).toBeInTheDocument();
  });

  it("auto-selects the first example when a category chip is clicked", async () => {
    const onExampleSelect = vi.fn();

    render(
      <HomeExampleBrowser
        categories={homeExampleSeedCategories}
        onExampleSelect={onExampleSelect}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Seedream Image" }));

    expect(onExampleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryKey: "seedream-image",
        categoryLabel: "Seedream Image",
        title: "Campaign key visual",
        prompt:
          "Generate a clean campaign key visual for a modern cucumber-flavored sparkling water brand. Use fresh green accents, natural light, realistic product photography, and leave room for a headline.",
        previewImages: expect.arrayContaining([expect.stringContaining("og-image.png")]),
      }),
    );
  });

  it("calls onExampleSelect with the picked example payload", async () => {
    const onExampleSelect = vi.fn();

    render(
      <HomeExampleBrowser
        categories={homeExampleSeedCategories}
        onExampleSelect={onExampleSelect}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Seedream Image" }));
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Product poster/i,
      }),
    );

    expect(onExampleSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryKey: "seedream-image",
        categoryLabel: "Seedream Image",
        title: "Product poster",
        prompt:
          "Create a premium product poster for a minimalist skincare bottle on a wet stone surface. Soft daylight, crisp shadows, high-end editorial style.",
        previewImages: expect.arrayContaining([expect.stringContaining("og-image.png")]),
        inputMentions: [
          { type: "tool", name: "Seedream 4.6", imgSrc: "/favicon.svg" },
        ],
      }),
    );
  });
});
