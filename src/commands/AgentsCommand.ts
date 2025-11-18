/**
 * AgentsCommand - CLI 命令处理器
 *
 * 提供 /agents 命令的所有子命令实现
 */

import { Command } from 'commander';
import * as readline from 'readline';
import { AgentRegistry } from '../registry/AgentRegistry.js';
import type { AgentType } from '../utils/AgentDefaults.js';

// 颜色输出辅助函数
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * 创建 readline 接口
 */
function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * 询问用户问题
 */
function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Register 命令处理器 - 交互式扫描和注册
 */
export async function handleRegister(options: { auto?: boolean }): Promise<void> {
  const registry = new AgentRegistry();

  console.log(colorize('\n=== 注册 AI Agents ===\n', 'bright'));
  console.log('正在扫描系统中已安装的 AI CLI 工具...\n');

  // 扫描所有 agents
  const scanned = await registry.scanAgents();

  const found = scanned.filter(a => a.found);
  const notFound = scanned.filter(a => !a.found);

  if (found.length === 0) {
    console.log(colorize('✗ 未检测到任何 AI CLI 工具', 'yellow'));
    console.log(colorize('\n请先安装以下工具之一:', 'cyan'));
    notFound.forEach(agent => {
      console.log(`  - ${agent.displayName} (${agent.name})`);
    });
    console.log();
    return;
  }

  // 显示扫描结果
  console.log(colorize('✓ 检测到以下工具:\n', 'green'));
  found.forEach(agent => {
    const version = agent.version ? colorize(` (v${agent.version})`, 'dim') : '';
    console.log(`  ${colorize('●', 'green')} ${agent.displayName}${version}`);
    console.log(colorize(`    Command: ${agent.command}`, 'dim'));
  });
  console.log();

  // 自动模式：直接注册所有找到的 agents
  if (options.auto) {
    console.log(colorize('自动注册模式：注册所有检测到的工具...\n', 'cyan'));

    for (const agent of found) {
      const result = await registry.registerAgent(agent.name, agent.command, agent.version);

      if (result.success) {
        console.log(colorize(`✓ 已注册: ${agent.displayName}`, 'green'));
      } else {
        console.log(colorize(`✗ 注册失败: ${agent.displayName} - ${result.error}`, 'red'));
      }
    }

    console.log(colorize('\n✓ 自动注册完成', 'green'));
    return;
  }

  // 交互模式：询问用户选择要注册哪些 agents
  const rl = createReadline();

  console.log(colorize('请选择要注册的工具 (输入编号，多个用逗号分隔，或输入 "all" 全部注册):\n', 'cyan'));

  found.forEach((agent, index) => {
    console.log(`  ${index + 1}. ${agent.displayName}`);
  });

  console.log();

  try {
    const answer = await question(rl, '请选择: ');

    let selectedIndices: number[] = [];

    if (answer.toLowerCase() === 'all') {
      selectedIndices = found.map((_, i) => i);
    } else {
      const parts = answer.split(',').map(s => s.trim());
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num) && num >= 1 && num <= found.length) {
          selectedIndices.push(num - 1);
        }
      }
    }

    if (selectedIndices.length === 0) {
      console.log(colorize('\n✗ 未选择任何工具', 'yellow'));
      return;
    }

    console.log();

    for (const index of selectedIndices) {
      const agent = found[index];
      const result = await registry.registerAgent(agent.name, agent.command, agent.version);

      if (result.success) {
        console.log(colorize(`✓ 已注册: ${agent.displayName}`, 'green'));

        // 验证 agent
        console.log(colorize(`  正在验证...`, 'dim'));
        const verification = await registry.verifyAgent(agent.name);

        if (verification.status === 'verified') {
          console.log(colorize(`  ✓ 验证成功`, 'green'));
        } else {
          console.log(colorize(`  ✗ 验证失败: ${verification.error}`, 'yellow'));
          if (verification.checks) {
            verification.checks.forEach(check => {
              const status = check.passed ? colorize('✓', 'green') : colorize('✗', 'red');
              console.log(`    ${status} ${check.name}: ${check.message}`);
            });
          }
        }
      } else {
        console.log(colorize(`✗ 注册失败: ${agent.displayName} - ${result.error}`, 'red'));
      }
    }

    console.log(colorize('\n✓ 注册完成', 'green'));
  } finally {
    rl.close();
  }
}

