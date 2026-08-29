# doc/ 变更记录（CHANGELOG）

> 本文件随协议修订维护：SKILL_PROTOCOL_V4.md 等现行规范文档每次修订，均在此登记变更条目。
> 本文件是 doc/ 纳入版本控制（2026-08-10）后的变更基线；此前历次修订无 git 历史，仅以文档内注记（如"2026-08-09 复核"）为据。

## 2026-08-29 · 学习者模型 P0-P2：知识状态摘要 + 学习表现预测 + 校准闭环

### 新增

- **skill:learning-predictor（core v1）**：任务前学习表现预测（stallRisk/predictedTone/suggestedDepth/focusConcepts/rationale）；normalize 含自洽约束（stallRisk≥0.7 强制 struggle）与保守兜底（证据不足→0.5/smooth/standard）。注册链全通：core yaml → md 编译 → DB ACTIVE → manifest（prompt-lab + agent-manifest）→ definitions-registry → skillHandlers → check-data-source。
- **`prediction_records` 表（prisma）**：预测留档 + outcome 回写列（smooth/struggled/failed）；`PredictionCalibrationService`：recordPrediction / resolveOutcome / resolveFromTaskCompletion（review 状态或 sessionLss≥6 → struggled）/ empiricalStats（命中率 + 校准桶，样本带 n）。
- **编排字段（profile.yaml）**：`lesson-knowledge-enricher` 新增 `knowledgeStateSummary` 字段声明 + 路由（accumulate: false，不进编排持久化）。

### 行为变化

- **lesson-knowledge-enricher（core 更新）**：输出 5 字段 → 6 字段（新增 `knowledgeStateSummary`，LBM 式文本化知识状态摘要）；normalize 非字符串 → 空串（不脑补）；evidenceCount 历史虚报修复（Math.max(1) → 0 即 0）。
- **TeachingContextBuilder**：会话创建时幂等获取学习表现预测（已有未回写记录 → 复用；无 → await LLM ≤8s 超时降级 null）；`TeachingScenarioContext.learnerPrediction`（含实证可靠性 reliability，样本 <5 置 null）。
- **AITeachingCoordinator / teaching-turn**：scenario.learnerPrediction 透传；teaching-turn.yaml 新增消费规则（开场策略参考信号、非命令；低样本不得改变默认策略；不得向学生泄露预测措辞）。
- **task:completed 消费者（LearningMetricService）**：reconcileTaskCompletionMetric 附带校准回写（fire-and-forget，失败不阻断）。
- **admin 证据接口**（GET /learner-models/:userId/evidence）：新增 `domain`（goal/path 域证据，中性信号词"澄清/创建/生成"）与 `loadCurve`（learning_metrics 历史趋势，替换错误的分钟数 EWMA）；新增 `GET /:userId/predictions`（校准统计 + 最近预测）。
- **admin LearnerDetail 证据 tab**：两栏布局（左时间线内滚 / 右曲线·建议·密度·校准卡片）；压力曲线改真实 LSS/LF/LSB 三线 + 参考线；新增"预测校准"卡片（实证命中率 + 校准桶 + 预测 vs 实际）。

### 理论登记

- EDUCATIONAL_THEORY_MAP.md：新增 ⑯ 预测校准方法论；第四节 LLM 表新增 LBM/CIKT/LLMKT/LKT/KCQRL/反例/LLM 评估效度/LA 效应量/UKT 九行（含 arXiv/DOI）。

### 遗留

- `virtual-learner-memory-curator` 缺 manifest（yaml:check / skills:check 既有 FAIL，基线即有，待补）。
- `profile-aggregator.calculateConfidence` 旧公式仍在画像聚合（仅展示用途，决策置信度已走校准闭环，待收敛）。

## 2026-08-11 — P0 三件（参数四写收敛第一步 / 快照 import 副作用 / CI 顺序）

### P0-1 参数四写收敛第一步：manifest runtimeDefaults 废弃

