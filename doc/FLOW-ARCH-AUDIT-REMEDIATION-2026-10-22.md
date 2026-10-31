# 流程架构审计修复与数据处置记录（2026-10-22）

对应审计：`doc/local/FLOW-ARCH-AUDIT-2026-10-22.md`（gitignored）。核心修复批已提交 `65534929`；本文件记录后续四项的拍板与落地证据。

## 1. mobile:spec 门禁：不适用（fixture 已删除）

判定：**当前仓库状态下不适用**，不是通过，也不是代码缺陷。

证据：
- 脚本默认账号 `logocheck2` 在 `users` 表中 `deletedAt=2026-10-14T01:42:33.845Z`，登录返回“用户名或密码错误”。
- 脚本的 `PAGES` 硬编码了该账号名下的课堂 URL（`/learn/teaching_user_c2aad129-...`）；换用其他账号也无法访问这些 fixture。
- 之前运行 5 分钟无输出，实际在 3 次登录重试与 13 个页面的 40s 门禁等待之间空转。

落地：
- `frontend/scripts/check-mobile-spec.mjs` 增加登录前置断言；无法登录时输出明确原因并以退出码 2 快速结束，不再对未登录页量尺寸产出假读数。
- 复跑 `npm run mobile:spec`：退出码 2，输出“前置失败：无法登录 … 请设置 SPEC_USER/SPEC_PASS，或先恢复 fixture 账号后再跑”。

后续启用方式：恢复一个可登录的 QA 账号，并把脚本里的课堂/路径 URL 替换为该账号的 fixture；或用 `SPEC_USER`/`SPEC_PASS` 指定账号后同步更新硬编码 URL。

## 2. P1-7 建议确认→执行漏斗：补执行档埋点，不做历史伪造

现状（`backend/src/scripts/audit-advisory-funnel.ts`，只读）：
- 362 条 `shouldSuggest=true` 的建议；
- 17 条有 `learnerResponse`，全部为 `later`；
- 明确 `adopt` 为 0；
- 路径重排 3 次，`replanTriggerSource` 全为 `ai-teaching`。

根因判断：此前只记录 `keep/later/preview`，真实执行重排成功后没有回写处置动作，漏斗缺“真执行”档；17:0 不能直接解读为“用户从不采用”，因为执行档从未被记录。

落地：
- `TeachingSessionRepository.recordAdvisoryResponse` 与 `/api/ai-teaching/sessions/:sessionId/advisory-response` 接受 `adopt`。
- 完课卡 `LearningEvaluationPage` 在 replan 真正执行成功后回写 `adopt`；学习状态页 `V2LearningState.confirmAdjust` 同样回写（决策卡新增 `sessionId` 透传）。
- 虚拟学习者 assisted 轨新增 `--advisory-response=adopt`：收束后调用真实 replan，成功才记 `adopt`；keep/later/preview 仍只留痕。用于小样本链路验证，不替代真实学习者行为。
- 历史 3 次重排不反推 `adopt`：没有可靠的建议-重排一一对应关系，伪造会把观测数据变成假账。运营口径同时看 `explicitAdopt` 与 `replanExecuted`。
- 复核命令：

```bash
cd backend
DATABASE_URL='file:D:/wenflow/wenflow/backend/prisma/dev.db' \
SYSTEM_DATABASE_URL='file:D:/wenflow/wenflow/backend/prisma/system.db' \
npx ts-node src/scripts/audit-advisory-funnel.ts
```

评估所需数据量（比例估计，95% 置信区间）：

| 目标精度 | 50% 附近所需建议数 | 20% 附近所需建议数 |
|---|---|---|
| ±10% | 97 | 62 |
| ±7.5% | 171 | 110 |
| ±5% | 385 | 246 |
| ±3% | 1068 | 683 |

若从“建议生成”倒推：现有漏斗建议触发率约 45%（362 条建议 / 约 800 节完成课），要拿到 100 个处置样本，按 20% 采用率需要约 500 条建议、约 1100 节课；按 30% 采用率约需 334 条建议、约 740 节课。若还要按 `reinforce/resequence/accelerate` 分臂比较，每臂至少需要几十到上百个采用样本，建议按每臂 100 个处置样本排批。两组比例比较（80% 功效）参考：20% vs 40% 每臂约 81 个采用样本，20% vs 30% 每臂约 292 个。

小样本实测（2026-10-22，独立 dev.db）：创建 1 个丢弃式虚拟学习者，跑 3 节完成课（2 个模拟日 + 续跑 1 日），生成 0 条建议；这说明单学习者 1–2 天不足以评估建议分布，只能验证链路不报错，不能估计采用率。该学习者已通过管理端级联删除（3 个 teaching session、1 条 path），未留在业务数据中。

## 3. 历史 pathReview：不回填，仅登记缺口

判定：301 条修复前生成的路径保持 `pathReview:null`，**不自动重跑评审**。

理由：
- `pathReview` 是生成期 LLM 质检快照；对已交付/进行中的路径重跑会改写生成元数据，且 301 次 LLM 调用成本高、结果不可比。
- 修复后的代码只影响新生成路径；历史 null 不再被当作“评审失败”触发错误消费。

落地：
- `backend/src/scripts/audit-path-review-backlog.ts` 按路径状态盘点 `reviewed/missing`，不写库。
- 当前结果：active 258、completed 19、archived 11、failed 13，全部 missing；总计 301 条。
- 如运营需要单条复评，应走一次显式生成/评审流程，而不是批量静默回填。

## 4. 幽灵痕与毒丸死信：已清理/已恢复

幽灵痕：
- 定义：`source='kt-estimate' AND extractionCount=0`，共 17 条，均为 KT 占位行，读侧已过滤。
- 处置：`backend/src/scripts/cleanup-kt-ghost-traces.ts --apply` 删除 17 条；删除前整行备份到仓库根 `outputs/kt-ghost-traces-2026-10-22.json`（gitignored）。
- 复核：同条件计数 0；读侧 `extractionCount>0` 过滤保留，防止未来再写入时泄漏。

毒丸死信：
- 事件：`evt_1790956799999_etzu2x2e3`（`review:completed`，8 次失败，`Invalid memory state { difficulty: 9.97, stability: 0.00085 }`）。
- 根因：干扰惩罚 ×0.85 把稳定性压到 ts-fsrs `S_MIN` 以下；`ReviewCompletedConsumer` 已在落库前夹回 `FSRS_MIN_STABILITY`。
- 处置：确认根因修复后通过管理端 `force=true` 重放；事件状态由 `dead` → `published`，`attemptCount` 清零，`lastError` 清空。
- 结果：该用户新增 2 条 `review:completed` 证据与 2 条 `source='review-event'` 记忆痕，稳定性 1.2931 / 2.3065，均为合法 FSRS 状态。

## 验证命令与结果

- 后端定向：`advisory-response.test.ts` + `ai-teaching.routes.test.ts`，38/38 通过。
- 后端/前端 `typecheck` 均通过。
- 3001 真机：毒丸死信 `force` 重放 200，随后 outbox 状态 `published`；健康中心运行项可读。
