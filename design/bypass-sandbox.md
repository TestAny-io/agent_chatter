# 非交互 + 权限全放开时的隔离方案（macOS sandbox / Windows WSL）

## 目标
- 在“零弹窗”模式下允许文件编辑、命令执行、联网。
- 通过宿主侧沙箱降低越界风险，锁定工作目录，控制环境与网络范围。

## 通用策略
- 启动 CLI：使用对应 CLI 的“全放开”参数 + 锁定 `cwd` + JSONL 输出。
- CWD：固定为项目根（存在 `.git`），避免向上走到更大仓库。
- 环境：精简 `env`，必要时覆写 `HOME` 指向临时目录；PATH 只保留必需工具。
- 监控：启用超时、输出截断，异常时杀进程。

## CLI 权限参数对照
- Claude Code：`--permission-mode bypassPermissions`
- OpenAI Codex：`--dangerously-bypass-approvals-and-sandbox`（或简写 `--yolo`）
- Google Gemini CLI：`--yolo` / `--approval-mode yolo`

示例启动（根据平台套用沙箱命令行）：
- Claude：`claude code --permission-mode bypassPermissions --cwd <projectRoot> --output jsonl ...`
- Codex：`codex exec "<prompt>" --dangerously-bypass-approvals-and-sandbox --cwd <projectRoot> --output jsonl ...`
- Gemini：`gemini --yolo "<prompt>" --cwd <projectRoot> --output jsonl ...`

## macOS：sandbox-exec
- 准备 profile（示例：允许全网、项目目录读写，其他路径只读）：
  ```scheme
  (version 1)
  (deny default)
  (allow file-read*)
  (allow file-write* (regex "^/path/to/project(/|$)"))
  (allow network*)
  (allow process*)
  ```
- 启动：`sandbox-exec -f claude.sb claude code --permission-mode bypassPermissions --cwd /path/to/project --output jsonl ...`
- 如需网络白名单，改用 `(allow network* (remote tcp "api.example.com" 443))` 多行列出。

## Windows：WSL
- 在 WSL 内运行 CLI，项目放在 WSL 内路径（避免 /mnt/c 全盘暴露）。
- 启动：`claude code --permission-mode bypassPermissions --cwd /home/user/project --output jsonl ...`
- 软隔离：
  - 使用受限 Linux 用户（非 root），精简 `env`，可覆写 `HOME`。
  - 网络控制（如需）：iptables/代理白名单；默认全通时需认可风险。

## 风险与残留
- bypassPermissions 等于以宿主用户权限任意执行；无沙箱时风险高。
- macOS sandbox profile 语法老旧，需手工维护；WSL 默认网络全通，需额外约束。
- 覆写 HOME 可能破坏依赖全局配置的工具，需要权衡。

## 无感启动方案（用户只需运行 `agent-chatter`）
总体流程：用户在目标项目目录执行 `agent-chatter` → 脚本自动检测平台 → 生成/选择沙箱配置 → 以 bypass 模式启动对应 AI CLI，锁定当前目录为 cwd → JSONL 输出。

### macOS 路径
1) 入口脚本用 `pwd` 作为 `projectRoot`。若向上发现更高层 `.git`，警告但继续按当前目录作为边界。
2) 动态生成 sandbox profile（写入 `${TMPDIR}/agent-chatter.sb`），内容：
   - 允许读全部、写 `projectRoot` 及其子目录。
   - 允许网络（或可选白名单）。
   - 允许进程。
3) 执行：`sandbox-exec -f <sbPath> claude code --permission-mode bypassPermissions --cwd <projectRoot> --output jsonl ...`（若用户选择 Codex/Gemini，则替换对应 CLI + bypass 参数）。
4) 可选：覆盖 `HOME` 指向 `<projectRoot>/.agent-home`，PATH/ENV 精简。

### Windows 路径（无感 WSL）
1) 若检测在 WSL 内，则直接在当前目录执行：`claude code --permission-mode bypassPermissions --cwd "$(pwd)" --output jsonl ...`。
2) 若在 Windows 主机：
   - 检测 WSL 可用（`wsl.exe --status`），不可用则友好退出并提示安装。
   - 使用 `wslpath` 将当前工作目录转换为 WSL 路径，例如：
     - `wsl.exe wslpath '<windowsPwd>'` → 得到 `<wslPath>`（通常 `/mnt/c/...`）。如需更严格隔离，可提示用户将项目放入 WSL 内目录后再运行。
   - 通过 WSL 启动内部命令：`wsl.exe --cd "<wslPath>" -- claude code --permission-mode bypassPermissions --cwd "<wslPath>" --output jsonl ...`
   - 若需要限制到 WSL 内部目录，入口可检测 `/mnt/c` 前缀并警示（可配置为拒绝或继续）。
3) 同样可在 WSL 内使用受限用户（在安装时创建），入口通过 `wsl.exe -u <user> -- ...` 启动。

### 监控与超时
- 外层入口为子进程设置总超时/空闲超时，超时即 kill；采集 stdout/stderr 写入本地日志。
- 启动前检查必要工具（sandbox-exec 或 WSL + 目标 CLI），缺失则立即退出并给出简要安装指引，不进入半工作状态。

# 立即可实施的“全放行”方案（先于沙箱）
目标：在用户仅运行 `agent-chatter` 的前提下，默认开启各 CLI 的全放行模式并锁定当前目录为 cwd，避免交互提示；后续再补沙箱/WSL。

### 启动参数（按 CLI 映射）
- Claude：`--permission-mode bypassPermissions`，`--output-format stream-json`
- Codex：`--dangerously-bypass-approvals-and-sandbox`（或 `--yolo`）；❌ 无输出格式参数
- Gemini：`--yolo`（或 `--approval-mode yolo`），`--output-format stream-json`
- cwd：统一用 `spawn(..., { cwd: projectRoot })` 设置，不依赖 CLI 参数（Codex 仅支持 `--cd`，Gemini 暂无 cwd 参数）。

### Orchestrator 封装
- CLI 选择与 bypass 映射：入口读取配置选择 CLI，并注入各自 bypass 参数；cwd 一律取 `process.cwd()` 传给 spawn。
- 输出格式：
  - Claude/Gemini：使用 `--output-format stream-json`。
  - Codex：无格式参数，需沿用/加强现有 wrapper 统一输出（推荐全部 CLI 走 wrapper 保持一致）。
- ENV 收敛：传入精简 `env`（仅必要变量）；不建议覆写 HOME，可将 npm 缓存/临时目录指向 `<projectRoot>/.cache`/`tmp`。
- 超时与日志：对子进程设置总超时、空闲超时；采集 stdout/stderr（JSONL 仅适用于 Claude/Gemini；Codex 通过 wrapper 统一输出），异常退出码提示用户。
- 首次启动提示：告知 bypass 等同当前用户权限执行命令/联网，建议在项目目录运行。

### 架构决策
- 现状即方案：全部直连，无官方 wrapper。Codex 通过适配器补 `[DONE]`（无输出格式参数），Claude/Gemini 通过参数开启 bypass + `--output-format stream-json`。

### 后续（非当下实施）
- macOS sandbox-exec / Windows WSL 无感沙箱：后续按上文方案补充，作为可选强化层，不影响当前全放行落地。
