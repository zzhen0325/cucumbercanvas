import { describe, it, expect } from 'vitest';
import { TypedEventEmitter } from '../core/event-emitter.js';

interface TestEvents {
  'hello': (name: string) => void;
  'count': (n: number) => void;
}

describe('TypedEventEmitter', () => {
  it('should emit and receive events', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let received = '';
    emitter.on('hello', (name) => { received = name; });
    emitter.emit('hello', 'world');
    expect(received).toBe('world');
  });

  it('should return unsubscribe function', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let count = 0;
    const unsub = emitter.on('count', (n) => { count += n; });
    emitter.emit('count', 5);
    expect(count).toBe(5);
    unsub();
    emitter.emit('count', 10);
    expect(count).toBe(5);
  });

  it('should support multiple listeners', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const results: string[] = [];
    emitter.on('hello', (name) => results.push(`a:${name}`));
    emitter.on('hello', (name) => results.push(`b:${name}`));
    emitter.emit('hello', 'test');
    expect(results).toEqual(['a:test', 'b:test']);
  });

  it('should clear all listeners on dispose', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    let called = false;
    emitter.on('hello', () => { called = true; });
    emitter.dispose();
    emitter.emit('hello', 'nope');
    expect(called).toBe(false);
  });
});
