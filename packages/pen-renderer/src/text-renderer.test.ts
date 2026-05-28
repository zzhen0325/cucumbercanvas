import type { CanvasKit } from "canvaskit-wasm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkiaFontManager } from "./font-manager.js";
import {
  applyTextParagraphLayout,
  buildBitmapStyledTextLines,
  getTextBaselineOffset,
  getTextParagraphPrefix,
  getTextVerticalOffset,
  withTextBaselineShift,
} from "./text-renderer.js";

function createFontManager(registeredFamilies: string[] = []): SkiaFontManager {
  const provider = {
    registerFont: vi.fn((_data: ArrayBuffer, family: string) => {
      registeredFamilies.push(family);
    }),
    delete: vi.fn(),
  };
  const ck = {
    TypefaceFontProvider: {
      Make: () => provider,
    },
  } as unknown as CanvasKit;
  return new SkiaFontManager(ck);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getTextVerticalOffset", () => {
  it("keeps top-aligned text at the text box origin", () => {
    expect(getTextVerticalOffset("top", 120, 40)).toBe(0);
    expect(getTextVerticalOffset(undefined, 120, 40)).toBe(0);
  });

  it("centers middle-aligned text in the available vertical space", () => {
    expect(getTextVerticalOffset("middle", 120, 40)).toBe(40);
  });

  it("bottom-aligns text to the lower edge of the box", () => {
    expect(getTextVerticalOffset("bottom", 120, 40)).toBe(80);
  });

  it("does not shift overflowing or invalid text boxes", () => {
    expect(getTextVerticalOffset("middle", 40, 120)).toBe(0);
    expect(getTextVerticalOffset("bottom", 0, 40)).toBe(0);
    expect(getTextVerticalOffset("bottom", 40, 0)).toBe(0);
  });
});

describe("applyTextParagraphLayout", () => {
  it("adds unordered list markers without mutating blank lines", () => {
    expect(
      applyTextParagraphLayout("Alpha\n\nBeta", {
        listStyle: "unordered",
        fontSize: 16,
      }),
    ).toBe("• Alpha\n\n• Beta");
  });

  it("numbers non-empty ordered list paragraphs", () => {
    expect(
      applyTextParagraphLayout("Alpha\nBeta", {
        listStyle: "ordered",
        fontSize: 16,
      }),
    ).toBe("1. Alpha\n2. Beta");
  });

  it("approximates Figma paragraph indent in the rendered text stream", () => {
    expect(getTextParagraphPrefix(0, { indent: 16, fontSize: 16 })).toBe("  ");
    expect(
      applyTextParagraphLayout("Indented", { indent: 16, fontSize: 16 }),
    ).toBe("  Indented");
  });

  it("approximates Figma paragraph spacing as extra rendered line breaks", () => {
    expect(
      applyTextParagraphLayout("Alpha\nBeta", {
        paragraphSpacing: 20,
        fontSize: 16,
        lineHeight: 1.2,
      }),
    ).toBe("Alpha\n\nBeta");
  });
});

describe("getTextBaselineOffset", () => {
  it("maps Figma positive baseline shift to an upward draw offset", () => {
    expect(getTextBaselineOffset(4)).toBe(-4);
    expect(getTextBaselineOffset(-3)).toBe(3);
    expect(getTextBaselineOffset(undefined)).toBe(0);
  });

  it("adds a CanvasKit-compatible run baseline shift only when needed", () => {
    expect(withTextBaselineShift({ fontSize: 16 }, 5)).toMatchObject({
      fontSize: 16,
      baselineShift: -5,
    });
    expect(withTextBaselineShift({ fontSize: 16 })).toEqual({ fontSize: 16 });
  });
});

describe("buildBitmapStyledTextLines", () => {
  it("preserves per-run bitmap fallback text styles across segment line breaks", () => {
    expect(
      buildBitmapStyledTextLines(
        [
          {
            text: "A",
            fontSize: 20,
            fontWeight: 700,
            fontFamily: "Inter",
            fontStyle: "italic",
            fills: [{ type: "solid", color: "#ff0000" }],
            baselineShift: 3,
          },
          {
            text: "B\nC",
            fill: "#00ff00",
          },
        ],
        {
          fontSize: 16,
          fontWeight: "400",
          fontFamily: "Root",
          fillColor: "#111111",
        },
      ),
    ).toEqual([
      {
        text: "AB",
        runs: [
          {
            text: "A",
            fontSize: 20,
            fontWeight: 700,
            fontFamily: "Inter",
            fontStyle: "italic",
            fillColor: "#ff0000",
            baselineShift: 3,
            underline: undefined,
            strikethrough: undefined,
          },
          {
            text: "B",
            fontSize: 16,
            fontWeight: "400",
            fontFamily: "Root",
            fontStyle: undefined,
            fillColor: "#00ff00",
            baselineShift: undefined,
            underline: undefined,
            strikethrough: undefined,
          },
        ],
      },
      {
        text: "C",
        runs: [
          {
            text: "C",
            fontSize: 16,
            fontWeight: "400",
            fontFamily: "Root",
            fontStyle: undefined,
            fillColor: "#00ff00",
            baselineShift: undefined,
            underline: undefined,
            strikethrough: undefined,
          },
        ],
      },
    ]);
  });

  it("keeps Figma text decoration metadata in bitmap fallback runs", () => {
    expect(
      buildBitmapStyledTextLines(
        [
          {
            text: "Root underline",
            fontFamily: "Inter",
          },
          {
            text: "Strike",
            strikethrough: true,
            underline: false,
          },
        ],
        {
          fontSize: 16,
          fontWeight: "400",
          fontFamily: "Root",
          fillColor: "#111111",
          underline: true,
        },
      )[0]?.runs,
    ).toEqual([
      expect.objectContaining({
        text: "Root underline",
        underline: true,
        strikethrough: undefined,
      }),
      expect.objectContaining({
        text: "Strike",
        underline: false,
        strikethrough: true,
      }),
    ]);
  });
});

describe("SkiaFontManager PostScript matching", () => {
  it("prioritizes a loaded PostScript font alias before the family fallback", () => {
    const manager = createFontManager();

    manager.registerFont(new ArrayBuffer(1), "Inter");
    manager.registerFont(new ArrayBuffer(1), "Inter-SemiBoldItalic");

    expect(manager.getFallbackChain("Inter", "Inter-SemiBoldItalic")).toEqual([
      "Inter-SemiBoldItalic",
      "Inter",
    ]);

    manager.dispose();
  });

  it("loads native font data under the exact PostScript alias", async () => {
    const registeredFamilies: string[] = [];
    const manager = createFontManager(registeredFamilies);
    vi.stubGlobal("window", {
      queryLocalFonts: vi.fn(async () => [
        {
          family: "Inter",
          fullName: "Inter Semi Bold Italic",
          postscriptName: "Inter-SemiBoldItalic",
          style: "Semi Bold Italic",
          blob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])])),
        },
      ]),
    });

    await expect(
      manager.ensureFontByPostScript("Inter-SemiBoldItalic", "Inter"),
    ).resolves.toBe(true);

    expect(registeredFamilies).toContain("Inter-SemiBoldItalic");
    expect(manager.isPostScriptFontReady("Inter-SemiBoldItalic")).toBe(true);

    manager.dispose();
  });
});
