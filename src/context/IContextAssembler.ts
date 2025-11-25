/**
 * IContextAssembler Interface
 *
 * Defines the contract for agent-specific prompt assemblers.
 */

import type { AgentType, AssemblerInput, AssemblerOutput } from './types.js';

/**
 * Interface for context assemblers that format prompts for specific agent types.
 */
export interface IContextAssembler {
  /**
   * Returns the agent type this assembler handles.
   */
  getAgentType(): AgentType;

  /**
   * Assembles the input into a formatted prompt for the specific agent.
   *
   * @param input - The assembler input containing context, message, and configuration
   * @returns The assembled prompt output
   */
  assemble(input: AssemblerInput): AssemblerOutput;
}
