import type { ColorName } from '@testany/agent-chatter-core';

/**
 * Output abstraction for presentation/UI layers.
 */
export interface IOutput {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  progress(message: string, options?: { current?: number; total?: number }): void;
  separator(char?: string, length?: number): void;
  keyValue(key: string, value: string, options?: { indent?: number; color?: ColorName }): void;
}

/**
 * Silent implementation for headless/test/default cases.
 */
export class SilentOutput implements IOutput {
  info(_message: string): void {}
  success(_message: string): void {}
  warn(_message: string): void {}
  error(_message: string): void {}
  progress(_message: string, _options?: { current?: number; total?: number }): void {}
  separator(_char?: string, _length?: number): void {}
  keyValue(_key: string, _value: string, _options?: { indent?: number; color?: ColorName }): void {}
}
