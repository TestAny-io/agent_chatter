import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { ReplMode } from '../../src/repl/ReplMode.js';

class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn();
  resume = vi.fn();
  pause = vi.fn();
}

describe('ReplMode exit handling', () => {
  let mockStdin: MockStdin;
  let stdinSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    mockStdin = new MockStdin();
    stdinSpy = vi.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);
  });

  afterEach(() => {
    stdinSpy.mockRestore();
  });

  it('handles Ctrl+C without calling process.exit', () => {
    const repl = new ReplMode();

    mockStdin.emit('keypress', '', { ctrl: true, name: 'c' });

    expect((repl as any).exitMessageShown).toBe(true);
    expect(process.exitCode ?? 0).toBe(0);
  });
});
