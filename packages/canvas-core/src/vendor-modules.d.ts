declare module "kiwi-schema" {
  export class ByteBuffer {
    constructor(buffer: Uint8Array | ArrayBuffer);
  }

  export function compileSchema(
    schema: unknown,
  ): Record<string, ((bb: ByteBuffer) => unknown) | unknown>;

  export function decodeBinarySchema(bb: ByteBuffer): unknown;
}

declare module "fzstd" {
  export function decompress(bytes: Uint8Array): Uint8Array;
}

declare module "uzip" {
  export function parse(buffer: ArrayBuffer): Record<string, Uint8Array>;
  export function inflateRaw(bytes: Uint8Array): Uint8Array;
}
