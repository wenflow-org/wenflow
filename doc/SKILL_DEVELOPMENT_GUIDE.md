# Skill 开发指南（开发者向）

> 面向「新建 / 改造 Skill」的开发者。从选型 → scaffold → 接线 → 加字段 → 门禁 → 发布 → 测试，
> 一条龙说明。平台定位：**字段级管理能力**（core.yaml 与编排文件双声明，字段级原子增/改/删 API）。
>
> 相关设计文档：
> - 字段级编辑、户口簿规格、扩展设计等历史过程文档已清理不保留（曾位于 `doc/archive/` 与 `doc/history/`，2026-09-05 起不在仓库）
> - 完成度状态机：`backend/src/services/skill-registry/skill-completion.service.ts`
>
> 日期：2026-08-12

---

## 1. Skill 三类：定位与选择

| 维度 | **mainline**（主链） | **aux**（旁挂） | **handler-only**（纯函数） |
|---|---|---|---|
| 定位 | 阶段主流程产出（goal/path/teaching/profile/simulation 五阶段） | 旁挂能力（开场文案/课程设计/评估等），经 runAux 框架执行 | 无 LLM prompt 的纯函数/工具（learner-model、mcp-tool） |
| 进字段路由 | ✅ 是（编排文件 routings 有 `skill:<id>` 产出行） | ❌ 否（不进字段路由） | ❌ 否 |
| 户口簿必填 | `kind` + `stage`（∈ 五阶段）+ `parentAgent` + `handlerRef` + `coreFile` | `kind` + `coreFile` + `handlerRef`（stage/parentAgent 可选） | `kind` + `handlerRef`（**禁填 coreFile**，自动 `noPromptFile: true`） |
| 编排文件 | 必须出现在对应 stage 的 `contracts`（F3 铁律，双向校验） | 不要求 | 不要求 |
| 注册点 | `skillHandlers`（skills/index.ts）+ manifest（F12） | `v4-aux-skills/index.ts` 的 META 表 + `auxSkillHandlers` | `skillHandlers` + manifest（F12） |
| 运行时 prompt | 发布 core → agent_prompts ACTIVE | 发布 core → agent_prompts ACTIVE | 无（豁免） |

**选择建议**：
- 是阶段主链的决策/产出节点（需要字段路由参与跨阶段流转）→ **mainline**。
- 是辅助性内容生成（不参与字段路由，仅消费输入产出交付物）→ **aux**。
- 不需要 LLM prompt（纯计算/查库/平台工具执行器）→ **handler-only**。

---

## 2. scaffold：POST /api/admin/skills/scaffold

一次请求生成全部骨架（幂等：条目与生成物齐备 → 409 `already-exists`；部分缺失 → 补齐）。

```bash
curl -X POST http://localhost:3000/api/admin/skills/scaffold \
  -H 'Content-Type: application/json' \
  -d '{
    "skillId": "my-new-skill",
    "kind": "mainline",
    "stage": "path",
    "parentAgent": "path-agent",
    "displayName": "我的新 Skill",
    "description": "负责……"
  }'
```

| 生成物 | 说明 | 校验器 |
|---|---|---|
| `prompts/core/<skillId>.yaml` | 最小合法 core 骨架（identity/rules/fields 带 TODO 占位） | `parseCoreFile` |
| `backend/src/skills/<skillId>/index.ts` | 占位 handler（调用抛 `SC_NOT_IMPLEMENTED`；**不注册进 skillHandlers**，启动安全） | skills:check F5 |
| `prompts/orchestration/<stage>.yaml` | `contracts` 追加 `- agentId: skill:<id>`（mainline F3 铁律） | `parseOrchestrationFile` |
| `prompts/skills.yaml` | 户口簿条目（提交点） | `validateSkillsContent`（F1~F12） |

响应里 `snippets` 数组是**不落盘的接线片段文本**（第 3 节 3 处手工接线），照抄即可；
`completion` 是完成度报告（第 3 节）。form 元数据：`GET /api/admin/skills/scaffold/meta`
（kind/stage 枚举 + manifest agent 下拉数据源）。

---

## 3. 完成度状态机：draft → live 五档

`backend/src/services/skill-registry/skill-completion.service.ts`（`workbench-meta` 返回 `completion`）。

| 档位 | 含义 | 过档条件 |
|---|---|---|
| `draft` | 户口簿有登记（恒满足的起点） | 在 `prompts/skills.yaml` 活跃集 |
| `handler-ready` | handler 就绪 | `handlerRef` 文件存在 + 注册存在（F5/F11） |
| `core-ready` | core 声明就绪 | core.yaml 存在、可 parse、无 TODO 占位 |
| `fields-synced` | 字段路由对齐 | mainline：编排 contracts 含 `skill:<id>` + `analyzeCoreFieldsSync` 缺项 = 0 |
| `live` | 线上生效 | `agent_prompts` 有 ACTIVE 行（发布成功；noPromptFile=true 豁免） |

