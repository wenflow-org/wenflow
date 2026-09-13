# 贡献指南

感谢你关注 WenFlow。本文说明本仓库的开发约定、质量门禁与协作方式。

> WenFlow 目前处于早期开发阶段，是一个用于验证教学概念的实验性原型。接口、数据表结构与 prompt 协议都可能继续调整，请以 `develop` 分支为准。

---

## 一、分支模型

| 分支 | 定位 | 说明 |
|------|------|------|
| `develop` | 主开发分支 | 日常开发提交到这里，CI 与人工验证都在此进行 |
| `main` | 稳定分支 | 只接受经过验证的合入；外部使用者默认从此分支克隆 |

约定：

- 新功能与修复直接提交到 `develop`。
- 需要合入 `main` 时，从 `develop` 合并，并确认 CI 通过。
- 不使用强制推送（force push）覆盖 `main` 与 `develop` 的既有历史。
- 功能分支请使用语义化前缀，例如 `feat/`、`fix/`、`chore/`，完成后及时删除。

## 二、环境准备

环境要求：

- Node.js >= 20.17.0
- 推荐 Windows + PowerShell 5.1+（根目录启动脚本当前未适配 Linux/macOS、Docker 除外）

```bash
# 1) 初始化 backend/.env（JWT_SECRET、AI 配置、初始管理员）
npm run env:setup

# 2) 启动本机开发（自动装依赖、生成双 Prisma Client、执行 migrate、同步 core prompts）
./start-dev.ps1
```

如需跳过 Prisma 初始化，可使用 `./start-dev.ps1 -SkipPrisma`。注意该选项同时会跳过启动前的 core prompts 同步，仅适用于数据库与 prompts 已就绪的环境。

局域网调试用 `./start-lan.ps1`，本机 Nginx 测试部署用 `./start-dev.ps1 -UseNginx`。更细的部署说明见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 三、质量门禁

提交前必须本地跑通与 CI 完全一致的检查：

```bash
npm run check
```

它依次执行：secret 扫描 → Prisma 双 schema 校验 → 空库迁移回放 → 后端 typecheck → 前端 typecheck → LLM 调用契约检查 → 迁移部署 → prompts 门禁 → lint → 后端测试 → 前端测试 → 前后端构建。

`.github/workflows/quality-check.yml` 会在 push `main` / `master` / `develop` 与 PR 时执行同一套检查，并额外扫描可达 Git 历史中的密钥。CI 把检查拆成 3 个并行 job（质量 / 测试 / 构建），分别对应本地可单独复现的子命令：

```bash
npm run check:quality    # secret / prisma / 类型 / prompts 门禁 / lint
npm run check:test       # 后端 + 前端测试（带覆盖率门槛）
npm run check:build      # 前后端构建
```

`check:test` 会强制覆盖率门槛（`backend/jest.config.js`、`frontend/vitest.config.ts` 的 `coverageThreshold` / `thresholds`），目标是防劣化：可以小幅上调，但不要为了过 CI 下调。

单独运行某个环节：

```bash
npm run typecheck:backend        # 后端类型检查
npm test                         # 后端测试
npm --prefix frontend run test   # 前端单测
npm run lint                     # 前后端 lint
npm run security:scan            # 当前工作区 + Git 历史的密钥扫描
```

**提交的底线是 `npm run check` 全绿。** 如果某一步在本地无法复现，请在 PR 描述中说明，不要静默绕过。

### 类型安全：`any` 存量冻结

`@typescript-eslint/no-explicit-any` 在前后端均设为 `error`。为不阻塞历史代码，审计时已把当时违规的文件列入 `backend/.eslintrc.json` / `frontend/.eslintrc.cjs` 的 `overrides` 白名单并临时关闭该规则：

- **新增文件禁止使用 `any`**，否则 `npm run lint` 直接失败。
- 修改白名单中的旧文件时，顺手把 `any` 换成具体类型；改干净后请把该文件从白名单中删掉（白名单只减不增）。
- 不要把规则改回 `warn`，也不要为了让新代码通过而扩大白名单。

## 四、Prompt 与 Skill 改动铁律（File-as-Truth）

