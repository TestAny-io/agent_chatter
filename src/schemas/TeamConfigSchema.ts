/**
 * TeamConfigSchema - JSON Schema for Team Configuration Validation
 *
 * Validates team configuration files to ensure:
 * - Required fields are present
 * - Field types are correct
 * - AI members have agentConfigId
 * - Member names are unique
 * - At least 2 members in the team
 *
 * Schema Version: 1.1 and 1.2 supported
 */

export const TeamConfigSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["team"],
  properties: {
    schemaVersion: {
      type: "string",
      enum: ["1.0", "1.1", "1.2"],
      description: "Team config schema version"
    },
    agents: {
      type: "array",
      description: "Legacy agent definitions (deprecated, use global registry)",
      items: {
        type: "object"
      }
    },
    team: {
      type: "object",
      required: ["name", "members"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          description: "Team name (used as identifier)"
        },
        displayName: {
          type: "string",
          description: "Human-readable team display name"
        },
        description: {
          type: "string",
          description: "Team description"
        },
        instructionFile: {
          type: "string",
          description: "Path to team instruction file"
        },
        roleDefinitions: {
          type: "array",
          description: "Role definitions for team members",
          items: {
            type: "object",
            required: ["name"],
            properties: {
              name: {
                type: "string",
                minLength: 1,
                description: "Role name"
              },
              displayName: {
                type: "string",
                description: "Human-readable role display name"
              },
              description: {
                type: "string",
                description: "Role description"
              }
            }
          }
        },
        members: {
          type: "array",
          minItems: 2,
          description: "Team members (at least 2 required)",
          items: {
            type: "object",
            required: ["name", "role", "type", "order"],
            properties: {
              name: {
                type: "string",
                minLength: 1,
                pattern: "^[a-zA-Z0-9_-]+$",
                description: "Member name (alphanumeric, underscore, hyphen only)"
              },
              displayName: {
                type: "string",
                description: "Human-readable member display name"
              },
              displayRole: {
                type: "string",
                description: "Display role name"
              },
              role: {
                type: "string",
                minLength: 1,
                description: "Role name (references RoleDefinition)"
              },
              type: {
                type: "string",
                enum: ["ai", "human"],
                description: "Member type"
              },
              agentType: {
                type: "string",
                description: "Agent type (deprecated, use agentConfigId)"
              },
              agentConfigId: {
                type: "string",
                description: "Agent config ID from global registry (required for AI members)"
              },
              themeColor: {
                type: "string",
                description: "Theme color for UI display"
              },
              roleDir: {
                type: "string",
                description: "Role-specific directory path"
              },
              workDir: {
                type: "string",
                description: "Member-specific working directory for agent process"
              },
              instructionFile: {
                type: "string",
                description: "Path to member instruction file"
              },
              env: {
                type: "object",
                description: "Member-specific environment variables",
                additionalProperties: {
                  type: "string"
                }
              },
              systemInstruction: {
                type: "string",
                description: "Member-specific system instruction/prompt"
              },
              additionalArgs: {
                type: "array",
                description: "Member-specific additional CLI arguments",
                items: {
                  type: "string"
                }
              },
              order: {
                type: "number",
                minimum: 0,
                description: "Member order in round-robin rotation"
              }
            },
            // Conditional validation: AI members must have agentConfigId
            if: {
              properties: { type: { const: "ai" } }
            },
            then: {
              required: ["agentConfigId"]
            }
          }
        }
      }
    },
    maxRounds: {
      type: "number",
      minimum: 1,
      description: "Maximum conversation rounds"
    }
  }
};

/**
 * Validation error details
 */
export interface SchemaValidationError {
  path: string;
  message: string;
  keyword?: string;
  params?: Record<string, any>;
}

/**
 * Schema validation result
 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationError[];
}

/**
 * Validate team configuration against JSON schema
 *
 * Note: This is a TypeScript-based validator without external dependencies.
 * For production use, consider using a library like Ajv for full JSON Schema support.
 *
 * @param config - Team configuration object
 * @returns Validation result
 */
