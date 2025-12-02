import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentValidator } from '../../src/services/validation/AgentValidator.js';

describe('AgentValidator dry-run with proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass proxy environment variables during dry-run check', async () => {
    // Mock spawnWithTimeout to capture the environment variables
    const spawnSpy = vi.spyOn(AgentValidator.prototype as any, 'spawnWithTimeout')
      .mockResolvedValue({
        stdout: '{"content":"Hello"}',
        stderr: '',
        exitCode: 0
      });

    // Mock executable check to pass
    vi.spyOn(AgentValidator.prototype as any, 'checkExecutable')
      .mockResolvedValue({
        name: 'CLI Command Check',
        passed: true,
        message: 'claude found in PATH'
      });

    const validator = new AgentValidator({
      proxyUrl: 'http://proxy.example.com:8080',
      skipConnectivityCheck: true,
      authCheckerOptions: { skipStatusCommand: true },
    });

    await validator.validateAgent('claude');

    // Verify spawnWithTimeout was called with proxy environment variables
    expect(spawnSpy).toHaveBeenCalled();
    const callArgs = spawnSpy.mock.calls[0];
    const options = callArgs[1];

    expect(options.env).toBeDefined();
    expect(options.env.https_proxy).toBe('http://proxy.example.com:8080');
    expect(options.env.http_proxy).toBe('http://proxy.example.com:8080');
    expect(options.env.HTTPS_PROXY).toBe('http://proxy.example.com:8080');
    expect(options.env.HTTP_PROXY).toBe('http://proxy.example.com:8080');
  });

  it('should not add proxy env vars when proxyUrl is not provided', async () => {
    const spawnSpy = vi.spyOn(AgentValidator.prototype as any, 'spawnWithTimeout')
      .mockResolvedValue({
        stdout: '{"content":"Hello"}',
        stderr: '',
        exitCode: 0
      });

    // Mock executable check to pass
    vi.spyOn(AgentValidator.prototype as any, 'checkExecutable')
      .mockResolvedValue({
        name: 'CLI Command Check',
        passed: true,
        message: 'claude found in PATH'
      });

    // Provide clean environment without proxy vars
    const cleanEnv: Record<string, string> = { PATH: '/usr/bin:/bin' };

    const validator = new AgentValidator({
      skipConnectivityCheck: true,
      authCheckerOptions: { skipStatusCommand: true },
      env: cleanEnv,
    });

    await validator.validateAgent('claude');

    expect(spawnSpy).toHaveBeenCalled();
    const callArgs = spawnSpy.mock.calls[0];
    const options = callArgs[1];

    expect(options.env).toBeDefined();
    // When proxyUrl is not provided, env should not have proxy vars added by AgentValidator
    expect(options.env.https_proxy).toBeUndefined();
    expect(options.env.http_proxy).toBeUndefined();
    expect(options.env.HTTPS_PROXY).toBeUndefined();
    expect(options.env.HTTP_PROXY).toBeUndefined();
  });

  it('should pass proxy with authentication credentials to child process', async () => {
    const spawnSpy = vi.spyOn(AgentValidator.prototype as any, 'spawnWithTimeout')
      .mockResolvedValue({
        stdout: '{"content":"Hello"}',
        stderr: '',
        exitCode: 0
      });

    // Mock executable check to pass
    vi.spyOn(AgentValidator.prototype as any, 'checkExecutable')
      .mockResolvedValue({
        name: 'CLI Command Check',
        passed: true,
        message: 'claude found in PATH'
      });

    const validator = new AgentValidator({
      proxyUrl: 'http://user:pass@proxy.example.com:8080',
      skipConnectivityCheck: true,
      authCheckerOptions: { skipStatusCommand: true },
    });

    await validator.validateAgent('claude');

    expect(spawnSpy).toHaveBeenCalled();
    const callArgs = spawnSpy.mock.calls[0];
    const options = callArgs[1];

    // Credentials should be passed to child process (child process needs them)
    expect(options.env.https_proxy).toBe('http://user:pass@proxy.example.com:8080');
    expect(options.env.http_proxy).toBe('http://user:pass@proxy.example.com:8080');
  });
});
