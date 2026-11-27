# 系统虚拟学习者卡（100 张）

这 100 张卡来自 Frontier-100 评测基线，可直接在前端「卡库 → 导入卡文档」导入，作为任何部署的默认评测语料。导入后每张卡 = 一份纯档案 + 一个故事池（卡库是身份池，不是账号），不需要改数据库、不需要跑脚本；从卡库派生虚拟学习者时才建立账号，并把随卡资料搬进实例目录。

> 2026-11-25 收束：从 198 张压缩到 100 张。压缩标准不是「AI 会不会」，而是**学完是否留下可复用的判断、验收、纠错能力**：
> - 删掉 8 张「一次性操作/纯交付物」卡（如批量 Excel 统计、Tailwind/uv/Pydantic 迁移、Typst 排版、拒付申诉包）；
> - 12 张「单条新规 + 我的一个场景」从 7–10 天路径降为一次问答 + 清单（F1 组，卡仍留在库里，但不再标 path）；
> - 19 张「AI 会写、但人仍要验收」的卡保留并改写目标（Pandas/Power BI/RAG/DSL/LFA 等）；
> - 其余概念理解、考试门槛、高风险判断、专业深水区、诊断纠偏卡保留。
>
> 逐卡处置与理由见 `backend/.runtime/card-ai-delegation-review.csv`（本地跑数产物，不随仓库提交）。批次文件名（`golden-100` / `frontier-100` / `virtual-learners-200`）沿用历史命名，实际数量以文件内 `cards.length` 为准。

## 文件

| 文件 | 内容 |
| --- | --- |
| `virtual-learners-200.json` | **推荐一次性导入**：golden + frontier 全量 100 张 |
| `golden-100.json` | 基准 53 张（A–E 五组：学科体系 / 工程实操 / 应试 / 业务诊断 / 边界） |
| `frontier-100.json` | 前沿 47 张（F1–F5B：新规时效 / 技术版本 / 私有材料 / 专业深水区 / 诊断纠偏 / 分诊负样本） |

三个文件都是 `{ "version": 1, "cards": [...] }` 结构，前端导入页的 `校验` 与 `导入` 都直接支持。

## 前端导入

1. 打开管理端「虚拟学习者 / 卡库」页面，进入「导入卡文档」（`?view=card-import`）。
2. 拖入 `virtual-learners-200.json`（或两个分组文件之一），点「校验」。
3. 确认「可导入 100」、错误 0 后，点「导入」。
4. 「AI 补全人设」默认不勾：这些卡已带完整场景、目标、预算与追问，导入即可运行。需要更丰富的认知人设时再勾选（会逐卡调用 persona-designer，较慢）。
5. 重复导入时默认跳过同 `cardKey`；想用新版本覆盖，勾选「覆盖已存在的同 cardKey 卡」。

## 构成

- **53 张 golden**：A 学科体系 14、B 工程实操 14、C 应试 9、D 业务诊断 10、E 窄目标 6。E 组含 3 张分诊负样本（E08 视听审美不可判定、E09 摄影构图不可判定、E10 一次性操作），其余 3 张是窄目标正样本（CAP、CATTI CE、电路识别）。
- **47 张 frontier**：F1 新规时效 8、F2 技术版本 10、F3 私有材料 10、F4 专业深水区 9、F5A 诊断纠偏 5、F5B 分诊负样本 5。
- **8 张分诊负样本（3 golden + 5 frontier）**：覆盖情绪危机、权限绕过、纯环境急救、不可文本判定的肢体/感官技艺、一次性操作；用于验证系统不会对非学习诉求硬排路径。
- **10 张私有材料卡（F3）**：F46、F48、F51、F52、F54、F55、F58、F59、F63、F64。随卡内嵌 `materials`（内部手册/协议/规范节选 markdown），导入即写入该卡的归属资料目录（`card-<profileId>`，不建账号）；从该卡派生虚拟学习者时资料随身份搬进实例资料库，路径生成可直接走「附件主线」，无需再手工上传。
- **联网核验来源**：frontier 卡的 `eval.webSource` 保留官方链接与核验事实，供溯源；情景本身是设计的，所以 `source.kind` 统一标为 `synthetic`（导入时会被标记为合成来源，这是预期行为）。

## 压缩时保留的能力面

- **概念与学科心智**：宏观流派、认知记忆、科学哲学、线代、微积分物理桥、概率、SD/SEM、扎根编码、开题方法、博弈论、网络分层、中心法则、谬误判定、p 值语义。
- **工程诊断/心智模型**：SQL 慢查询、Git DAG/reflog、Pandas 向量化、load average、Docker 网络、async 阻塞、Redis 热 key、幂等设计、Tab 竞态、C 指针、STM32、RAG 评测、复现环境。
- **考试门槛**：英语长难句、全等三角形、函数性质、电磁感应、文言文、议论文、教资科目二、行测、法考主观。
- **业务判断**：LLM 评测、SaaS 次留、直通车 ROI、LEC 风险、迭代延期归因、B2B 决策链、PRISMA、大客户经营、技术转管理、CBT-I。
- **前沿/深水区**：AI Act、跨境数据、ISSB、GOLD、电池安全、CBAM、网络数据、AI 安全测试；MCP、React 19、WebGPU、eBPF、Passkeys、SQLite WAL、Cloudflare DO、Next.js 缓存、CRDT、LoRA；TLA+、DID、MCMC、制冷循环、PID、潮流计算、SSA、FEA、zk-SNARK。
- **诊断纠偏**：数据泄露、peeking、微服务过度拆分、自创加密、单条超长 Meta-Prompt。

## 校验结果与预期告警

用后端 `validateCard` 逐张校验：**100 张全部可导入，0 错误**。两类告警是预期的，不影响导入：

1. **「合成来源将标记 isSynthetic」**：所有卡都是设计情景，`source.kind=synthetic` 是诚实标注。
2. **「预算不自洽」（12 张）**：这些卡把 `expectedHours` 当作**内容体量锚**，而 `horizonDays × dailyMinutes` 是**日历容量**；两者按新时间模型本就相互独立（例如 6 小时的内容，分散在 105 天、每天 45 分钟的空闲里）。导入页的这条校验是 2026-10 初的旧口径，看到即可忽略。

## 字段约定

- `cardKey`：稳定 ID（`golden-*` / `frontier-F*`），也是重复导入的幂等键。
- `story.visibleOpening`：Goal 对话开场原话；`story.followUps`：后续三轮自动应答（不足 3 条的已按预算补一条时间安排追问）。
- `story.goalSeed.budget`：场景卡预算 `{ horizonDays, dailyMinutes, expectedHours }`，虚拟学习者链路会把它注入 Goal 开场并锚定 `objectiveScopeHours`。
- `eval`：评测标注（`group` / `expect` / `focus` / `webSource` / `label`），**不在 `story` 里**，不会进入模拟学习者上下文；跑批脚本读这一层。`expect=path` 表示应产出学习路径，`triage` 表示应走分诊负向出口、不生成路径。
- `story.title` / `persona.background`：运行时可见；F86–F100 已去掉「纠偏 / 反模式 / 不可判定 / 非学习诉求」这类评测结论，避免扮演者提前知道正解。
- `materials[].content`：随卡资料正文，导入时写入卡归属目录（`card-<profileId>`）；派生实例时搬入实例资料库。

## 删除与重导

这些卡导入后与普通自建卡无异，可在卡库逐张删除，或用管理接口按 `tags` 批量清理。重新导入同一文件时按 `cardKey` 跳过；要刷新内容需勾选「覆盖已存在」。
