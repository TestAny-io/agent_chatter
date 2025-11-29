import React from 'react';
import { Text } from 'ink';
import type { IOutput } from './IOutput.js';

export interface InkOutputOptions {
  setOutput: React.Dispatch<React.SetStateAction<React.ReactNode[]>>;
  getNextKey: () => string;
}

export class InkOutput implements IOutput {
  constructor(private options: InkOutputOptions) {}

  info(message: string): void {
    this.push(<Text key={`info-${this.options.getNextKey()}`} color="cyan">{message}</Text>);
  }

  success(message: string): void {
    this.push(<Text key={`success-${this.options.getNextKey()}`} color="green">{message}</Text>);
  }

  warn(message: string): void {
    this.push(<Text key={`warn-${this.options.getNextKey()}`} color="yellow">{message}</Text>);
  }

  error(message: string): void {
    this.push(<Text key={`error-${this.options.getNextKey()}`} color="red">{message}</Text>);
  }

  progress(message: string, options?: { current?: number; total?: number }): void {
    let text = message;
    if (options?.current !== undefined && options?.total !== undefined) {
      text += ` (${options.current}/${options.total})`;
    }
    this.push(<Text key={`progress-${this.options.getNextKey()}`} dimColor>{text}</Text>);
  }

  separator(char: string = '─', length: number = 60): void {
    this.push(<Text key={`sep-${this.options.getNextKey()}`} dimColor>{char.repeat(length)}</Text>);
  }

  keyValue(key: string, value: string, options?: { indent?: number }): void {
    const indent = ' '.repeat(options?.indent ?? 2);
    this.push(<Text key={`kv-${this.options.getNextKey()}`} dimColor>{indent}{key}: {value}</Text>);
  }

  private push(node: React.ReactNode): void {
    this.options.setOutput(prev => [...prev, node]);
  }
}