/**
 * List 命令处理器 - 显示所有已注册的 agents
 */
export async function handleList(options: { verbose?: boolean }): Promise<void> {
  const registry = new AgentRegistry();

  console.log(colorize('\n=== 已注册的 AI Agents ===\n', 'bright'));

  const agents = await registry.listAgents();

  if (agents.length === 0) {
    console.log(colorize('暂无已注册的 agents', 'yellow'));
    console.log(colorize('\n使用 ', 'dim') + colorize('agents register', 'cyan') + colorize(' 命令注册 agents\n', 'dim'));
    return;
  }

  for (const agent of agents) {
    const version = agent.version ? colorize(` (v${agent.version})`, 'dim') : '';
    console.log(`${colorize('●', 'cyan')} ${colorize(agent.displayName, 'bright')}${version}`);
    console.log(`  ${colorize('Name:', 'dim')} ${agent.name}`);
    console.log(`  ${colorize('Command:', 'dim')} ${agent.command}`);

    if (options.verbose) {
      console.log(`  ${colorize('Args:', 'dim')} ${agent.args?.join(' ') || 'none'}`);
      console.log(`  ${colorize('End Marker:', 'dim')} ${agent.endMarker}`);
      console.log(`  ${colorize('Use PTY:', 'dim')} ${agent.usePty}`);
      console.log(`  ${colorize('Installed At:', 'dim')} ${agent.installedAt}`);
    }

    console.log();
  }

  console.log(colorize(`总计: ${agents.length} 个 agents`, 'cyan'));
  console.log();
}

/**
 * Verify 命令处理器 - 验证 agent 可用性
 */
export async function handleVerify(agentName?: string): Promise<void> {
  const registry = new AgentRegistry();

  if (!agentName) {
    // 验证所有 agents
    console.log(colorize('\n=== 验证所有 Agents ===\n', 'bright'));

    const agents = await registry.listAgents();

    if (agents.length === 0) {
      console.log(colorize('暂无已注册的 agents', 'yellow'));
      return;
    }

    for (const agent of agents) {
      console.log(`${colorize('●', 'cyan')} ${agent.displayName}`);
      console.log(colorize('  正在验证...', 'dim'));

      const result = await registry.verifyAgent(agent.name);

      if (result.status === 'verified') {
        console.log(colorize('  ✓ 验证成功', 'green'));
      } else {
        console.log(colorize(`  ✗ 验证失败: ${result.error}`, 'red'));
      }

      if (result.checks) {
        result.checks.forEach(check => {
          const status = check.passed ? colorize('✓', 'green') : colorize('✗', 'red');
          console.log(`    ${status} ${check.name}: ${check.message}`);
        });
      }

      console.log();
    }

    return;
  }

  // 验证单个 agent
  console.log(colorize(`\n=== 验证 Agent: ${agentName} ===\n`, 'bright'));

  const result = await registry.verifyAgent(agentName);

  if (result.status === 'verified') {
    console.log(colorize('✓ 验证成功\n', 'green'));
  } else {
    console.log(colorize(`✗ 验证失败: ${result.error}\n`, 'red'));
  }

  if (result.checks) {
    result.checks.forEach(check => {
      const status = check.passed ? colorize('✓', 'green') : colorize('✗', 'red');
      console.log(`${status} ${check.name}`);
      console.log(colorize(`  ${check.message}`, 'dim'));
    });
    console.log();
  }
}