状态 = 最大连续满足前缀：条件回退即状态回退。**从零到 live 的推进路径**：
scaffold（draft）→ 实现 handler + 粘贴注册片段（handler-ready）→ 填 core（core-ready）→
字段路由 tab 加字段 / 手工登记编排（fields-synced）→ 发布（live）。

---

## 4. 三处手工注册接线（scaffold 只出片段，不落盘）

> 决策背景：注册是**代码语义**（import/映射），不是配置声明，scaffold 只把「6~7 处手写」收敛为
> 「3 处粘贴」（SKILLS_YAML_SPEC:210-215）。

### 4.1 manifest 登记（F12：mainline/handler-only 必须登记，kind=skill）

`backend/src/services/agent-manifest.service.ts` 的 `AGENT_MANIFEST` 数组追加（对照既有 skill 条目）：

```ts
{
  id: 'skill:my-new-skill',
  name: 'My New Skill Skill',
  description: '负责……',
  category: 'path',
  kind: 'skill',
  runtimeEnabled: true,
  userVisible: false,
  monitoringGroup: 'Path',
  aliases: [],
  ioContractVersion: 'agent-output-v1',
  defaultModelConfig: { temperature: 0.5, maxTokens: 4000 },
},
```

> F12 双向一致：manifest skill 条目 ⊆ 户口簿活跃集（aux 豁免，合法不登 manifest）；
> 户口簿登记缺 manifest 条目（mainline/handler-only）→ fail-fast。

### 4.2 skills/index.ts 注册（F11：skillHandlers 双向存在性）

```ts
// backend/src/skills/index.ts
import { myNewSkillHandler } from './my-new-skill'

export const allSkillDefinitions = [
  // ...既有项
  { name: 'my-new-skill', version: 1, category: 'generation', description: '负责……', capabilities: [], inputSchema: {}, outputSchema: {} },
]

export const skillHandlers = {
  // ...既有项
  'my-new-skill': (input) => myNewSkillHandler(input),
}
```

> F11 按 `registrationPoint` 分派（默认 `skillHandlers`；`agents`/`platform-direct`/`none` 豁免）。
> aux 例外：粘贴进 `backend/src/skills/v4-aux-skills/index.ts`（AuxSkillId 联合类型 + META 表 +
> handler 函数 + `auxSkillHandlers` 映射 4 处修改，snippets 有完整模板）。

### 4.3 协调器 steps 挂接点（可选，mainline）

户口簿条目加 `coordinator` 块（`definition.ts` 保持手写权威，此处只做挂接点登记）：

```yaml
coordinator:
  agentId: path-agent
  steps:
    - { step: 2, role: my-role, condition: 触发条件 }
```

---

## 5. 加字段 / 改字段 / 删字段（平台原子 API）

字段 = **同一份声明的两处表达**：core.yaml `fields`（name/type/desc/turn）与编排文件
`fields/routings`（fieldId/promptRole/valueType/render/handoff/…）。平台提供字段级原子 API，
双文件要么都写要么都不写（写前内存校验 → 备份 → 写 core → 写编排失败回滚 core →
fields-sync 复检违规双文件回滚 → 落库 → 审计）。

| 操作 | 方法/路径 | 要点 |
|---|---|---|
| 加字段 | `POST /api/admin/prompt-lab/core/:skillId/field` | 双写追加 + ensure 落库 + 审计 `skill-field-add`；重名 409 |
| 改字段 | `PATCH /api/admin/prompt-lab/core/:skillId/field/:name` | 双写修改 + sync 全量对账（**update 语义**，managedByCode=false 行跳过报告）+ 审计 `skill-field-update`；无变化 → 200 `changed=false` |
| 删字段 | `DELETE /api/admin/prompt-lab/core/:skillId/field/:name` | 双写删除 + DB 行清理（managedByCode=false 跳过报告）+ 审计 `skill-field-delete`；systemLocked / 下游消费 → 409 |

改字段可改：`type`（core）/`desc`/`role`/`render`/`handoff`/`internal`/`accumulate`/`turn`/
`visibilityPreset`/`locked`/`persistKey`/`pathInRawOutput`；可选声明传 `''`/`null` 即清除。

**平台 UI 入口**：`/admin/skills/:skillId` 的「字段路由」tab（SkillDesignPage 第 6 tab）——
产出字段表行级「编辑」「删除」+ 「＋加字段」向导。字段名不可改（= 身份标识）。

**保护规则**：systemLocked 字段禁改禁删（只读，走编排文件）；删除前做消费检查——编排文件内
其他 agent 的 routings 引用、其他 skill 的 core inputs（`ref: skill:<id>.<field>`）消费 →
409 `FIELD_CONSUMED` 列出消费方。

---

## 6. 门禁：prompts:check:all 全链

`npm run prompts:check:all`（backend），新增/修改 skill 与字段后必须全绿：