- **prompt-lab/manifests/*.yaml（27 个含 _template）删除 `runtimeDefaults` 段**：运行参数唯一写源 =
  `prompts/core/<skillId>.yaml` `params`（core 编译值 → ACTIVE prompt 列 → 运行时 `resolve-llm-call-params`），
  manifest runtimeDefaults 仅发布前 UI 展示镜像，不参与运行时（AUDIT_PERMISSION_AUDIT §4）。
- prompt-lab.ts：`PromptLabManifest.runtimeDefaults` 改为可选并标注废弃；`normalizeManifest` 仅兼容读取
  历史文件（缺省即 undefined）；`serializeManifest` 不再写出该段；PUT /manifest 不再合并 runtimeDefaults；
  `mergeManifestWithPromptFrontmatter` 删除 frontmatter → runtimeDefaults 重建。
- health-center P1 由三写降两写：`analyzeParamsConsistency` 只比对 core ↔ `skills/<id>/definition.ts`，
  删除 manifest 装载（`loadManifestRuntimeDefaults` 移除）；params-consistency / yaml-crosscheck 项文案同步。
- check-yaml-vocabulary **C2 语义变更**：由"双写比对"改为"core 单写检查"——core params 必填自检 +
  历史 manifest 残留 `runtimeDefaults` 时兼容比对（缺省跳过）。
- 协议文档：SKILL_PROTOCOL_V4.md 未提及 manifest runtimeDefaults，无需改动；manifests/README.md 同步。

### P0-2 快照脚本 import 副作用

- `generate-agent-snapshots.ts` 加 `if (require.main === module)` 守卫：import（health-center 复检等只读消费方）
  不再触发写盘，仅 CLI 入口执行 main()（C6 修复）。

### P0-3 CI 顺序缺陷

- 根 `npm run check` 在 `prompts:check`（含 DB 类 `drift-check`）前插入
  `npm --prefix backend run prisma:migrate:deploy:all`，修复空库 `no such table` 顺序缺陷
  （quality-check.yml:42 的根 check 现与 CI post-migrate 段语义一致）。

## 2026-08-11 — 纯重试 + 明确失败改造（移除降级设计）

### 行为变化

- **failurePolicy 词表**：11 个 `fallback` core 全部改为 `propagate`（manifest 同步 `blocking`）；core 词表保留 `fallback` 仅为兼容历史数据，中期收敛为 `retry | propagate`（见 RETRY_FAILURE_IMPACT.md §5.2 路径 B）。
- **session-wrapup**：evaluation 缺失时不再调 session-evaluation-fallback 补全、不再保守评分；直接 `evaluation=null + evaluationSource='unavailable'`（全链路 null 容忍，与 M1 兜底同形态）。
- **teaching-opening-generator**：开场生成失败/超时不再返回确定性 fallback opening，改为抛错（`OPENING_GENERATION_FAILED`，保留 15s 超时边界）→ `failInitialization` 清理会话 + 前端可见"开课失败"。
- **runAux**：`resolveDefaultFailureMode` 对存量 `deterministic-fallback`/`best-effort` 防御性按 propagate 处理并 warn；`__fallback` 保留（调用方显式兜底属调用方决策）。
- **重试预算**：`maxLogicalRetries` 默认 1 → 2（硬上限 2 保持，与 `RETRY_BUDGET_HARD_LIMITS` 对齐）。

### 文档

- SKILL_PROTOCOL_V4.md §2.4.4：failurePolicy 语义同步（fallback 已退役、防御性 propagate 处理）。

## 2026-08-09 — v4.0-draft → v4.1-draft

### 新增

- **§2.6 数据面配置（编排文件）**：新增章节，定义 `prompts/orchestration/<stage>.yaml` 为字段路由域的声明源与唯一编辑入口；`seed-*-field-routings.ts` 随单源化收尾退役（2026-08），orchestration-parity 守护测试随 seed 一并退役。

### 修正（数量口径复核，以 `prompts/core/` 实际文件数为准）

- §1.2：core skill 数 **27 → 25**（此前 27 含 2 个已退役条目）。
- 附录 A：受约束 skill 清单 **25 core + 3 code-only**（此前声称 36/27，差额为已退役 skill 未同步）。
- §5.6：辅助 Skill **16 → 9**（v4-aux-skills index.ts 实际 handler 数）。
- §5.5：排除名单 **15 → 14**（与 `services/skill-output-validator.ts` 实际名单一致）。

### 退役条目标注

- **concept-priority、path-adjustment-generator**：无 core.yaml、无 handler，仅 manifest 残留，一并退役（2026-08-09 复核）；附录 A 以删除线标注，不计入辅助 Skill 数。