/**
 * Info 命令处理器 - 显示 agent 详细信息
 */
export async function handleInfo(agentName: string): Promise<void> {
  const registry = new AgentRegistry();

  console.log(colorize(`\n=== Agent 详细信息: ${agentName} ===\n`, 'bright'));

  const agent = await registry.getAgent(agentName);

  if (!agent) {
    console.log(colorize(`✗ Agent 不存在: ${agentName}`, 'red'));
    console.log(colorize('\n使用 ', 'dim') + colorize('agents list', 'cyan') + colorize(' 查看所有已注册的 agents\n', 'dim'));
    return;
  }

  console.log(`${colorize('Name:', 'cyan')} ${agent.name}`);
  console.log(`${colorize('Display Name:', 'cyan')} ${agent.displayName}`);
  console.log(`${colorize('Command:', 'cyan')} ${agent.command}`);
  console.log(`${colorize('Arguments:', 'cyan')} ${agent.args?.join(' ') || 'none'}`);
  console.log(`${colorize('End Marker:', 'cyan')} ${agent.endMarker}`);
  console.log(`${colorize('Use PTY:', 'cyan')} ${agent.usePty}`);

  if (agent.version) {
    console.log(`${colorize('Version:', 'cyan')} ${agent.version}`);
  }

  console.log(`${colorize('Installed At:', 'cyan')} ${agent.installedAt}`);

  console.log();

  // 验证 agent
  console.log(colorize('正在验证 agent 可用性...', 'dim'));
  const result = await registry.verifyAgent(agentName);

  if (result.status === 'verified') {
    console.log(colorize('✓ Agent 可用\n', 'green'));
  } else {
    console.log(colorize(`✗ Agent 不可用: ${result.error}\n`, 'red'));
  }

  if (result.checks) {
    result.checks.forEach(check => {
      const status = check.passed ? colorize('✓', 'green') : colorize('✗', 'red');
      console.log(`${status} ${check.name}`);
      console.log(colorize(`  ${check.message}`, 'dim'));
    });
    console.log();
  }
}

/**
 * Delete 命令处理器 - 删除 agent
 */
export async function handleDelete(agentName: string, options: { force?: boolean }): Promise<void> {
  const registry = new AgentRegistry();

  console.log(colorize(`\n=== 删除 Agent: ${agentName} ===\n`, 'bright'));

  const agent = await registry.getAgent(agentName);

  if (!agent) {
    console.log(colorize(`✗ Agent 不存在: ${agentName}`, 'red'));
    console.log(colorize('\n使用 ', 'dim') + colorize('agents list', 'cyan') + colorize(' 查看所有已注册的 agents\n', 'dim'));
    return;
  }

  // 如果没有 --force 标志，询问确认
  if (!options.force) {
    const rl = createReadline();

    try {
      console.log(`将要删除: ${colorize(agent.displayName, 'bright')} (${agent.name})`);
      console.log(colorize(`Command: ${agent.command}`, 'dim'));
      console.log();

      const answer = await question(rl, '确认删除? (y/N): ');

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(colorize('\n✗ 已取消\n', 'yellow'));
        return;
      }
    } finally {
      rl.close();
    }
  }

  const result = await registry.deleteAgent(agentName);

  if (result.success) {
    console.log(colorize('\n✓ 删除成功\n', 'green'));
  } else {
    console.log(colorize(`\n✗ 删除失败: ${result.error}\n`, 'red'));
  }
}

/**
 * Edit 命令处理器 - 编辑 agent 配置
 */
