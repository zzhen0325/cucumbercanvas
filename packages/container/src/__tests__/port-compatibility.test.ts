import { describe, it, expect } from 'vitest';
import { isPortCompatible } from '../dataflow/types.js';

describe('Port Compatibility', () => {
  it('image → image should be compatible', () => {
    expect(isPortCompatible('image', 'image')).toBe(true);
  });

  it('image → reference should be compatible', () => {
    expect(isPortCompatible('image', 'reference')).toBe(true);
  });

  it('text → text should be compatible', () => {
    expect(isPortCompatible('text', 'text')).toBe(true);
  });

  it('text → prompt should be compatible', () => {
    expect(isPortCompatible('text', 'prompt')).toBe(true);
  });

  it('json → json should be compatible', () => {
    expect(isPortCompatible('json', 'json')).toBe(true);
  });

  it('image → text should NOT be compatible', () => {
    expect(isPortCompatible('image', 'text')).toBe(false);
  });

  it('image → json should NOT be compatible', () => {
    expect(isPortCompatible('image', 'json')).toBe(false);
  });

  it('text → image should NOT be compatible', () => {
    expect(isPortCompatible('text', 'image')).toBe(false);
  });

  it('json → text should NOT be compatible', () => {
    expect(isPortCompatible('json', 'text')).toBe(false);
  });

  it('prompt → text should NOT be compatible', () => {
    expect(isPortCompatible('prompt', 'text')).toBe(false);
  });

  it('reference → image should NOT be compatible', () => {
    expect(isPortCompatible('reference', 'image')).toBe(false);
  });
});
