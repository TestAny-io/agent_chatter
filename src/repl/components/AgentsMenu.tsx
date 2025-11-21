import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { AgentRegistry } from '../../registry/AgentRegistry.js';
import type { AgentDefinition } from '../../registry/RegistryStorage.js';
import type { ScannedAgent } from '../../registry/AgentScanner.js';
import type { VerificationResult } from '../../registry/AgentRegistry.js';
import { LoadingIndicator } from './LoadingIndicator.js';

export interface AgentsMenuProps {
  registryPath: string;
  onClose: () => void;
  onShowMessage: (message: string, color?: string) => void;
}

type ViewType = 'main' | 'list' | 'register' | 'verify' | 'info' | 'edit' | 'delete';

export function AgentsMenu({ registryPath, onClose, onShowMessage }: AgentsMenuProps) {
  // View and loading state
  const [view, setView] = useState<ViewType>('main');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // AgentRegistry instance
  const [registry] = useState(() => new AgentRegistry(registryPath));

  // View-specific state
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [scanResult, setScanResult] = useState<ScannedAgent[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [currentAgent, setCurrentAgent] = useState<AgentDefinition | null>(null);

  // Edit state
  const [editData, setEditData] = useState<Partial<AgentDefinition>>({});
  const [argsInput, setArgsInput] = useState(''); // Separate state for raw args input
  const [selectedEditField, setSelectedEditField] = useState(0); // Index in edit menu
  const [isEditingField, setIsEditingField] = useState(false); // Whether we are currently typing in a field

  // Edit menu options
  // 0: Command, 1: Args, 2: End Marker, 3: Use PTY, 4: Save, 5: Cancel
const EDIT_MENU_ITEMS = ['Command', 'Arguments', 'Use PTY', 'Save Changes', 'Cancel'];

  const filterNewAgents = (
    scanned: ScannedAgent[],
    existing: AgentDefinition[]
  ): ScannedAgent[] => {
    const registeredNames = new Set(existing.map(agent => agent.name.toLowerCase()));
    return scanned.filter(agent => agent.found && !registeredNames.has(agent.name.toLowerCase()));
  };

  // Handler functions for each menu option
  const showList = async () => {
    setLoading(true);
    setLoadingMessage('Loading registered agents...');

    try {
      const result = await registry.listAgents();
      setAgents(result);
      setView('list');
      setSelectedIndex(0);
    } catch (error: any) {
      onShowMessage(`Error loading agents: ${error.message || error}`, 'red');
      setView('main');
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const showRegister = async () => {
    setLoading(true);
    setLoadingMessage('Scanning system for AI CLI tools...');

    try {
      const [existingAgents, scanResults] = await Promise.all([
        registry.listAgents(),
        registry.scanAgents()
      ]);
      const newAgents = filterNewAgents(scanResults, existingAgents);
      if (newAgents.length === 0) {
        onShowMessage('No unregistered new agent found.', 'yellow');
        setScanResult([]);
        setView('main');
        setSelectedIndex(0);
      } else {
        setScanResult(newAgents);
        setSelectedAgents(new Set());
        setView('register');
        setSelectedIndex(0);
      }
    } catch (error: any) {
      onShowMessage(`Scan failed: ${error.message || error}`, 'red');
      setView('main');
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const showVerify = async () => {
    setLoading(true);
    setLoadingMessage('Loading agents...');

    try {
      const agentList = await registry.listAgents();
      setAgents(agentList);
      setView('verify');
      setSelectedIndex(0);
    } catch (error: any) {
      onShowMessage(`Error loading agents: ${error.message || error}`, 'red');
      setView('main');
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const showInfo = async () => {
    setLoading(true);
    setLoadingMessage('Loading agents...');

    try {
      const agentList = await registry.listAgents();
      setAgents(agentList);
      setView('info');
      setSelectedIndex(0);
    } catch (error: any) {
      onShowMessage(`Error loading agents: ${error.message || error}`, 'red');
      setView('main');
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const showEdit = async () => {
    setLoading(true);
    setLoadingMessage('Loading agents...');

    try {
      const agentList = await registry.listAgents();
      setAgents(agentList);
      setView('edit');
      setSelectedIndex(0);
      setEditData({}); // Reset edit data
      setSelectedEditField(0);
      setIsEditingField(false);
    } catch (error: any) {
      onShowMessage(`Error loading agents: ${error.message || error}`, 'red');
      setView('main');
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const showDelete = async () => {
    setLoading(true);
    setLoadingMessage('Loading agents...');

    try {
      const agentList = await registry.listAgents();
      setAgents(agentList);
      setView('delete');
      setSelectedIndex(0);
    } catch (error: any) {
      onShowMessage(`Error loading agents: ${error.message || error}`, 'red');
      setView('main');
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  };

  const handleMainMenuSelect = async (index: number) => {
    switch (index) {
      case 0: await showList(); break;
      case 1: await showRegister(); break;
      case 2: await showVerify(); break;
      case 3: await showInfo(); break;
      case 4: await showEdit(); break;
      case 5: await showDelete(); break;
      case 6: onClose(); break;
    }
  };

  // Onboarding: Check if we have any agents, if not, guide to register
  useEffect(() => {
    let mounted = true;
    const checkAgents = async () => {
      try {
        const agentList = await registry.listAgents();
        if (mounted && agentList.length === 0) {
          // Auto-trigger registration as per design
          onShowMessage('Welcome! No agents found. Starting auto-discovery...', 'cyan');

          setLoading(true);
          setLoadingMessage('Scanning system for AI CLI tools... (Ctrl+C to cancel)');

          try {
            const result = await registry.scanAgents();
            const newAgents = filterNewAgents(result, []);
            if (mounted) {
              if (newAgents.length === 0) {
                onShowMessage('No unregistered new agent found.', 'yellow');
                setView('main');
                setSelectedIndex(0);
              } else {
                setScanResult(newAgents);
                setSelectedAgents(new Set());
                setView('register');
                setSelectedIndex(0);
              }
            }
          } catch (error: any) {
            if (mounted) {
              onShowMessage(`Scan failed: ${error.message || error}`, 'red');
              setView('main');
              setSelectedIndex(0);
            }
          } finally {
            if (mounted) setLoading(false);
          }
        }
      } catch (error) {
        // Ignore error on auto-check
      }
    };

    checkAgents();

    return () => { mounted = false; };
  }, []);

  // Input handling
  useInput((input, key) => {
    // Ctrl+C always closes the menu (from any view), even during loading
    if (key.ctrl && input === 'c') {
      onClose();
      return;
    }

    if (loading) return; // Ignore other input during loading

    if (view === 'main') {
      if (key.upArrow) {
        setSelectedIndex(prev => prev > 0 ? prev - 1 : 6);
      } else if (key.downArrow) {
        setSelectedIndex(prev => prev < 6 ? prev + 1 : 0);
      } else if (key.return) {
        // Note: handleMainMenuSelect is async, but we don't await it here
        // because useInput cannot be async. The function handles its own errors.
        void handleMainMenuSelect(selectedIndex);
      } else if (key.escape) {
        onClose();
      }
    } else if (view === 'list') {
      // List view: support navigation through agents
      if (key.upArrow) {
        setSelectedIndex(prev => prev > 0 ? prev - 1 : agents.length - 1);
      } else if (key.downArrow) {
        setSelectedIndex(prev => prev < agents.length - 1 ? prev + 1 : 0);
      } else if (key.escape) {
        setView('main');
        setSelectedIndex(0);
      }
    } else if (view === 'register') {
      if (key.upArrow) {
        setSelectedIndex(prev => prev > 0 ? prev - 1 : scanResult.length - 1);
      } else if (key.downArrow) {
        setSelectedIndex(prev => prev < scanResult.length - 1 ? prev + 1 : 0);
      } else if (input === ' ') {
        // Toggle selection
        const agent = scanResult[selectedIndex];
        if (agent) {
          const newSelected = new Set(selectedAgents);
          if (newSelected.has(agent.name)) {
            newSelected.delete(agent.name);
          } else {
            newSelected.add(agent.name);
          }
          setSelectedAgents(newSelected);
        }
      } else if (key.return) {
        // Confirm registration
        // Logic to register agents
        const toRegister = scanResult.filter(a => selectedAgents.has(a.name));
        if (toRegister.length === 0) {
          onShowMessage('No agents selected', 'yellow');
        } else {
          // Perform registration
          (async () => {
            setLoading(true);
            setLoadingMessage('Registering agents...');
            for (const agent of toRegister) {
              const res = await registry.registerAgent(agent.name as any, agent.command, agent.version);
              if (res.success) {
                onShowMessage(`Registered ${agent.displayName}`, 'green');
              } else {
                onShowMessage(`Failed to register ${agent.displayName}: ${res.error}`, 'red');
              }
            }
            setLoading(false);
            setView('main');
            setSelectedIndex(0);
          })();
        }
      } else if (key.escape) {
        setView('main');
        setSelectedIndex(0);
      }
    } else if (view === 'verify') {
      if (verificationResults.length > 0) {
        if (key.escape) {
          setVerificationResults([]);
          setView('main');
          setSelectedIndex(0);
        }
      } else {
        // Selection mode
        const totalOptions = agents.length + 1; // +1 for "All agents"
        if (key.upArrow) {
          setSelectedIndex(prev => prev > 0 ? prev - 1 : totalOptions - 1);
        } else if (key.downArrow) {
          setSelectedIndex(prev => prev < totalOptions - 1 ? prev + 1 : 0);
        } else if (key.return) {
          // Run verification
          (async () => {
            setLoading(true);
            setLoadingMessage('Verifying...');
            const results: VerificationResult[] = [];
            if (selectedIndex === 0) {
              // Verify all
              for (const agent of agents) {
                results.push(await registry.verifyAgent(agent.name));
              }
            } else {
              // Verify single
              const agent = agents[selectedIndex - 1];
              results.push(await registry.verifyAgent(agent.name));
            }
            setVerificationResults(results);
            setLoading(false);
          })();
        } else if (key.escape) {
          setView('main');
          setSelectedIndex(0);
        }
      }
    } else if (view === 'info') {
      if (currentAgent) {
        if (key.escape) {
          setCurrentAgent(null);
        }
      } else {
        if (key.upArrow) {
          setSelectedIndex(prev => prev > 0 ? prev - 1 : agents.length - 1);
        } else if (key.downArrow) {
          setSelectedIndex(prev => prev < agents.length - 1 ? prev + 1 : 0);
        } else if (key.return) {
          setCurrentAgent(agents[selectedIndex]);
        } else if (key.escape) {
          setView('main');
          setSelectedIndex(0);
        }
      }
    } else if (view === 'delete') {
      if (currentAgent) {
        if (input === 'y' || input === 'Y') {
          // Delete
          (async () => {
            setLoading(true);
            setLoadingMessage(`Deleting ${currentAgent.name}...`);
            const res = await registry.deleteAgent(currentAgent.name);
            setLoading(false);
            if (res.success) {
              onShowMessage(`Deleted ${currentAgent.displayName}`, 'green');
            } else {
              onShowMessage(`Failed to delete: ${res.error}`, 'red');
            }
            setCurrentAgent(null);
            setView('main');
            setSelectedIndex(0);
          })();
        } else if (input === 'n' || input === 'N' || key.escape) {
          setCurrentAgent(null);
        }
      } else {
        if (key.upArrow) {
          setSelectedIndex(prev => prev > 0 ? prev - 1 : agents.length - 1);
        } else if (key.downArrow) {
          setSelectedIndex(prev => prev < agents.length - 1 ? prev + 1 : 0);
        } else if (key.return) {
          setCurrentAgent(agents[selectedIndex]);
        } else if (key.escape) {
          setView('main');
          setSelectedIndex(0);
        }
      }
    } else if (view === 'edit') {
      if (!currentAgent) {
        // Selection mode (Select agent to edit)
        if (key.upArrow) {
          setSelectedIndex(prev => prev > 0 ? prev - 1 : agents.length - 1);
        } else if (key.downArrow) {
          setSelectedIndex(prev => prev < agents.length - 1 ? prev + 1 : 0);
        } else if (key.return) {
          if (agents.length === 0) return;
          const agent = agents[selectedIndex];
          if (!agent) return;
          setCurrentAgent(agent);
          setEditData({
            command: agent.command,
            args: [...agent.args],
            usePty: agent.usePty
          });
          setSelectedEditField(0);
          setIsEditingField(false);
          // Initialize args string for editing
          setArgsInput(JSON.stringify(agent.args));
        } else if (key.escape) {
          setView('main');
          setSelectedIndex(0);
        }
      } else {
        // Editing mode (Inside the form)
        if (isEditingField) {
          // We are typing in a TextInput
          if (key.return) {
            // Commit field edit
            setIsEditingField(false);
          } else if (key.escape) {
            // Cancel field edit (revert logic could be added here, but for now just exit edit mode)
            setIsEditingField(false);
          }
        } else {
          // Navigating the edit menu
          if (key.upArrow) {
            setSelectedEditField(prev => prev > 0 ? prev - 1 : EDIT_MENU_ITEMS.length - 1);
          } else if (key.downArrow) {
            setSelectedEditField(prev => prev < EDIT_MENU_ITEMS.length - 1 ? prev + 1 : 0);
          } else if (key.escape) {
            // Cancel editing entirely
            setCurrentAgent(null);
            setEditData({});
            setArgsInput(''); // Reset args input
          } else if (key.return) {
            const selectedItem = EDIT_MENU_ITEMS[selectedEditField];
            if (selectedItem === 'Save Changes') {
              // Save logic
              (async () => {
                setLoading(true);
                setLoadingMessage(`Updating ${currentAgent.name}...`);

                const updates: Partial<AgentDefinition> = {};
                if (editData.command !== currentAgent.command) updates.command = editData.command;

                // Parse args
                let newArgs: string[] = [];
                try {
                  const parsed = JSON.parse(argsInput);
                  if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) {
                    newArgs = parsed;
                  } else {
                    onShowMessage('Invalid args format: must be a JSON string array', 'red');
                    setLoading(false);
                    return;
                  }
                } catch (e) {
                  onShowMessage('Invalid args JSON syntax', 'red');
                  setLoading(false);
                  return;
                }
                const currentArgsStr = JSON.stringify(currentAgent.args || []);
                const newArgsStr = JSON.stringify(newArgs);
                if (currentArgsStr !== newArgsStr) updates.args = newArgs;

                if (editData.usePty !== currentAgent.usePty) updates.usePty = editData.usePty;

                if (Object.keys(updates).length === 0) {
                  setLoading(false);
                  onShowMessage('No changes to save', 'yellow');
                  return;
                }

                const res = await registry.updateAgent(currentAgent.name, updates);
                setLoading(false);

                if (res.success) {
                  onShowMessage(`Updated ${currentAgent.displayName}`, 'green');
                  setCurrentAgent(null);
                  setArgsInput(''); // Reset args input
                  const newList = await registry.listAgents();
                  setAgents(newList);
                } else {
                  onShowMessage(`Failed to update: ${res.error}`, 'red');
                }
              })();
            } else if (selectedItem === 'Cancel') {
              setCurrentAgent(null);
              setEditData({});
              setArgsInput(''); // Reset args input
            } else if (selectedItem === 'Use PTY') {
              // Toggle immediately
              setEditData(prev => ({ ...prev, usePty: !prev.usePty }));
            } else {
              // Enter edit mode for text fields
              setIsEditingField(true);
            }
          } else if (input === ' ' && EDIT_MENU_ITEMS[selectedEditField] === 'Use PTY') {
            setEditData(prev => ({ ...prev, usePty: !prev.usePty }));
          }
        }
      }
    }
  });

  // Render based on current view
  return (
    <Box flexDirection="column">
      {loading && <LoadingIndicator message={loadingMessage} />}

      {!loading && view === 'main' && (
        <Box flexDirection="column">
          <Box borderStyle="round" paddingX={2} paddingY={1}>
            <Text bold>Agents Management</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            <Text>Main Menu</Text>
            <Text dimColor>{'─'.repeat(60)}</Text>
            <Text color={selectedIndex === 0 ? 'cyan' : undefined}>
              {selectedIndex === 0 ? '▶ ' : '  '}List all registered agents
            </Text>
            <Text color={selectedIndex === 1 ? 'cyan' : undefined}>
              {selectedIndex === 1 ? '▶ ' : '  '}Register new agents (scan system)
            </Text>
            <Text color={selectedIndex === 2 ? 'cyan' : undefined}>
              {selectedIndex === 2 ? '▶ ' : '  '}Verify agent availability
            </Text>
            <Text color={selectedIndex === 3 ? 'cyan' : undefined}>
              {selectedIndex === 3 ? '▶ ' : '  '}Show agent details
            </Text>
            <Text color={selectedIndex === 4 ? 'cyan' : undefined}>
              {selectedIndex === 4 ? '▶ ' : '  '}Edit agent configuration
            </Text>
            <Text color={selectedIndex === 5 ? 'cyan' : undefined}>
              {selectedIndex === 5 ? '▶ ' : '  '}Delete an agent
            </Text>
            <Text color={selectedIndex === 6 ? 'cyan' : undefined}>
              {selectedIndex === 6 ? '▶ ' : '  '}Exit agents menu
            </Text>
            <Box marginTop={1}>
              <Text dimColor>Use ↑↓ to navigate, Enter to select, Ctrl+C to cancel</Text>
            </Box>
          </Box>
        </Box>
      )}

      {!loading && view === 'list' && (
        <Box flexDirection="column">
          <Box borderStyle="round" paddingX={2} paddingY={1}>
            <Text bold>Registered AI Agents ({agents.length})</Text>
          </Box>

          {agents.length === 0 ? (
            <Box marginTop={1}>
              <Text color="yellow">No registered agents</Text>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              {agents.map((agent, index) => (
                <Box key={agent.name} flexDirection="column" marginBottom={1}>
                  <Text color={index === selectedIndex ? 'cyan' : undefined}>
                    {index === selectedIndex ? '▶ ' : '  '}● {agent.displayName}
                    {agent.version ? ` (${agent.version})` : ''}
                  </Text>
                  <Text dimColor>    Command: {agent.command}</Text>
                </Box>
              ))}
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>{'─'.repeat(60)}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press ↑↓ to navigate, Esc to go back, Ctrl+C to exit</Text>
          </Box>
        </Box>
      )}

      {!loading && view === 'register' && (
        <Box flexDirection="column">
          <Box borderStyle="round" paddingX={2} paddingY={1}>
            <Text bold>Register New Agents</Text>
          </Box>

          {scanResult.length === 0 ? (
            <Box marginTop={1}>
              <Text color="yellow">No unregistered new agent found.</Text>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <Text>Found {scanResult.length} AI CLI tools:</Text>
              <Box marginTop={1} flexDirection="column">
                {scanResult.map((agent, index) => (
                  <Box key={agent.name} flexDirection="column" marginBottom={1}>
                    <Text color={index === selectedIndex ? 'cyan' : undefined}>
                      {index === selectedIndex ? '▶ ' : '  '}
                      {selectedAgents.has(agent.name) ? '☑' : '☐'} {agent.displayName}
                      {agent.version ? ` (${agent.version})` : ''}
                    </Text>
                    <Text dimColor>    Command: {agent.command}</Text>
                  </Box>
                ))}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Use ↑↓ to navigate, Space to toggle, Enter to register</Text>
              </Box>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>Press Esc to go back</Text>
          </Box>
        </Box>
      )}

      {!loading && view === 'verify' && (
        <Box flexDirection="column">
          <Box borderStyle="round" paddingX={2} paddingY={1}>
            <Text bold>Verify Agent Availability</Text>
          </Box>

          {verificationResults.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              {verificationResults.map((res, idx) => (
                <Box key={idx} flexDirection="column" marginBottom={1}>
                  <Text bold color={res.status === 'verified' ? 'green' : 'red'}>
                    {res.status === 'verified' ? '✓' : '✗'} {res.name}
                  </Text>
                  {res.checks?.map((check, cIdx) => (
                    <Text key={cIdx} dimColor>  {check.passed ? '✓' : '✗'} {check.message}</Text>
                  ))}
                  {res.error && <Text color="red">  Error: {res.error}</Text>}
                </Box>
              ))}
              <Box marginTop={1}>
                <Text dimColor>Press Esc to go back</Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <Text>Select agent to verify:</Text>
              <Box marginTop={1} flexDirection="column">
                <Text color={selectedIndex === 0 ? 'cyan' : undefined}>
                  {selectedIndex === 0 ? '▶ ' : '  '}All agents
                </Text>
                {agents.map((agent, index) => (
                  <Text key={agent.name} color={index + 1 === selectedIndex ? 'cyan' : undefined}>
                    {index + 1 === selectedIndex ? '▶ ' : '  '}{agent.displayName}
                  </Text>
                ))}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Use ↑↓ to navigate, Enter to verify, Esc to go back</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {!loading && view === 'info' && (
        <Box flexDirection="column">
          <Box borderStyle="round" paddingX={2} paddingY={1}>
            <Text bold>Agent Details</Text>
          </Box>

          {currentAgent ? (
            <Box flexDirection="column" marginTop={1}>
              <Text>Name:          <Text bold>{currentAgent.name}</Text></Text>
              <Text>Display Name:  {currentAgent.displayName}</Text>
              <Text>Command:       {currentAgent.command}</Text>
              <Text>Arguments:     {currentAgent.args.join(' ') || '(none)'}</Text>
              <Text>Use PTY:       {currentAgent.usePty ? 'Yes' : 'No'}</Text>
              <Text>Version:       {currentAgent.version || 'Unknown'}</Text>
              <Text>Installed At:  {currentAgent.installedAt}</Text>

              <Box marginTop={1}>
                <Text dimColor>Press Esc to go back to list</Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <Text>Select agent to view:</Text>
              <Box marginTop={1} flexDirection="column">
                {agents.map((agent, index) => (
                  <Text key={agent.name} color={index === selectedIndex ? 'cyan' : undefined}>
                    {index === selectedIndex ? '▶ ' : '  '}{agent.displayName}
                  </Text>
                ))}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Use ↑↓ to navigate, Enter to select, Esc to go back</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {!loading && view === 'edit' && (
        <Box flexDirection="column">
          <Box borderStyle="round" paddingX={2} paddingY={1}>
            <Text bold>Edit Agent Configuration</Text>
          </Box>

          {!currentAgent ? (
            <Box flexDirection="column" marginTop={1}>
              <Text>Select agent to edit:</Text>
              <Box marginTop={1} flexDirection="column">
                {agents.map((agent, index) => (
                  <Text key={agent.name} color={index === selectedIndex ? 'cyan' : undefined}>
                    {index === selectedIndex ? '▶ ' : '  '}{agent.displayName}
                  </Text>
                ))}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Use ↑↓ to navigate, Enter to select, Esc to go back</Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Editing: {currentAgent.displayName}</Text>
              <Box marginTop={1} flexDirection="column">
                {/* Command Field */}
                <Box flexDirection="column" marginBottom={1}>
                  <Text color={selectedEditField === 0 ? 'cyan' : undefined}>
                    {selectedEditField === 0 ? '▶ ' : '  '}Command:
                  </Text>
                  <Box marginLeft={2}>
                    {selectedEditField === 0 && isEditingField ? (
                      <TextInput
                        value={editData.command || ''}
                        onChange={val => setEditData(prev => ({ ...prev, command: val }))}
                        focus={true}
                      />
                    ) : (
                      <Text>{editData.command}</Text>
                    )}
                  </Box>
                </Box>

                {/* Args Field */}
                <Box flexDirection="column" marginBottom={1}>
                  <Text color={selectedEditField === 1 ? 'cyan' : undefined}>
                    {selectedEditField === 1 ? '▶ ' : '  '}Arguments (JSON array):
                  </Text>
                  <Box marginLeft={2}>
                    {selectedEditField === 1 && isEditingField ? (
                      <TextInput
                        value={argsInput}
                        onChange={setArgsInput}
                        focus={true}
                      />
                    ) : (
                      <Text>{JSON.stringify(editData.args || [])}</Text>
                    )}
                  </Box>
                </Box>

                {/* Use PTY Field */}
                <Box flexDirection="column" marginBottom={1}>
                  <Text color={selectedEditField === 2 ? 'cyan' : undefined}>
                    {selectedEditField === 2 ? '▶ ' : '  '}Use PTY:
                  </Text>
                  <Box marginLeft={2}>
                    <Text>{editData.usePty ? 'Yes' : 'No'} {selectedEditField === 2 ? '(Press Space/Enter to toggle)' : ''}</Text>
                  </Box>
                </Box>

                {/* Action Buttons */}
                <Box marginTop={1} flexDirection="row" gap={2}>
                  <Text color={selectedEditField === 3 ? 'green' : undefined}>
                    {selectedEditField === 3 ? '▶ ' : '  '}[ Save Changes ]
                  </Text>
                  <Text color={selectedEditField === 4 ? 'red' : undefined}>
                    {selectedEditField === 4 ? '▶ ' : '  '}[ Cancel ]
                  </Text>
                </Box>
              </Box>

              <Box marginTop={1}>
                <Text dimColor>
                  {isEditingField
                    ? 'Press Enter to confirm field, Esc to cancel edit'
                    : 'Use ↑↓ to select field, Enter to edit, Esc to cancel'}
                </Text>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {!loading && view === 'delete' && (
        <Box flexDirection="column">
          <Box borderStyle="round" paddingX={2} paddingY={1}>
            <Text bold>Delete Agent</Text>
          </Box>

          {currentAgent ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="red" bold>⚠ WARNING: This action cannot be undone</Text>
              <Box marginTop={1} marginBottom={1}>
                <Text>Agent to delete:</Text>
                <Text>  Name:         {currentAgent.name}</Text>
                <Text>  Display Name: {currentAgent.displayName}</Text>
                <Text>  Command:      {currentAgent.command}</Text>
              </Box>
              <Text>Confirm deletion? (y/N)</Text>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <Text>Select agent to delete:</Text>
              <Box marginTop={1} flexDirection="column">
                {agents.map((agent, index) => (
                  <Text key={agent.name} color={index === selectedIndex ? 'cyan' : undefined}>
                    {index === selectedIndex ? '▶ ' : '  '}{agent.displayName}
                  </Text>
                ))}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Use ↑↓ to navigate, Enter to select, Esc to go back</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
