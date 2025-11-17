import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sampleFiles = [
  'agent-chatter-config.json',
  'codex-test-config.json',
  'codex-test-config-windows.json',
  'multi-agent-config.json',
  'examples/multi-role-demo-config.json'
];

describe('Sample configuration smoke tests', () => {
  for (const file of sampleFiles) {
    it(`parses ${file} with required fields`, () => {
      const fullPath = path.resolve(process.cwd(), file);
      const config = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

      expect(config.agents?.length).toBeGreaterThan(0);
      expect(config.team?.members?.length).toBeGreaterThan(0);
      for (const member of config.team.members) {
        expect(member.roleDir, 'roleDir required').toBeTruthy();
        expect(member.instructionFile, 'instructionFile required').toBeTruthy();
      }
    });
  }
});
