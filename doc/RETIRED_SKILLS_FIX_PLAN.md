# RETIRED_SKILLS 双名单漂移审计与修复方案

> 审计日期：2026-08-10 ｜ 只读调查，未改任何代码
> 证据基线：commit `68bdb6e`（HEAD）
> 审计结论先行：**漂移为单向（cleanup 名单 ⊇ index 名单，多 7 项），且其中 2 项（basic-evaluator / goal-alignment-checker）为"已注册但零调用"的僵尸项，跑 cleanup 脚本不会破坏业务主链，但会永久删掉其 skill_model_configs 配置并造成运行期窗口故障；任务简报中的 course-design 实际不在任何一份名单中。** 名单数量口径：index.ts **35** 项、cleanup 脚本 **42** 项（简报称 34/41，均差 1，以代码为准）。

---

## 1. 名单精确差异

### 1.1 三组清单（含 manifest 状态）

manifest 状态口径：`prompt-lab/manifests/<id>.yaml` 有/无；core.yaml 指 `prompts/core/<id>.yaml`；md 指 `prompts/skill.<id>.md`。

**① 两边都有（35 项）** — index.ts:46-91 ∩ cleanup-retired-field-data.ts:10-18

| skill | core.yaml | manifest | md | 备注 |
|---|---|---|---|---|
| pdf-parser / time-estimator / quiz-generation / exercise-generator / content-generation / error-pattern / code-explainer / answer-generation / batch-anderson-labeler / goal-type-identifier / task-profile-builder | 无 | 无 | 无 | 首批 11 项 |
| state-assessment / confidence-handler / label-generator / text-structure-analyzer / retrieval / web-extractor / image-analyzer / memory-search / smart-search | 无 | 无 | 无 | 2026-07 零调用退役 9 项 |
| session-knowledge-distiller / dialogue-concept-extractor | 无 | 无 | 无 | 并入 lesson-knowledge-enricher |
| learning-turn / learning-opening-generator / learning-strategy-selector | 无 | 无 | 无 | 命名反转退役 |
| generic-planner / basic-generator / basic-extractor / data-mapping | 无 | 无 | 无 | 插件适配链 |
| path-scene-framing / goal-analysis | 无 | goal-analysis **有**（prompt-lab/manifests/goal-analysis.yaml），path-scene-framing 无 | 无 | goal-analysis 是 35 项中**唯一有 manifest 残留**的 |
| goal-profile-inference / learning-pattern-distiller / structured-output-parser / prompt-compiler | 无 | 无 | 无 | 2026-08 零调用退役 |

**② 只在 cleanup 脚本（7 项）** — cleanup-retired-field-data.ts:20-22

| skill | core.yaml | manifest | md | 代码目录 |
|---|---|---|---|---|
| goal-understanding-composer | 无 | 无 | 无 | 有（skills/goal-understanding-composer/index.ts，code-only） |
| teaching-strategy-selector | 无 | 无 | 无 | 有（code-only） |
| acceptance-evidence-evaluator | 无 | 无 | 无 | 有（code-only） |
| basic-evaluator | **有**（prompts/core/basic-evaluator.yaml） | **有** | **有** | 无独立目录（handler 在 v4-aux-skills 内） |
| goal-alignment-checker | **有**（prompts/core/goal-alignment-checker.yaml） | **有** | **有** | 无独立目录（handler 在 v4-aux-skills 内） |
| concept-priority | 无 | 有（prompt-lab/manifests/concept-priority.yaml） | 无 | 无 |
| path-adjustment-generator | 无 | 有（prompt-lab/manifests/path-adjustment-generator.yaml） | 无 | 无 |

**③ 只在 index.ts（0 项）** — 无。cleanup 名单是 index 名单的真超集。

> 简报修正：任务简报称 cleanup 名单"含 basic-evaluator/goal-alignment-checker/**course-design** 等"。经核实 **course-design 不在任何一份名单中**（index.ts:45-92 与 cleanup:9-23 均无）；它是 9 个 aux skill 之一（见 §3）。

---

