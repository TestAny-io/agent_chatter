import type { AgentEvent } from './AgentEvent.js';

export interface StreamParser {
  parseChunk(chunk: Buffer): AgentEvent[];
  flush(): AgentEvent[];
  reset(): void;
}
