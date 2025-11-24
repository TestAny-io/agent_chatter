import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock heavy dependencies before importing cli
vi.mock('../../src/utils/ToolDetector.js', () => ({
  detectAllTools: vi.fn(async () => [
    { displayName: 'claude', installed: true }
  ])
}));

const initMock = vi.fn(async () => ({
  coordinator: {} as any,
  team: {} as any
}));
const startConversationMock = vi.fn(async () => {});

vi.mock('../../src/utils/ConversationStarter.js', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    initializeServices: initMock,
    startConversation: startConversationMock
  };
});

describe('cli run exit behavior', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    initMock.mockClear();
    startConversationMock.mockClear();
    vi.resetModules();
  });

  it('sets exitCode on unknown command', async () => {
    const { run } = await import('../../src/cli.js');
    await run(['node', 'cli.js', 'unknown-command']);
    expect(process.exitCode).toBe(1);
  });

  it('prints version once and exits 0', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { run } = await import('../../src/cli.js');
    await run(['node', 'cli.js', '--version']);

    const output = writeSpy.mock.calls.map(c => String(c[0])).join('');
    const count = (output.match(new RegExp(pkg.version, 'g')) || []).length
      + (logSpy.mock.calls.flat().join('').match(new RegExp(pkg.version, 'g')) || []).length;

    expect(count).toBe(1);
    expect(process.exitCode ?? 0).toBe(0);

    writeSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('runs start command successfully without setting exitCode', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-exit-'));
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      schemaVersion: '1.1',
      agents: [{ name: 'claude', args: [], usePty: false }],
      team: { name: 't', description: 'd', members: [] }
    }));

    const { run } = await import('../../src/cli.js');
    await run(['node', 'cli.js', 'start', '-c', configPath, '-m', 'hello']);

    expect(initMock).toHaveBeenCalled();
    expect(startConversationMock).toHaveBeenCalled();
    expect(process.exitCode ?? 0).toBe(0);
  });
});