## 2. 差异项逐项状态判定

| skill | 是否注册 | 生产调用 | 文件残留 | 结论 |
|---|---|---|---|---|
| goal-understanding-composer | ❌ 不在 `allSkillDefinitions`/`skillHandlers`（skills/index.ts:24-25 仅导出，定义无消费者）；`GOAL_UNDERSTANDING_COMPOSER_PROMPT=''`（skills/goal-understanding-composer/index.ts:10） | 确定性纯函数 `buildCollected` 被 goal-conversation 消费（skills/goal-conversation/index.ts:27）；**无 LLM skill 调用** | 仅 code-only 模块 | **真退役**（LLM 本体已注销，模块保留；cleanup 删除其历史残留行安全） |
| teaching-strategy-selector | ❌ 同上（skills/index.ts:32-33） | 纯函数 `getFallbackStrategies/normalizeStrategy/buildGuidancePrompt` 被 teaching-turn 消费（skills/teaching-turn/index.ts:7） | 仅 code-only 模块 | **真退役** |
| acceptance-evidence-evaluator | ❌ 同上（skills/index.ts:28-29） | 纯函数 `evaluateByCriteria/evaluateByProfile` 被 teaching-turn 消费（skills/teaching-turn/index.ts:6） | 仅 code-only 模块 | **真退役** |
| basic-evaluator | ✅ **已注册**：v4-aux-skills/index.ts:27（AuxSkillId）、:168（META）、:303-313（handler）、:345（handlers 表）→ allSkillDefinitions（skills/index.ts:114）→ 启动注册（index.ts:481-485）→ skill_registrations 行（skill-registry.ts:76,196） | ❌ **零生产调用**：全仓 executeSkill/executeSkillWithResult 无引用；skill-output-validator.ts:164 自述"无生产调用" | core.yaml + manifest + md 齐全 | **僵尸**（注册但零调用） |
| goal-alignment-checker | ✅ **已注册**：v4-aux-skills/index.ts:28、:169、:315-325、:346 | ❌ **零生产调用**（同上；validator:167 自述） | core.yaml + manifest + md 齐全 | **僵尸**（注册但零调用） |
| concept-priority | ❌ 全仓无注册（v4-aux / skills / agent-manifest 均无） | ❌ 无 | 仅 manifest（prompt-lab/manifests/concept-priority.yaml） | **真退役**（仅 manifest 残留；CHANGELOG.md:21、SKILL_PROTOCOL_V4.md:396 已记录 2026-08-09 退役） |
| path-adjustment-generator | ❌ 无注册 | ❌ 无 | 仅 manifest（prompt-lab/manifests/path-adjustment-generator.yaml） | **真退役**（同上） |

**僵尸项历史佐证**：commit `68c0839`（2026-08-09）删除了旧插件形态的 `agents/plugins/basic-evaluator.ts` 与 `plugins/goal-alignment-checker/`；现存的 basic-evaluator/goal-alignment-checker 是 v4 迁移后的 aux 注册形态（v4-aux-skills/index.ts:1-2"由原遗留插件/旁路迁入"），**迁移后从未被业务调用**。

**补充判定：course-design（不在名单，简报误报）** — 注册（v4-aux-skills/index.ts:24,165,264-277,342）+ 文件齐全；唯一调用点 ai.service.ts:812 位于 `designWeekCourses`（ai.service.ts:789），而该方法**无任何调用者**（routes/ai-teaching.routes.ts:13 与 routes/learning.ts:6 的 aiService import 均为死 import；前端无调用；commit `8f76e91` 2026-07-31 下线了调用路由）。→ 半僵尸：注册存在、调用点存在但生产不可达。skill-output-validator.ts:151,166 将其归"无生产调用"与事实一致。

---

## 3. purge 与 cleanup 语义对照