这是本仓库最容易被误改的地方，改动前请先读 [doc/SKILL_PROTOCOL_V4.md](./doc/SKILL_PROTOCOL_V4.md)。

核心规则：

1. **唯一人工编辑入口是 `prompts/core/*.yaml`**，它进 git，是事实源（SSOT）。
2. **`prompts/skill.*.md` 是编译产物**，由 core.yaml 确定性生成，模型只读这份文本。不要手工编辑。
3. **数据库 `agent_prompts` 只是运行时镜像**，不要直接改库，它以文件为准。

标准链路：

```bash
cd backend
npm run prompts:compile-all    # 由 core.yaml 重新编译出 skill.*.md（不写库）
npm run prompts:sync-core      # 把编译产物同步成数据库 ACTIVE 版本
npm run prompts:backfill-core  # 升级后只补缺失节点，不覆盖已有 ACTIVE 配置

npm run prompts:lint           # 校验
npm run prompts:core:check     # 对账
```

编辑 → 编译 → 发布（守门检查）→ 可回滚的完整链路，也可以在管理端「Prompt 设计台」中完成。

## 五、数据库与迁移

仓库当前使用两个 SQLite 库：

- `DATABASE_URL=file:./dev.db`
- `SYSTEM_DATABASE_URL=file:../system.db`

相对 URL 按 Schema 目录解析。请勿继续使用旧的 `file:./prisma/*.db`，也不要把 System URL 写成 `file:./system.db`。

修改 Prisma schema 后必须同时生成迁移，并确认空库能回放出一致的结构：

```bash
npm run prisma:validate
npm run prisma:migrate:verify-clean   # 空库回放对账，CI 会跑
```

`verify-prisma-clean-replay` 报 `database drift detected` 说明迁移历史无法重建当前 schema —— 请补上缺失的迁移，不要调整校验阈值。

## 六、提交信息约定

沿用仓库既有风格：`type(scope): 摘要`，正文用中文说明**现象、根因、修复、验证**。

```
fix(admin): 用户详情的协助授权提示暗色发白 + 主视图 pills 被拉成整行

一、开发视角许可提示暗色仍为白底
   .ud-grant__notice 硬编码 background:#eef5ff，暗色无覆写 →
   改用 token var(--mk-blue-bg)

验证：实机 1920 逐一确认 10 个页面主视图切换器均为状态条正下方独立行；
typecheck 通过，测试无新增失败。
```

常用的 type：`feat` / `fix` / `refactor` / `docs` / `chore` / `style`。

写清「验证方式」比写清「改了什么」更重要，它决定了别人是否能复核你的结论。

## 七、反馈问题与建议

提交 Issue 前，请先搜索是否已有同类问题。

**Bug 反馈**请尽量包含以下字段，缺少复现路径的问题往往无法定位：

| 字段 | 说明 |
|------|------|
| 复现环境 | 操作系统、浏览器、Node 版本 |
| 版本 / 分支 | 例如 `develop @ b0ba909` |
| 账号信息 | 角色（学习者 / 管理员），不要贴真实密码 |
| 前置条件 | 复现前的状态，如已有学习路径、已完成的回合数 |
| 复现步骤 | 编号列出，尽量最小化 |
| 实际结果 | 包含完整报错、日志片段或截图 |
| 期望结果 | 你认为正确的行为 |
| 影响范围 | 是否阻断主流程、影响多少用户 |
| 是否阻断上线 | 是 / 否，以及判断依据 |

**功能请求**请说明使用场景与痛点，而不只是期望的实现方式。

## 八、安全

- 提交前务必运行 `npm run security:scan`，确保没有密钥进入提交。
- 不要在 Issue、PR、日志或截图中粘贴真实的 API Key、JWT_SECRET、数据库文件。
- 发现安全问题请勿公开提交 Issue，按 [SECURITY.md](./SECURITY.md) 的方式私下联系维护者。

## 九、许可

本项目采用 [MIT License](./LICENSE)。提交贡献即表示你同意以该许可发布你的贡献。

Copyright (c) 2026 wenflow-org
