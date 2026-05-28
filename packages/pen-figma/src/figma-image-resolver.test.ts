import type { PenNode } from "@cucumber/pen-types";
import { describe, expect, it } from "vitest";
import { resolveImageBlobs } from "./figma-image-resolver.js";

const pngHeader = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const jpegHeader = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

describe("resolveImageBlobs", () => {
  it("resolves blob and hash image references inside nodes, fills, and stroke fills", () => {
    const nodes = [
      {
        id: "image-node",
        type: "image",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        src: "__blob:2",
      },
      {
        id: "rect-node",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fill: [
          {
            type: "image",
            url: "__hash:abc123",
          },
        ],
        stroke: {
          thickness: 2,
          fill: [
            {
              type: "image",
              url: "__blob:3",
            },
          ],
        },
      },
    ] as PenNode[];

    const resolved = resolveImageBlobs(
      nodes,
      new Map([
        [2, pngHeader],
        [3, jpegHeader],
      ]),
      new Map([["abc123", jpegHeader]]),
    );

    expect(resolved).toBe(3);
    expect(nodes[0]?.type === "image" ? nodes[0].src : undefined).toMatch(
      /^data:image\/png;base64,/,
    );
    const fill = "fill" in nodes[1]! ? nodes[1].fill?.[0] : undefined;
    expect(fill?.type === "image" ? fill.url : undefined).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    const strokeFill =
      "stroke" in nodes[1]! ? nodes[1].stroke?.fill?.[0] : undefined;
    expect(
      strokeFill?.type === "image" ? strokeFill.url : undefined,
    ).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("keeps unresolved image references intact for diagnostics", () => {
    const nodes = [
      {
        id: "rect-node",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fill: [{ type: "image", url: "__hash:missing" }],
      },
    ] as PenNode[];

    expect(resolveImageBlobs(nodes, new Map(), new Map())).toBe(0);
    const fill = "fill" in nodes[0]! ? nodes[0].fill?.[0] : undefined;
    expect(fill?.type === "image" ? fill.url : undefined).toBe(
      "__hash:missing",
    );
  });
});