| 维度 | index.ts `purgeRetiredSkills`（index.ts:497-516） | cleanup-retired-field-data.ts（:25-42） |
|---|---|---|
| 触发 | **每次启动**：startServer → index.ts:604（在 ensureCoreAgentPrompts:570、bootstrapFieldRoutings:584 之后，initializeGateway:605 之前） | **手动脚本**（一次性运维工具，无 npm script 包装） |
| 名单 | 35 项（index.ts:45-92） | 42 项（:9-23） |
| 删 skill_registrations（system） | ✅ :502 | ✅ :32 |
| 删 skill_model_configs（system） | ✅ :503 | ✅ :33 |
| 删 user_skill_configs（**main 库**） | ✅ :504 | ❌ **缺失**（脚本无 main 库访问） |
| 删 agent_prompts（skill:*） | ✅ :505 | ✅ :31（含 agent-snapshots） |
| 删 agent_field_routings（skill:*） | ✅ :507 | ✅ :29 |
| 删 agent_contracts（skill:*） | ✅ :508 | ✅ :30 |
| 删 agent_prompts（agent-snapshots） | ✅ :510 | ✅ :31 同批 |

启动时序关键点：prompt 同步（:570，File-as-Truth 重建 25 个 core 文件的 agent_prompts 行）→ 字段路由 seed（:584）→ purge（:604）→ 注册全部活跃 skill（:605，registerSkill → skill_registrations upsert，skill-registry.ts:196-217）。因此 purge 后：**退役名的行被清除且不再重建；活跃名的注册行被 purge 未波及（不在名单）或随后重建**。

### 3.1 跑 cleanup 脚本（42 项）的实际后果推演

1. **4 个真退役项**（goal-understanding-composer / teaching-strategy-selector / acceptance-evidence-evaluator / concept-priority / path-adjustment-generator）：删除历史残留行（若有），无副作用。
2. **2 个僵尸项**（basic-evaluator / goal-alignment-checker）：
   - skill_registrations / agent_prompts 行被删 → **下次启动自动自愈**（prompt 由 :570 重建、注册由 :605 重建）；
   - **skill_model_configs 不可自愈**（写入方仅 skillModelConfig.service.ts:67,186 管理端配置，启动不重建）——若曾配置过模型，**永久丢失**；
   - **运行窗口故障**：脚本执行后到下次重启之间，admin 技能测试入口（routes/admin/skills.ts:201 `gateway.executeSkill(name, input)`）与任何按需执行会因 `requireActivePrompt: true`（v4-aux-skills/index.ts:101）找不到 ACTIVE prompt 而失败；
   - 业务主链**无影响**（两 skill 零生产调用）。
3. **不会误删 course-design**：不在名单内，课程设计数据（若有）不受影响。
4. **遗漏 user_skill_configs**：与 purge 语义不完全对齐（main 库该表残留不受脚本影响）。

结论：当前跑 cleanup 脚本不会破坏生产主链数据，但存在"运行期窗口故障 + skill_model_configs 永久丢失"两类风险；且脚本名单包含 2 个"已注册"skill，属于**名单语义错误**（把注册中的 skill 当退役）。

---

## 4. 修复方案

### 4.1 名单单源化（推荐）

**新建 `backend/src/skills/retired-skills.ts`**，导出两个常量：

```ts
// 启动 purge 语义：曾经注册过、启动时必须清残留（当前 35 项，即 index.ts:45-92 现值）
export const RETIRED_SKILLS_PURGE = [ ...35 项... ] as const;
// 全量清理语义：含"仅清理历史行"项（3 code-only 注销 + 2 manifest 残留 + 2 待裁决僵尸，即 cleanup:20-22 现值）
export const RETIRED_SKILLS_ALL = [...RETIRED_SKILLS_PURGE, ...RETIRED_SKILLS_RESIDUE_ONLY] as const;
```

- **index.ts:45-92** → `import { RETIRED_SKILLS_PURGE as RETIRED_SKILLS } from './skills/retired-skills'`（改 import，删字面量）
- **cleanup-retired-field-data.ts:9-23** → `import { RETIRED_SKILLS_ALL as RETIRED_SKILLS } from '../skills/retired-skills'`