export function validateTeamConfig(config: any): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];

  // Basic structure validation
  if (!config || typeof config !== 'object') {
    errors.push({
      path: '',
      message: 'Config must be an object'
    });
    return { valid: false, errors };
  }

  if (!config.team) {
    errors.push({
      path: 'team',
      message: 'Missing required property: team'
    });
    return { valid: false, errors };
  }

  const team = config.team;

  // Validate team.name
  if (!team.name || typeof team.name !== 'string' || team.name.trim().length === 0) {
    errors.push({
      path: 'team.name',
      message: 'Team name is required and must be a non-empty string'
    });
  }

  // Validate team.members
  if (!Array.isArray(team.members)) {
    errors.push({
      path: 'team.members',
      message: 'team.members must be an array'
    });
    return { valid: false, errors };
  }

  if (team.members.length < 2) {
    errors.push({
      path: 'team.members',
      message: 'Team must have at least 2 members'
    });
  }

  // Validate each member
  const memberNames = new Set<string>();
  team.members.forEach((member: any, index: number) => {
    const basePath = `team.members[${index}]`;

    // Required fields
    if (!member.name || typeof member.name !== 'string') {
      errors.push({
        path: `${basePath}.name`,
        message: 'Member name is required and must be a string'
      });
    } else {
      // Check for duplicate names
      if (memberNames.has(member.name)) {
        errors.push({
          path: `${basePath}.name`,
          message: `Duplicate member name: ${member.name}`
        });
      }
      memberNames.add(member.name);

      // Validate name pattern
      if (!/^[a-zA-Z0-9_-]+$/.test(member.name)) {
        errors.push({
          path: `${basePath}.name`,
          message: `Member name "${member.name}" contains invalid characters. Only alphanumeric, underscore, and hyphen are allowed.`
        });
      }
    }

    if (!member.role || typeof member.role !== 'string') {
      errors.push({
        path: `${basePath}.role`,
        message: 'Member role is required and must be a string'
      });
    }

    if (!member.type || !['ai', 'human'].includes(member.type)) {
      errors.push({
        path: `${basePath}.type`,
        message: 'Member type must be "ai" or "human"'
      });
    }

    if (typeof member.order !== 'number' || member.order < 0) {
      errors.push({
        path: `${basePath}.order`,
        message: 'Member order is required and must be a non-negative number'
      });
    }

    // AI members must have agentConfigId
    if (member.type === 'ai' && !member.agentConfigId) {
      errors.push({
        path: `${basePath}.agentConfigId`,
        message: `AI member "${member.name}" must have agentConfigId`
      });
    }

    // Validate optional fields if present
    if (member.env !== undefined) {
      if (typeof member.env !== 'object' || member.env === null || Array.isArray(member.env)) {
        errors.push({
          path: `${basePath}.env`,
          message: 'Member env must be an object (not null or array)'
        });
      } else {
        // Validate all env values are strings
        for (const [key, value] of Object.entries(member.env)) {
          if (typeof value !== 'string') {
            errors.push({
              path: `${basePath}.env["${key}"]`,
              message: `env["${key}"] must be a string, got ${typeof value}`
            });
          }
        }
      }
    }

    if (member.additionalArgs !== undefined) {
      if (!Array.isArray(member.additionalArgs)) {
        errors.push({
          path: `${basePath}.additionalArgs`,
          message: 'Member additionalArgs must be an array'
        });
      } else {
        member.additionalArgs.forEach((arg: any, argIndex: number) => {
          if (typeof arg !== 'string') {
            errors.push({
              path: `${basePath}.additionalArgs[${argIndex}]`,
              message: 'additionalArgs items must be strings'
            });
          }
        });
      }
    }

    if (member.workDir !== undefined && typeof member.workDir !== 'string') {
      errors.push({
        path: `${basePath}.workDir`,
        message: 'Member workDir must be a string'
      });
    }

    if (member.systemInstruction !== undefined && typeof member.systemInstruction !== 'string') {
      errors.push({
        path: `${basePath}.systemInstruction`,
        message: 'Member systemInstruction must be a string'
      });
    }
  });

  // Validate roleDefinitions if present
  if (team.roleDefinitions !== undefined) {
    if (!Array.isArray(team.roleDefinitions)) {
      errors.push({
        path: 'team.roleDefinitions',
        message: 'team.roleDefinitions must be an array'
      });
    } else {
      team.roleDefinitions.forEach((roleDef: any, index: number) => {
        if (!roleDef.name || typeof roleDef.name !== 'string') {
          errors.push({
            path: `team.roleDefinitions[${index}].name`,
            message: 'RoleDefinition name is required and must be a string'
          });
        }
      });
    }
  }

  // Validate maxRounds if present
  if (config.maxRounds !== undefined) {
    if (typeof config.maxRounds !== 'number' || config.maxRounds < 1) {
      errors.push({
        path: 'maxRounds',
        message: 'maxRounds must be a number >= 1'
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
