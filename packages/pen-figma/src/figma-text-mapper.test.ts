// @ts-nocheck
import { describe, expect, it } from "vitest";
import { mapFigmaTextProps } from "./figma-text-mapper.js";

describe("mapFigmaTextProps", () => {
  it("preserves root and segment text case with rich segment metrics", () => {
    const props = mapFigmaTextProps({
      fontName: {
        family: "Inter",
        style: "Semi Bold Italic",
        postscript: "Inter-SemiBoldItalic",
      },
      fontSize: 20,
      textCase: "UPPER",
      textDecoration: "UNDERLINE",
      lineHeight: { units: "PIXELS", value: 30 },
      letterSpacing: { units: "PERCENT", value: 5 },
      paragraphSpacing: 12,
      paragraphIndent: 18,
      listSpacing: 6,
      listType: "UNORDERED",
      baselineShift: 2,
      opentypeFlags: { liga: false, ss01: true },
      fontFallbacks: [{ family: "Arial" }, { postscript: "HelveticaNeue" }],
      textData: {
        characters: "Hi ok",
        characterStyleIDs: [1, 1, 1, 2, 2],
        styleOverrideTable: [
          {},
          {
            fontName: {
              family: "Inter",
              style: "Regular",
              postscript: "Inter-Regular",
            },
            fontSize: 20,
          },
          {
            fontName: {
              family: "IBM Plex Sans",
              style: "Bold",
              postscript: "IBMPlexSans-Bold",
            },
            fontSize: 24,
            textCase: "LOWER",
            textDecoration: "STRIKETHROUGH",
            lineHeight: { units: "PERCENT", value: 125 },
            letterSpacing: { units: "PIXELS", value: 1.5 },
            baselineShift: -1,
            openTypeFeatures: { kern: false },
            fallbackFontNames: [{ family: "Noto Sans" }],
            fillPaints: [
              {
                type: "SOLID",
                opacity: 0.75,
                blendMode: "MULTIPLY",
                color: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
              },
              {
                type: "GRADIENT_LINEAR",
                visible: false,
                stops: [
                  { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
                  { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(props).toMatchObject({
      content: [
        {
          text: "HI ",
          fontFamily: "Inter",
          fontPostScriptName: "Inter-Regular",
          fontSize: 20,
          fontWeight: 400,
        },
        {
          text: "ok",
          fontFamily: "IBM Plex Sans",
          fontPostScriptName: "IBMPlexSans-Bold",
          fontSize: 24,
          fontWeight: 700,
          strikethrough: true,
          lineHeight: 1.25,
          letterSpacing: 1.5,
          baselineShift: -1,
          openTypeFeatures: { kern: false },
          fontFallback: ["Noto Sans"],
          fill: "#1a334d",
          fills: [
            {
              type: "solid",
              color: "#1a334d",
              opacity: 0.75,
              blendMode: "multiply",
            },
            {
              type: "linear_gradient",
              angle: 0,
              visible: false,
              stops: [
                { offset: 0, color: "#ff0000" },
                { offset: 1, color: "#0000ff" },
              ],
            },
          ],
          textCase: "lower",
        },
      ],
      fontFamily: "Inter",
      fontPostScriptName: "Inter-SemiBoldItalic",
      fontSize: 20,
      fontWeight: 600,
      fontStyle: "italic",
      lineHeight: 1.5,
      letterSpacing: 1,
      paragraphSpacing: 12,
      listStyle: "unordered",
      indent: 18,
      hangingIndent: 6,
      baselineShift: 2,
      openTypeFeatures: { liga: false, ss01: true },
      fontFallback: ["Arial", "HelveticaNeue"],
      underline: true,
      textCase: "upper",
    });
  });
});