理由：
1. **结构保证零漂移**：两名单的包含关系（ALL ⊇ PURGE）由代码结构表达，未来新增条目只需改一处；
2. 两份名单的差异是**语义差异**（启动 purge 只动"注册过"的；脚本才动"仅残留"的），不是笔误，单文件内并列导出可保留该语义注释；
3. 候选方案对比：收敛到 agent-manifest.service.ts 常量（该文件是运行期 manifest 构造器，语义不匹配）、skills.yaml retired 标记（需新增文件体系与加载器，成本高）均不如独立常量文件直接。

### 4.2 CI 门禁

单源化后"两份名单 diff"检查**自然消失**；建议保留一个轻量守卫防止回归：

- 新增 `backend/src/scripts/check-retired-skill-lists.ts`：断言 `RETIRED_SKILLS_PURGE ⊆ RETIRED_SKILLS_ALL` 且 `RETIRED_SKILLS_ALL ∩ 活跃注册名（allSkillDefinitions 名称集） = ∅`，非空则退出码 1；
- 挂入 package.json（backend/package.json scripts）：`"retired:check": "ts-node src/scripts/check-retired-skill-lists.ts"`，并追加到 `prompts:check:all` 链（package.json 现有 `prompts:check:all` 组合脚本）。
- **活跃守卫同时直接服务 cleanup 脚本安全**（见 4.4）。

### 4.3 僵尸条目处置（basic-evaluator / goal-alignment-checker / course-design）

| 条目 | 推荐 | 理由 | 若执行改动点 |
|---|---|---|---|
| basic-evaluator / goal-alignment-checker | **保留注册，移出 cleanup 名单**（归入活跃集合，由守卫保护） | 它们是 v4 迁移后正式登记的 9 个 aux skill 之二，SKILL_PROTOCOL_V4.md §5.6/附录 A（:382-386）计数依赖；有 admin 测试入口可执行；无证据表明必须删除 | 仅从 cleanup-retired-field-data.ts:22 删除；或单源化时归入 PURGE 之外 |
| 同上（备选：产品确认永久无用途） | 正式退役：从 v4-aux-skills/index.ts:27-28（枚举）、:168-169（META）、:303-325（handler）、:345-346（handlers 表）移除；删 prompts/core/{basic-evaluator,goal-alignment-checker}.yaml、prompt-lab/manifests 同名、prompts/skill.*.md；加入 RETIRED_SKILLS_PURGE；更新附录 A 计数（9→7）与 validator 名单 | 退役要一次做完（注册/文件/名单/文档四同步），避免再造僵尸 | 同上 + SKILL_PROTOCOL_V4.md:382-386 |
| course-design | **维持现状**（不在名单）；同步修正 skill-output-validator.ts:151 注释口径为"注册但生产不可达" | 调用点存在于无消费者的 service 方法；若未来恢复路由即为活跃，此时名单位置（不在名单）正确 | skill-output-validator.ts:151,166 |
| concept-priority / path-adjustment-generator | 保持 cleanup 名单；可选删除 prompt-lab/manifests 残留 yaml | resolve-prompt-contract.ts:11 按需加载（仅引用到才读），残留文件无运行影响，删除仅卫生性 | 删除 prompt-lab/manifests/{concept-priority,path-adjustment-generator}.yaml |
| goal-understanding-composer / teaching-strategy-selector / acceptance-evidence-evaluator | 保持 cleanup 名单（清理历史行）；可选清理死导出 | skills/index.ts:24-33 的定义导出与 routes/admin/skills.ts:28-29,43-44 的 `PROMPT=''` 空条目（GOAL_UNDERSTANDING_COMPOSER_PROMPT/ACCEPTANCE_EVIDENCE_EVALUATOR_PROMPT 为空串，skills/goal-understanding-composer/index.ts:10、acceptance-evidence-evaluator/index.ts:11）无消费价值；**纯函数模块本身必须保留** | skills/index.ts:24-33、routes/admin/skills.ts:28-29,43-44 |
| goal-analysis（35 项内唯一 manifest 残留） | 删除 prompt-lab/manifests/goal-analysis.yaml | 与其余 34 项退役状态对齐 | 删除该文件 |

