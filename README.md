# WenFlow

![WenFlow 品牌横幅](docs/logo/品牌横幅.png)

> ⚠️ **当前主要开发版本**: [develop](https://github.com/wenflow-org/wenflow/tree/develop) 分支 | main 分支为稳定版

**一款从真实问题出发的 AI 学习路径原型**

> 核心理念：学习始于对真实问题的澄清，而非对课程的选择。

[English Version](README_EN.md) | 中文版

🌐 **Demo 站点**: https://wenflow.org

> 仅作 Demo 演示，不提供正式服务。
> ⚠️ **注意**: Demo 站点会定期清理所有账号和数据，请勿用于存放重要信息。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.17.0-green.svg)](https://nodejs.org)
[![Vue](https://img.shields.io/badge/vue-3.x-brightgreen.svg)](https://vuejs.org)

---

## 为什么存在？

许多学习困境并非源于努力不足，而是目标过于宏大、资料过载、第一步不够清晰。

传统学习产品大多以“内容供给”为起点：课程、资料、题库与预设路径。WenFlow 则从另一端切入——先帮助学习者澄清真正要解决的问题，再由此生成可执行的学习路径，并通过对话、输出与反馈持续调整。

在 AI 能够快速生成大量答案的背景下，更值得训练的能力不再局限于内容记忆，而是：

- **问题定义**：将模糊目标转化为可探索的问题
- **系统思维**：理解知识、场景与行动之间的结构关系
- **判断力**：在信息过载中辨别值得采信的内容
- **AI 协作**：将 AI 作为追问、反馈与推演的伙伴
- **创造力**：在既有知识之间建立新的联结

**答案将日益廉价，问题本身将愈发重要。**

---

## 核心特性

### 产品流程预览

这 6 张图按“从真实问题出发，到进入完整学习闭环”的顺序展示 WenFlow 的核心体验。

| ① 从一个问题开始 |
|:---:|
| ![从一个问题开始](docs/images/home-start-from-problem.png) |
| 学习者先陈述问题，而非直接选课 |

| ② 澄清真实目标 | ③ 生成学习路径 |
|:---:|:---:|
| ![澄清真实目标](docs/images/goal-clarification.png) | ![生成学习路径](docs/images/learning-path.png) |
| AI 通过多轮追问澄清真实目标 | 将模糊目标拆解为阶段、任务与可立即执行的第一步 |

| ④ 进入回合式学习 | ⑤ 学习闭环总览 |
|:---:|:---:|
| ![进入回合式学习](docs/images/round-based-learning.png) | ![学习闭环总览](docs/images/learning-loop-overview.png) |
| AI 讲解、学习者作答并即时获得反馈，教学过程动态调整 | 课后生成总结与评估，并给出后续学习建议 |

| ⑥ 学习状态追踪 |
|:---:|
| ![学习状态追踪](docs/images/learning-state.png) |
| LSS / KTL / LF / LSB 持续追踪学习状态，并在疲劳时予以提醒 |

### 从问题到路径
- **问题澄清**：通过多轮自然对话澄清学习目标
- **路径生成**：将模糊目标拆解为阶段、任务与可立即执行的第一步
- **回合式学习**：AI 讲解、学习者作答并即时获得反馈，教学过程根据理解情况持续调整

### 学习状态追踪
借鉴运动科学中的负荷与恢复思路，持续追踪学习状态，而不只记录是否完成任务：

| 指标 | 含义 | 用途 |
|------|------|------|
| LSS | 学习压力评分 | 基于任务难度、时长、认知负荷，EWMA 平滑 |
| KTL | 知识训练负荷（Knowledge Training Load） | 长期积累，日衰减因子 0.95（半衰期约 13.5 天） |
| LF | 学习疲劳度 | 短期累计，日衰减因子 0.70（半衰期约 2 天） |
| LSB | 学习状态平衡 | KTL - LF，预警过度学习 |

### 平台 Agent / Skill 编排（简版）

```mermaid
flowchart TD
    U[用户] --> G1[目标对话 Skill\n多轮澄清 → 方案确认]
    G1 -- 用户显式确认 --> P1[路径规划 Skill\n认知图景 + 阶段骨架]
    P1 --> P2[阶段设计 Skill\n阶段 → 任务 + 验收点]
    P2 --> T0[AI 教学编排器\n回合状态机]

    T0 --> T1[教学回合 Skill\n讲解 提问 诊断]
    T1 --> K1[知识状态更新\n知识点进度]
    T1 --> S1[学习状态更新\nLSS KTL LF LSB]
    T1 --> C1[检查点测验\n未通过 → 回教学]

    T1 --> D{需要强化?}
    D -- 是 --> PEER[伴学补强 Skill\n费曼式讨论强化]
    D -- 否 --> NEXT{本节结束?}
    C1 --> NEXT
    PEER --> NEXT

    NEXT -- 结束 --> W1[课后产出 Skill\n总结与评估]
    W1 -- lesson:completed 事件 --> E1[outbox 事件\n学习者证据/投影刷新]
    W1 --> R1[重规划建议\n用户确认后生效]
    E1 -. 下一节上下文 .-> T0
    R1 -. 确认后 .-> P1
```

- 顶层 Agent 负责编排，真正持有 prompt、直接调用模型的是 Skills。
- 先澄清目标，再拆解路径。路径生成须经用户显式确认后才启动。
- 教学按 opening → teaching ⇄ intervention → ready_to_close → wrapup 推进；检查点仅在回合内出现；课堂模式固定为 tutor。
- 学习者出现求助信号（求助关键词、连续数轮理解度偏低）时触发伴学，不会放弃当前任务。
- 课后自动生成总结与评估，并附带重规划建议；路径不会自动变更，须经用户确认后才生成新版本。
- 每节课结束后，事件将持久化并更新学习者画像；下一节课开始时，AI 会基于这些信息继续教学。

### 虚拟学习者实验室（Virtual Learner Lab）

通过虚拟学习者账号，以真实用户的方式完整运行产品，用于功能验证：

- **黑盒模拟**：以普通用户的视角完整走完“目标 → 路径 → 学习”全流程，并由裁判与角色保真审计把关
- **Quick Learn**：选取虚拟账号下的任务，自动完成一节课并生成传播报告

### 管理端

管理后台在 `/admin`，共 18 个场景页（按侧栏分组），数据来自真实 API（没有数据时才用演示数据）：

- **总览**：平台总览——当日系统健康度、失败率最高的模型与待排查事项
- **学习者**：用户与学习者（账号 / 学习状态双 tab）——学习状态、风险与疲劳度，支持手动重算快照；学习会话（教学会话 / 目标对话 / 学习路径三 tab）；虚拟学习者
- **Skill 管理**：编排结构（阶段泳道 + 拓扑统计）、Skill 运行（成功率、失败节点、空闲与平均耗时监控）、Skill 设计页（二级页：协议编辑、编译、守门检查、发布、回滚、版本对比、试跑——含最近一次真实调用一键重跑）、Prompt 评估、健康中心
- **运营**：运营中心（待办工作台）、成就管理、反馈中心、通知与公告（公告 / 站内通知双 tab）
- **配置**：模型与接入（路由 / 连通性 / 网络边界 / 重试超时）、外挂能力、会话安全、系统工具（运维工具 + 数据导出）
- **观测**：执行日志（日志 / Trace 瀑布 / 成本分析三个 tab，带重试时间线、自动刷新、导出）、审计日志

> 说明：拓扑视图已并入「编排结构」页；Trace 瀑布与 Token 成本分析已并入「执行日志」；批量实验已并入「虚拟学习者」。场景清单以 `frontend/src/views/admin-redesign/manifest.ts` 为准。

### Prompt 工程体系（Prompt Lab v4，File-as-Truth）

- **真源**：`prompts/core/*.yaml`（唯一人工编辑的入口，进 git）
- **编译产物**：`prompts/skill.*.md`（确定性编译生成，模型只读这个文本）
- **发布链路**：编辑 core.yaml → compile（守门检查）→ publish（写回 md + DB ACTIVE）→ 可 rollback
- **数据库**：`agent_prompts` 只是运行时镜像，文件为准、DB 为镜像

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Vue 3 + TypeScript + Vite 6 + Element Plus + Pinia |
| **后端** | Node.js + Express + TypeScript + Prisma |
| **数据库（当前）** | SQLite（主库 44 表 + system 库 14 表，双库架构） |
| **AI 接入** | OpenAI 兼容模型网关（默认 DeepSeek：deepseek-v4-flash / v4-pro / r1），支持 SSE 流式、重试预算、thinking mode 控制 |
| **Agent / Skill 编排** | EduClaw Gateway + 5 个顶层 Agent（goal/path/teaching/profile/simulation，无 prompt 编排器）/ Skill 执行层（prompts/core 真源 → 编译产物 → DB 镜像）+ Coordinators + Durable Outbox 事件链 |
| **模型配置分层** | 环境变量 → 平台默认 → Agent/Skill 级 → 用户自定义 API / 模型覆盖 |
| **虚拟实验** | Virtual Learner Lab（黑盒模拟 + Quick Learn） |
| **可观测** | Agent/Skill 调用日志、Trace 瀑布、LLM 执行明细 |
| **安全** | JWT + CSRF + 登录限流 + Secret AES-256-GCM 静态加密 + 敏感存储权限审计 |
| **部署** | PowerShell 启动脚本 + 可选 Nginx（测试部署）+ Docker（Linux/macOS） |

---

## 项目状态

WenFlow 目前仍处于**早期开发阶段**，是一个用于验证教学概念的实验性原型。

项目并非对既有学习流程的简单加速，而是试图验证另一条路径：以真实问题为起点，由 AI 协助澄清目标、生成路径并组织反馈，是否更契合 AI 时代的学习方式。

项目将持续探索 5 类能力的训练方式：**问题定义能力、系统思维、判断力、AI 协作力、创造力**。

---

## 快速开始

### 环境要求
- Node.js >= 20.17.0
- 推荐 Windows + PowerShell 5.1+；根目录启动脚本当前未适配 Linux/macOS

安全与 Secret 管理见 [`SECURITY.md`](./SECURITY.md)。提交前运行 `npm run security:scan`。

运行状态：`/health` 和 `/livez` 表示进程存活，`/readyz` 才表示双库和核心运行态可接收流量。

### 推荐顺序（首次使用）

```bash
# 1) 初始化 backend/.env（JWT_SECRET、AI 配置、初始管理员）
npm run env:setup

# 2) 按需选择启动方式
./start-dev.ps1
```

说明：建议首次使用先完成环境初始化，再选择启动脚本。若 `backend/.env` 缺失或 `JWT_SECRET` 不合格，启动脚本也会自动拉起初始化流程。
启动后端时会自动把仓库里的核心 prompts 同步进数据库；克隆仓库后即可直接运行，无需手动导入。

### 本机开发

```bash
# PowerShell
./start-dev.ps1
```

说明：脚本会自动装依赖、生成双 Prisma Client、给主库和 System DB 分别执行 migrate、必要时引导创建或补全 `backend/.env`，启动前再自动同步一次 core prompts。
如需跳过 Prisma 初始化可使用：`./start-dev.ps1 -SkipPrisma`。注意：该选项也会跳过启动前的 core prompts 同步，仅适用于数据库和 prompts 已经准备好的环境。

### 局域网开发模式

```bash
# 自动获取局域网 IP 并启动
./start-lan.ps1

# 或使用 npm 脚本
npm run dev:lan

# 手动指定 IP
./start-lan.ps1 -LanIP 192.168.31.26
```

说明：自动将局域网 IP 加入 `CORS_ORIGIN`，适合多设备调试前台页面；不会改变管理员登录的 `ADMIN_ACCESS_MODE` 访问限制。

### 一键测试部署（本机 Nginx，HTTP）

```bash
# 依赖本机已安装 nginx（并已加入 PATH）
./start-dev.ps1 -UseNginx

# 或使用 npm 脚本
npm run dev:nginx

# 指定域名（不填默认 localhost）
./start-dev.ps1 -UseNginx -Domain test.example.com

# nginx 不在 PATH 时，指定可执行文件路径
./start-dev.ps1 -UseNginx -NginxExePath "C:\nginx\nginx.exe"
```

说明：`-UseNginx` 模式会自动执行 `npm run build`（前端）并生成运行时配置到 `runtime/nginx/wenflow.nginx.conf`；启动前会校验 80 端口可用，若系统 nginx 或其他进程已占用 80 端口，需要先手动停止。

### Docker 部署（Linux/macOS）

```bash
# 一键启动（交互式补齐 backend/.env，也支持环境变量非交互传入）
./docker-start.sh

# 数据库备份（一次性 operations 服务，只读挂载数据卷）
docker compose -f docker-compose.operations.yml run --rm backup
```

说明：`docker-compose.yml` 提供 migrate / backend / nginx 三个服务，默认只发布 Nginx（80），不发布后端 `3001`；后端强制 `ADMIN_ACCESS_MODE=private`。详见 [DEPLOYMENT.md](DEPLOYMENT.md)。

### 质量检查（本地 CI 同款）

```bash
# 依次执行：secret 扫描 → Prisma 双 schema 校验 → 空库迁移回放 → 后端 typecheck → LLM 调用契约检查 → 迁移部署 → prompts 门禁 → lint → 后端/前端测试 → 前后端构建
npm run check
```

说明：GitHub Actions（`.github/workflows/quality-check.yml`）在 push main/master/develop 与 PR 时会执行相同检查（另加 Git 历史 secret 扫描）。

### 环境配置辅助命令

```bash
# 交互式初始化 backend/.env
npm run env:setup

# 快速打开 backend/.env 手动编辑
npm run env:edit
```

说明：`env:setup` 不再单独询问域名；Nginx 模式下域名由 `-Domain`（优先）或 `backend/.env` 中的 `FRONTEND_URL` 推断。

### Prompt 初始化与维护（File-as-Truth）

核心 prompts 采用两级模型：**真源**是 `prompts/core/*.yaml`（唯一人工编辑入口，进 git），**编译产物**是 `prompts/skill.*.md`（模型唯一读取文本），数据库 `agent_prompts` 只是运行时镜像。编辑 → 编译 → 发布链路（含守门检查与回滚）见管理端「Prompt 设计台」，机制详见 [`doc/SKILL_PROTOCOL_V4.md`](doc/SKILL_PROTOCOL_V4.md)。

```bash
# 把 prompts/core/*.yaml 全部确定性编译，重新生成 prompts/skill.*.md（不写数据库）
cd backend
npm run prompts:compile-all

# 把编译产物同步到数据库 ACTIVE 版本（启动时也会自动执行）
npm run prompts:sync-core

# 升级后补齐新增的 prompt 节点，不覆盖已有 ACTIVE 配置
npm run prompts:backfill-core

# 校验与对账
npm run prompts:lint
npm run prompts:core:check
```

说明：`prompts:sync-core` 以仓库编译产物为准，把数据库 ACTIVE 版本同步成一致；不一致时自动创建新版本并切换（旧版归档）。`prompts:backfill-core` 只补缺失节点，不覆盖已有 ACTIVE 配置。若直接在 `backend/` 下运行 `npm run dev`，后端启动时也会自动做一次同步。更多说明见 [`prompts/_README.md`](prompts/_README.md)。

### 本地 SQLite 路径约定

当前仓库默认使用两个 SQLite 库：

- `DATABASE_URL=file:./dev.db`
- `SYSTEM_DATABASE_URL=file:../system.db`

相对 URL 按 Schema 目录解析。请勿继续使用旧的 `file:./prisma/*.db`，也不要把 System URL 改为 `file:./system.db`。已有环境升级前先确认真实权威数据库并备份，可运行 `npm run prisma:baseline:audit` 做只读检查。

### 前端 API 环境变量

- 默认情况下，前端通过相对路径 `/api` 访问后端，由 Vite 代理或 Nginx 转发。
- 管理端配置主要读取 `frontend/.env` 中的 `VITE_API_BASE_URL`。
- 普通用户端在开发模式下固定走 `/api`；非开发模式下 `VITE_API_BASE_URL` 优先，`VITE_API_URL` 仅作历史兜底。如果没有特殊部署需求，保持默认 `/api` 即可。

如需更细粒度的部署或非脚本方式启动，可参考 [DEPLOYMENT.md](DEPLOYMENT.md)。

架构设计、Skill 协议、Prompt 管理与虚拟学习者链路等设计文档见 [`doc/README.md`](doc/README.md)（设计文档索引）。

### 访问地址

**Demo 站点**: https://wenflow.org

**本地开发**
- 前端: http://localhost:5173
- 后端: http://localhost:3001
- 管理后台: http://localhost:5173/admin

说明：管理员登录默认 `ADMIN_ACCESS_MODE=private`（仅本机 + 局域网），也可设为 `loopback`（仅本机）或 `any`（不限来源），并支持 `ADMIN_ALLOWED_IPS` 精确放行（不推荐直接暴露公网管理登录）。

---

## 管理员账户

首次启动时，系统会读取 `backend/.env` 中的以下字段自动创建初始管理员：

```env
INIT_ADMIN_NAME=admin
INIT_ADMIN_PASSWORD=YourStrongPassword123
```

如果数据库里已经存在管理员，系统会自动跳过创建。

建议：首次登录管理端后立即修改密码；对外部署时请使用强密码。

注意：管理员登录默认 `ADMIN_ACCESS_MODE=private`，仅允许本机与局域网（RFC1918）来源访问；可设为 `loopback`（仅本机）或 `any`（不限制来源），并用 `ADMIN_ALLOWED_IPS` 精确放行指定客户端 IP。访问模式策略可在管理端「模型与接入」页面热生效，环境变量仅作默认值。如确有公网远程管理需求，请配合 VPN 或精确 IP 白名单，并自行承担安全加固责任。详见 [admin-guide.md](admin-guide.md)

### 反向代理常见坑

- `CORS_ORIGIN` 建议不要写尾部 `/`（如 `https://demo.example.com`，不要写成 `https://demo.example.com/`）。
- 使用反向代理时，将 `TRUST_PROXY` 配置为直接连接后端的代理 IP/CIDR；生产禁止使用 `true`。
- 不要公开可绕过代理直连的后端端口。Docker Compose 默认只发布 Nginx，不发布后端 `3001`。
- 如果遇到“请求来源不被允许”，先检查浏览器 `Origin` 与 `CORS_ORIGIN` 是否匹配。

---

## 教育理论基础

设计背后的理论，每条都有对应实现：

1. **认知负荷理论** - 单轮知识点上限、回复形态预算，长对话自动压缩
2. **自我导向学习** - 目标由学习者提出、方案由学习者确认，学习节奏由学习者掌控
3. **最近发展区 + 支架** - 难度随理解度自动升降，理解受阻时回补前置基础
4. **形成性评估** - 每轮理解度诊断 + 检查点测验，即时反馈、失败重学
5. **刻意练习 + 检索练习** - 能够独立阐述才算掌握；课后检索式自测，下一节开场承接
6. **费曼技巧（自我解释）** - 以复述讲解检验理解，无法讲清时重新学习
7. **安德森认知目标分类** - 从"记忆"到"创造"6 级认知目标，贯穿标注、教学与完成判定

完整理论依据（含各理论的文献 DOI/arXiv 链接、Wenflow 落点索引与缺口清单）见 [doc/EDUCATIONAL_THEORY_MAP.md](doc/EDUCATIONAL_THEORY_MAP.md)。

---

## License

本项目采用 [MIT License](LICENSE) 开源协议。

Copyright (c) 2026 wenflow-org

---

## 致谢

感谢 [Linux.do](https://linux.do/) 社区成员长期以来的支持与分享。

---

*当 AI 能够解答一切标准问题时，提出好问题的个体将定义未来。*