| 子门禁 | 校验什么 | 违规等级 |
|---|---|---|
| `prompts:lint` | prompts 目录 lint | error |
| `prompts:check-handoff:strict` | core inputs ↔ handoff 路由表对账（strict） | error |
| `prompts:snapshots:check` | agent prompt 快照一致 | error |
| `prompts:drift-check` | 编排文件声明 ↔ DB 漂移 | error |
| `retired:check` | 活跃集 ∩ 退役名单 = ∅ | error |
| `prompts:skills:check` | 户口簿 F1~F12（含 F3 contracts 双向、F5 handler 存在、F11 注册、F12 manifest 双向） | error |
| `prompts:data-source:check` | dataSource 声明 ↔ 模型/API | error |
| `prompts:yaml:check` | 词表一致性（类型/角色/render 拼写） | error |
| `prompts:fields-sync:check` | core fields ↔ 编排产出行：缺项（error）/ 孤儿（warn）/ 类型不一致（error） | 见上 |

**字段级联动的含义**：平台原子 API 保证「core ⇔ 编排」成对出现（成对加/成对改/成对删），
field-sync 的缺项/孤儿不应由平台操作产生；若门禁报缺项/孤儿，先查是否手工只改了一侧。

---

## 7. 发布流程（core 发布管线 + developerApproval）

SkillDesignPage「协议」tab：编辑 core（表单/源码双模式）→ **编译预览**（dry run，不触发语义
judge）→ **发布**（`POST /api/admin/prompt-lab/publish-core`）。

发布管线（prompt-lab.ts：525-734）：
1. **编辑分级**：`classifyCoreEdit` → safe / restricted / blocked（字段冻结、平台包装字段等）。
2. **审批门**：非 safe 编辑强制 `developerApproval.reference`（引用输入），缺失 → 409。
3. **语义门**：`decideSemanticGate` → 语义不确定 → 409 `SEMANTIC_UNCERTAIN`（前端可人工确认强制发布）。
4. **事务 + 原子写盘**：发布写 agent_prompts ACTIVE + 备份；失败自动回滚。

**加/改字段后的发布**：字段路由 tab 的保存动作**不并入发布**（发布有审批/语义门，且发布前应
先编译预览）。向导完成后 → 协议 tab → 编译预览 → 发布（新增/修改字段通常触发 restricted →
需 developerApproval 引用）。

---

## 8. 测试指引

| 层 | 命令 | 关键用例 |
|---|---|---|
| 后端单测 | `npx jest --runInBand`（backend） | 字段 API：`prompt-lab.field-add.test.ts`（M1）/ `prompt-lab.field-edit.test.ts`（M3：PATCH 改/DELETE 保护检查/双写回滚/落库 update 语义/幂等） |
| 类型检查 | `npx tsc -p tsconfig.build.json --noEmit`（backend）/ `npm run typecheck`（frontend） | 全量 |
| 前端构建 | `npm run build`（frontend） | 产物可部署 |
| 门禁 | `npm run prompts:check:all` | 第 6 节全链 |
| 全链 | `npm run check`（仓库根） | security:scan + prisma + typecheck + llm:calls + prompts:check + 全量测试 + 双端构建 |

测试字段 API 的约定（隔离真实 prompts/）：jest 内设置 `CORE_FILES_DIR` / `ORCHESTRATION_DIR` /
`SKILLS_FILE` / `PROMPTS_DIR` 环境变量后 `jest.isolateModules` 动态装载路由（目录常量在模块
装载时固化）；DB 用内存假库（update/delete/create + managedByCode 保护语义）。

---

## 9. 从零到上线 checklist

```text
[ ] 1. 选型：mainline / aux / handler-only（第 1 节）
[ ] 2. POST /api/admin/skills/scaffold（第 2 节）→ 生成物 + snippets 落本地
[ ] 3. 三处接线（第 4 节）：
       [ ] a. agent-manifest.service.ts AGENT_MANIFEST（F12；aux 跳过）
       [ ] b. skills/index.ts 注册（F11；aux → v4-aux-skills 4 处）
       [ ] c. 户口簿 coordinator steps（可选，mainline）
[ ] 4. 实现 backend/src/skills/<skillId>/index.ts（替换占位 handler；aux 用 runAux 模板）
[ ] 5. 填 core.yaml：identity/channels/rules/inputs/fields/constraints/params（消除 TODO）
[ ] 6. 字段路由 tab：＋加字段 登记产出字段（或手工写编排 fields/routings）→ fields-synced 过档
[ ] 7. 试跑：SkillDesignPage「试跑」tab（最近调用 + 真实输入重跑）验证输出
[ ] 8. 门禁：npm run prompts:check:all 全绿（第 6 节）
[ ] 9. 发布：编译预览 → publish-core（非 safe 填 developerApproval 引用；语义门 409 需人工确认）
[ ] 10. 验证完成度 = live（workbench-meta completion）
[ ] 11. 回归：npm run check（全链）
```