### 4.4 cleanup 脚本安全防护（cleanup-retired-field-data.ts）

1. **dry-run 模式**：`DRY_RUN=1 ts-node ...` 时只执行 `count()` 并输出预估删除行数，不 delete；
2. **活跃名单保护**：脚本开头从 `allSkillDefinitions`（skills/index.ts:102-176）与 `auxSkillDefinitions` 计算活跃名集合，断言 `RETIRED_SKILLS ∩ ACTIVE = ∅`，非空直接拒绝执行（与 4.2 守卫同一来源）；
3. **补齐 user_skill_configs 清理**：增加 `prisma.user_skill_configs.deleteMany`（与 index.ts:504 对齐，需引入 main 库 client）；
4. **文档注记**：脚本须在服务停机时执行（避免 §3.1 运行期窗口故障）。

### 4.5 文档一致性

- SKILL_PROTOCOL_V4.md 附录 A（:371-396）：与 index.ts 名单一致 ✓；与 cleanup 名单 7 项差异中 5 项有注记（:391 code-only 3 项、:396 concept-priority/path-adjustment-generator）✓；**与 basic-evaluator/goal-alignment-checker 冲突**（:385 列为活跃 extractor，cleanup 名单列为退役）——按 4.3 移出 cleanup 名单后即一致；
- §5.5 排除名单（:303-306）：与 skill-output-validator.ts:153-168 实际名单一致 ✓（14 项）；其中"无生产调用"分组（:305）随 4.3 修正口径；
- 修复完成后在附录 A 追加一条退役注记，注明名单单源化位置（`backend/src/skills/retired-skills.ts`）。

---

## 5. 证据索引

| 证据 | 位置 |
|---|---|
| index.ts RETIRED_SKILLS（35 项） | backend/src/index.ts:45-92 |
| purgeRetiredSkills 实现（7 个 deleteMany） | backend/src/index.ts:497-516；启动调用点 :604 |
| 启动顺序（prompt sync → routings → purge → register） | backend/src/index.ts:570,584,604,605 |
| cleanup 脚本名单（42 项）与 5 个 deleteMany | backend/src/scripts/cleanup-retired-field-data.ts:9-23,25-42 |
| v4-aux 注册（9 个 aux skill，含 basic-evaluator/goal-alignment-checker/course-design） | backend/src/skills/v4-aux-skills/index.ts:19-28,160-170,331-347 |
| aux 定义进入注册 | backend/src/skills/index.ts:40-41,102-176；backend/src/index.ts:481-485 |
| registerSkill 持久化 skill_registrations | backend/src/gateway/registries/skill-registry.ts:54-79,193-218 |
| skill_model_configs 唯一写入方（启动不重建） | backend/src/services/skillModelConfig.service.ts:67,186 |
| course-design 唯一调用点（designWeekCourses 无调用者） | backend/src/services/ai/ai.service.ts:789-835（:812） |
| 死 import（aiService 无调用） | backend/src/routes/ai-teaching.routes.ts:13、backend/src/routes/learning.ts:6 |
| 僵尸项零调用自述 | backend/src/services/skill-output-validator.ts:151,164-167 |
| 三元组纯函数消费 | skills/goal-conversation/index.ts:27；skills/teaching-turn/index.ts:6-7 |
| 三元组定义导出无消费者 | skills/index.ts:24-33；routes/admin/skills.ts:28-29,43-44 |
| code-only 空 prompt | skills/goal-understanding-composer/index.ts:10；skills/acceptance-evidence-evaluator/index.ts:11 |
| concept-priority / path-adjustment-generator 退役记录 | doc/CHANGELOG.md:21；doc/SKILL_PROTOCOL_V4.md:396；prompt-lab/manifests/{concept-priority,path-adjustment-generator}.yaml |
| 附录 A 与两份名单的关系 | doc/SKILL_PROTOCOL_V4.md:371-396（:382-386 aux 计数，:385 含两僵尸项） |
| 历史：旧插件形态删除、路由下线 | git 68c0839（2026-08-09）、8f76e91（2026-07-31） |
