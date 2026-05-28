// @ts-nocheck
import { describe, expect, it } from "vitest";
import { mapFigmaFills } from "./figma-fill-mapper.js";

describe("mapFigmaFills", () => {
  it("preserves non-identity image transforms for cropped image fills", () => {
    const fills = mapFigmaFills([
      {
        type: "IMAGE",
        visible: true,
        opacity: 1,
        imageScaleMode: "CROP",
        originalImageWidth: 2644,
        originalImageHeight: 1696,
        transform: {
          m00: 0.9682299494743347,
          m01: 0,
          m02: 0.019307976588606834,
          m10: 0,
          m11: 0.9433962106704712,
          m12: 0.041042111814022064,
        },
        image: {
          hash: Uint8Array.from([
            0x1a, 0x5f, 0x26, 0xdd, 0xcd, 0x1f, 0xf2, 0xdb, 0x35, 0x95, 0xb8,
            0x45, 0xfb, 0xe9, 0xa1, 0x77, 0x1c, 0x46, 0xae, 0x3f,
          ]),
        },
      },
    ]);

    expect(fills).toEqual([
      {
        type: "image",
        url: "__hash:1a5f26ddcd1ff2db3595b845fbe9a1771c46ae3f",
        mode: "crop",
        originalSize: {
          width: 2644,
          height: 1696,
        },
        opacity: 1,
        transform: {
          m00: 0.9682299494743347,
          m01: 0,
          m02: 0.019307976588606834,
          m10: 0,
          m11: 0.9433962106704712,
          m12: 0.041042111814022064,
        },
      },
    ]);
  });

  it("drops identity image transforms to avoid noisy documents", () => {
    const fills = mapFigmaFills([
      {
        type: "IMAGE",
        visible: true,
        imageScaleMode: "STRETCH",
        transform: {
          m00: 1,
          m01: 0,
          m02: 0,
          m10: 0,
          m11: 1,
          m12: 0,
        },
        image: {
          dataBlob: 42,
        },
      },
    ]);

    expect(fills).toEqual([
      {
        type: "image",
        url: "__blob:42",
        mode: "stretch",
        opacity: undefined,
        transform: undefined,
      },
    ]);
  });

  it("preserves hidden paint layers and blend modes for editable fidelity", () => {
    const fills = mapFigmaFills([
      {
        type: "SOLID",
        visible: false,
        opacity: 0.4,
        blendMode: "MULTIPLY",
        color: { r: 1, g: 0, b: 0, a: 1 },
      },
      {
        type: "GRADIENT_ANGULAR",
        visible: true,
        blendMode: "SCREEN",
        stops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
      },
      {
        type: "GRADIENT_DIAMOND",
        stops: [
          { position: 0, color: { r: 0, g: 0, b: 1, a: 1 } },
          { position: 1, color: { r: 0, g: 1, b: 0, a: 1 } },
        ],
      },
    ]);

    expect(fills).toEqual([
      {
        type: "solid",
        color: "#ff0000",
        opacity: 0.4,
        visible: false,
        blendMode: "multiply",
      },
      {
        type: "angular_gradient",
        cx: 0.5,
        cy: 0.5,
        angle: 0,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
        blendMode: "screen",
      },
      {
        type: "diamond_gradient",
        cx: 0.5,
        cy: 0.5,
        radius: 0.5,
        angle: 0,
        stops: [
          { offset: 0, color: "#0000ff" },
          { offset: 1, color: "#00ff00" },
        ],
      },
    ]);
  });

  it("derives editable gradient geometry from Figma paint transforms", () => {
    const transform = {
      m00: 0.8,
      m01: 0.1,
      m02: 0.05,
      m10: 0.2,
      m11: 0.6,
      m12: 0.1,
    };
    const stops = [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
    ];

    const fills = mapFigmaFills([
      { type: "GRADIENT_LINEAR", transform, stops },
      { type: "GRADIENT_RADIAL", transform, stops },
      { type: "GRADIENT_ANGULAR", transform, stops },
      { type: "GRADIENT_DIAMOND", transform, stops },
    ]);

    expect(fills?.[0]).toMatchObject({
      type: "linear_gradient",
      angle: 76,
      transform,
    });
    expect(fills?.[0]?.type === "linear_gradient" && fills[0].x1).toBeCloseTo(
      0.1,
    );
    expect(fills?.[0]?.type === "linear_gradient" && fills[0].y1).toBeCloseTo(
      0.4,
    );
    expect(fills?.[0]?.type === "linear_gradient" && fills[0].x2).toBeCloseTo(
      0.9,
    );
    expect(fills?.[0]?.type === "linear_gradient" && fills[0].y2).toBeCloseTo(
      0.6,
    );
    expect(fills?.[1]).toMatchObject({
      type: "radial_gradient",
      cx: 0.5,
      cy: 0.5,
      transform,
    });
    expect(fills?.[1]?.type === "radial_gradient" && fills[1].radius).toBeCloseTo(
      0.3582,
      4,
    );
    expect(fills?.[2]).toMatchObject({
      type: "angular_gradient",
      cx: 0.5,
      cy: 0.5,
      angle: 76,
      transform,
    });
    expect(fills?.[3]).toMatchObject({
      type: "diamond_gradient",
      cx: 0.5,
      cy: 0.5,
      angle: 76,
      transform,
    });
    expect(fills?.[3]?.type === "diamond_gradient" && fills[3].radius).toBeCloseTo(
      0.3582,
      4,
    );
  });
});
