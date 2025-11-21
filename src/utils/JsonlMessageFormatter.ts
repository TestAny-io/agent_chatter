/**
 * JsonlMessageFormatter
 *
 * Convert JSONL event streams from Claude/Codex/Gemini into displayable text.
 * - Supports Claude stream-json (--verbose): type=assistant/message.content[].text, type=result
 * - Supports Codex: item.* events + turn.completed
 * - Supports Gemini: type=message (delta true/false), type=result
 */

export type SupportedJsonlAgent = 'claude' | 'codex' | 'gemini';

export interface FormattedMessage {
  text: string;      // displayable text
  completed: boolean; // true when completion event observed
}

export function formatJsonl(agentType: SupportedJsonlAgent | undefined, raw: string): FormattedMessage {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const parts: string[] = [];
  let completed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      continue;
    }
    try {
      const obj = JSON.parse(trimmed);

      // Completion detection
      if (obj.type === 'result' || obj.type === 'turn.completed' || obj.type === 'turn.finished') {
        completed = true;
      }

      // Claude stream-json --verbose
      if (obj.type === 'assistant' && obj.message?.content) {
        for (const item of obj.message.content) {
          if (item?.type === 'text' && typeof item.text === 'string') {
            parts.push(stripAnsi(item.text));
          }
        }
        continue;
      }

      // Codex: item.* events (agent_message, command_execution, etc.)
      if (obj.type === 'item.completed' || obj.type === 'item.started') {
        if (typeof obj.item?.text === 'string') {
          parts.push(stripAnsi(obj.item.text));
        } else if (typeof obj.item?.command === 'string') {
          parts.push(stripAnsi(obj.item.command));
        } else if (Array.isArray(obj.item?.changes)) {
          for (const change of obj.item.changes) {
            if (typeof change.path === 'string') {
              parts.push(stripAnsi(change.path));
            }
          }
        }
        continue;
      }

      // Gemini: message content (delta or full)
      if (obj.type === 'message' && typeof obj.content === 'string') {
        parts.push(stripAnsi(obj.content));
        continue;
      }
    } catch {
      continue;
    }
  }

  let text = parts.join('\n').trim();
  if (!text) {
    text = stripAnsi(raw.trim()); // fallback to raw text when no JSON parsed
  }
  return { text, completed };
}

function stripAnsi(input: string): string {
  return input.replace(
    // eslint-disable-next-line no-control-regex
    /\u001B\[[0-9;]*[a-zA-Z]/g,
    ''
  );
}