export async function handleEdit(agentName: string): Promise<void> {
  const registry = new AgentRegistry();

  console.log(colorize(`\n=== 编辑 Agent: ${agentName} ===\n`, 'bright'));

  const agent = await registry.getAgent(agentName);

  if (!agent) {
    console.log(colorize(`✗ Agent 不存在: ${agentName}`, 'red'));
    console.log(colorize('\n使用 ', 'dim') + colorize('agents list', 'cyan') + colorize(' 查看所有已注册的 agents\n', 'dim'));
    return;
  }

  console.log('当前配置:');
  console.log(`  Command: ${colorize(agent.command, 'cyan')}`);
  console.log(`  Args: ${colorize(agent.args?.join(' ') || 'none', 'cyan')}`);
  console.log(`  End Marker: ${colorize(agent.endMarker, 'cyan')}`);
  console.log(`  Use PTY: ${colorize(String(agent.usePty), 'cyan')}`);
  console.log();

  const rl = createReadline();

  try {
    console.log(colorize('请输入新的配置 (直接回车保持不变):\n', 'dim'));

    // 编辑 command
    const newCommand = await question(rl, `Command (当前: ${agent.command}): `);
    if (newCommand) {
      agent.command = newCommand;
    }

    // 编辑 args
    const newArgs = await question(rl, `Args (当前: ${agent.args?.join(' ') || 'none'}): `);
    if (newArgs) {
      agent.args = newArgs.split(' ').filter(s => s.trim());
    }

    // 编辑 endMarker
    const newEndMarker = await question(rl, `End Marker (当前: ${agent.endMarker}): `);
    if (newEndMarker) {
      agent.endMarker = newEndMarker;
    }

    // 编辑 usePty
    const newUsePty = await question(rl, `Use PTY (当前: ${agent.usePty}, 输入 true/false): `);
    if (newUsePty) {
      agent.usePty = newUsePty.toLowerCase() === 'true';
    }

    console.log();

    // 确认保存
    const confirm = await question(rl, '保存更改? (y/N): ');

    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log(colorize('\n✗ 已取消\n', 'yellow'));
      return;
    }

    const result = await registry.updateAgent(agentName, agent);

    if (result.success) {
      console.log(colorize('\n✓ 更新成功\n', 'green'));

      // 验证更新后的 agent
      console.log(colorize('正在验证更新后的配置...', 'dim'));
      const verification = await registry.verifyAgent(agentName);

      if (verification.status === 'verified') {
        console.log(colorize('✓ 验证成功\n', 'green'));
      } else {
        console.log(colorize(`✗ 验证失败: ${verification.error}`, 'yellow'));
        console.log(colorize('请检查配置是否正确\n', 'yellow'));
      }
    } else {
      console.log(colorize(`\n✗ 更新失败: ${result.error}\n`, 'red'));
    }
  } finally {
    rl.close();
  }
}

/**
 * 创建 agents 命令
 */
export function createAgentsCommand(): Command {
  const agents = new Command('agents');

  agents
    .description('管理已注册的 AI agents')
    .action(() => {
      // 默认显示帮助
      agents.help();
    });

  // register 子命令
  agents
    .command('register')
    .description('扫描并注册 AI CLI 工具')
    .option('-a, --auto', '自动注册所有检测到的工具')
    .action(handleRegister);

  // list 子命令
  agents
    .command('list')
    .description('列出所有已注册的 agents')
    .option('-v, --verbose', '显示详细信息')
    .action(handleList);

  // verify 子命令
  agents
    .command('verify')
    .description('验证 agent 可用性')
    .argument('[name]', 'Agent 名称 (不指定则验证所有)')
    .action(handleVerify);

  // info 子命令
  agents
    .command('info')
    .description('显示 agent 详细信息')
    .argument('<name>', 'Agent 名称')
    .action(handleInfo);

  // delete 子命令
  agents
    .command('delete')
    .description('删除已注册的 agent')
    .argument('<name>', 'Agent 名称')
    .option('-f, --force', '强制删除，不询问确认')
    .action(handleDelete);

  // edit 子命令
  agents
    .command('edit')
    .description('编辑 agent 配置')
    .argument('<name>', 'Agent 名称')
    .action(handleEdit);

  return agents;
}
