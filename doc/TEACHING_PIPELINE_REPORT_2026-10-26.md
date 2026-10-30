# 教学课堂管线报告（图分支 · 2026-10-26）

> 范围：`feat/teaching-figures` 工作树（`D:/test/wenflow-figures`）上的课堂管线现状。
> 数据来源：五轮外部视觉盲评、12 学科广度扫测、8 概念卡探针、4 节真课（虚拟学习者）。
> 结论先行：**管线骨架已经完整且可验证——出图决策链 9 道闸全部代码化、13 种图型确定性渲染、
> 泄题类问题被压到可拦截；短板从「会不会画」转移到了「什么时机画什么」——任务层不产几何任务、
> 概念图缺独立评审口径，是当前仅剩的两个结构性缺口。**

---

## 一、管线全貌

```
排课/路径规划 ──► 课堂会话（teaching_sessions + messages 侧表）
                    │
                    ▼
        教学回合 teaching-turn（skill）
   prompts/core/teaching-turn.yaml ─编译─► prompts/skill.teaching-turn.md
   输入：任务画像/知识看板/认知框架/学习者投影/visualOpportunity
   模型：deepseek-v4.1-flash（newapi 通道，providerId=platform）
                    │
                    ▼ JSON 输出
   reply / knowledge.points / analysis / control(checkpoint,isCompletionCandidate)
   figure / diagram / visual
                    │
                    ▼  引擎层（teaching-turn-engine.ts）
   ┌─ 泄题/时机/复述/配额/去重 九道闸（见 §二）
   ├─ caption/note 统一撤除；学科调色板盖章
   ├─ 归一化（skills/teaching-turn/index.ts，逐字段校验，废图型拒绝）
   └─ 检查点：control.checkpoint → pendingCheckpoint → 判罚（code/LLM）→ 掌握推进
                    │
                    ▼  落库 + 渲染
   figures 进 messages 侧表（teachingSessionRepository.listFigures）
   前端 TeachingFigure.vue ─► render.ts 确定性 SVG（同 spec 同图，无随机）
                    │
                    ▼  质量闭环
   导出脚本 → Chrome headless 截 PNG → 外部视觉模型盲评（6 维判据）→ 报告 HTML
```

关键文件：

| 环节 | 文件 |
|---|---|
| 回合引擎与九道闸 | `backend/src/services/ai-teaching/teaching-turn-engine.ts:902-980` |
| 出图时机/图型路由/泄题判据/配额 | `backend/src/services/ai-teaching/teaching-visual.service.ts` |
| 归一化与图型白名单 | `backend/src/skills/teaching-turn/index.ts` |
| 确定性渲染器（前端） | `frontend/src/components/teaching-figure/render.ts` |
| 提示词源 | `prompts/core/teaching-turn.yaml`（编译产物 `prompts/skill.teaching-turn.md`） |
| 检查点节奏/判罚 | `backend/src/services/ai-teaching/checkpoint-shared.ts` 等 |
| 虚拟学习者判决 | `backend/src/skills/virtual-learner-epistemic-grounding/` |
| E2E 跑批/评审工具 | `outputs/e2e/tonight-runner.mjs`、`vision-review.mjs`、`figure-probe-batch.ts` |

---

## 二、出图决策链（当前形态）

**第一层：时机（要不要出）** —— `buildVisualOpportunity` 给出 `visualOpportunity.suggested` 与理由：
`task-structure`（任务标题本身就是结构关系）、`structure-content`（上一轮在讲结构）、
`position-description` / `time-order`（学生在文字描述空间/时序）、`ascii-structure`（模型想用字符画图）。

**第二层：形状（出哪种）** —— `chooseFigureKind` 按学科线索词典路由（顺序即优先级）：
概念结构语言（由…构成/包括几部分/两个阶段/依赖于/导致）→ `concept-map`；
曲线/图像/交点/饱和点/突跃/滴定/供需/人口… → `cartesian-plot`；
指向/引用 → `bipartite`；闭环/反馈 → `cycle`；交集 → `venn`；层级派生 → `tree`；
稳不准×准不准 → `bullseye`；数值区间 → `range-bar`；对账 → `matrix`；权衡 → `balance`；象棋 → `board`。
任务标题优先于上一轮正文，防止正文普通名词（如「需求」）抢先路由。

**第三层：九道闸（teaching-turn-engine.ts:902-980，全部代码化、逐条留痕）**

1. `detectExerciseLeakInReply` —— 本轮布置学生产出（填表/写一句/贴结果/整理成表再交…）→ 不出
2. 图文数字对账 —— 图里数字与正文完全对不上（编数）→ 不出
3. `shouldWithholdFigureForQuestion` —— 读图题/复述题（指着图说/哪一段/是多少/用你自己的话…）且图上有图元 → 不出
4. 本轮发检查点（学生要动手）→ 不出
5. `figureRestatesReply` —— 图只是把正文抄进框里（bigram 新颖度不足）→ 不出
6. 会话总量上限（默认 4，`TEACHING_FIGURE_MAX_PER_SESSION` 可覆盖）
7. 图型配额（按证据等级 A4/B4/C3/D2）
8. 同骨架去重（bigram Jaccard，对库侧已落库 spec）
9. 归一化逐字段校验（含退役图型拒绝、孤岛剪除、行复写拒绝、系列名截断）

闸门之外还有两条无条件规则：**课中图一律不挂 caption/note**（结论注是泄题高发点）、学科调色板由服务端盖章。

**图型清单**：`position-line / matrix / quadrant / bipartite / board / balance / cycle / tree / venn /
bullseye / range-bar / cartesian-plot / concept-map` 共 13 种可用；
`grid / compare / bins / ladder` 已退役（类型与渲染器保留以显示历史消息，新出图一律拒绝）。

---

## 三、质量证据

### 3.1 五轮外盲评（同一把尺：外部视觉模型 6 维判据）

| 轮次 | 干预 | 图数 | 泄题 | 多余 | 有用 | 几何 | 保留/修/删 |
|---|---|---|---|---|---|---|---|
| vis1 | 无闸门基线 | 3 | 100% | 67% | 1.67 | 1.00 | 0/1/2 |
| vis3 | 三关+领域线索+禁纯文字对照 | 7 | 29% | 86% | 1.14 | 1.00 | 0/1/6 |
| vis4 | 复述闸门+重复行拒绝 | 16 | 50% | 81% | 1.31 | 1.56 | **2**/2/12 |
| vis5 | 补泄题句式 | 17 | 24% | 94% | 1.12 | 1.12 | 0/6/11 |
| vis6 | 孤岛剪除+行标签去重+出题回合不出图 | 12 | 50% | 100% | 0.92 | 1.08 | 0/2/10 |

这轮实验的结论是**否定性的、但值钱**：泄题可以靠句式闸压下去；「多余」压不下去（67%→100%），
因为它不是措辞问题而是**时机问题**——老师已经把关系讲完的那一轮，任何配图都是把文字重排一遍。
55 张盲评里仅有的 2 张保留全部是指针指向图，且都出现在「学生必须看见关系」的题上。

### 3.2 广度扫测（12 学科案例 × 真实提示词 + 线上归一化）

| 指标 | 扩容前 | 扩容后 |
|---|---|---|
| 出图 | 4/12 | **11/12** |
| 通过归一化 | 4/12 | **11/11**（出图者全过） |
| 图型符合预期 | 5/12 | **12/12**（英语纯语法题正确地不出图） |
| 外审 | — | keep 3 / fix 7 / drop 1，有用 2.36、几何 2.73、泄 18%、多余 18% |

暴露并修复：图型线索词典不认识「图像/曲线/交点/滴定/供需/人口」这些学科说法（这是出图率低的主因，
不是模型不会画）；滴定曲线因系列名超 18 字被整条判死；只给 dotPoints 的曲线被拒；
v-t「面积=位移」这类课没有面积图元。修法：线索扩容 + 系列名放宽截断 + dotPoints 兜底 + 新增 `areas`。

读图题闸门离线核算：外审判泄题 2 张全部拦中（代价：11 张里 6 张读图轮不出图——与「只在讲解时出图」的产品口径一致）。

### 3.3 概念可视化（concept-map，8 概念卡探针）

新图型 `concept-map`：节点=概念要素（概念/过程/量/条件），边=**带名字的关系**（产生/供给/构成/依赖/导致/对照），
强制每条边有关系名、孤岛节点剪除；布局按最长路径分层、同层>4 折行、跨层/回环走独立车道、节点最后画。

8 张概念卡（生物/化学/物理/数学/地理/CS/经济/历史）真实产出 6 张概念图（2 张因通道 402/429 未出）。
渲染问题（空白/裁切/叠字）已全部修复。

**但外部盲评 0 保留 / 5 删**，两个原因都必须如实记：
1. **时机**：探针里老师讲完结构就让学生「用自己的话复述/走一遍」，图同屏即等于把复述答案摆出来——复述题闸门已拦 3/4；
2. **判据不匹配**：现行 rubric 有「去掉图学生是否一样能懂」，概念图必然与讲解重复，它的价值在「同时呈现结构」，用答案图的尺子量概念图必然判死。**概念图需要独立口径**（结构完整性/关系正确性/可读性）。

### 3.4 真课观察（4 节，虚拟学习者自动驾驶）

| 课 | 被排出的任务 | 出图 |
|---|---|---|
| 江沅×2 | 「把报告表格每列标方向」 | 0——纯文字任务，无几何，模型不出图是对的 |
| 沈禾 | 「从帧表挑行做清单」 | 模型提了 1 张图，被检查点闸拦下（学生要动手） |
| 陆原 | 「取点清单（7 张图的清单）」 | 14 条消息 0 提图——任务本身是操作流程 |

结论：**排课层从不生成「需要看见关系」的任务**，图时机自然不出现。
虚拟学习者判决每轮产出的 `blockedConcept`（本轮卡在哪个概念）目前完全不进教学回合——图只能靠猜。

---

## 四、本轮落地改动（本地提交，未推送）

| 提交 | 内容 |
|---|---|
| `8e501084` | 三道关（实体/几何/留白）、禁纯文字对照、泄题句式闸 |
| `385b2f4b` | figureRestatesReply 复述闸门 + 评审工具链 |
| `48198860` | 孤岛剪除/行标签去重/交付物泄题/提问撤图注 |
| `44bfd541` | grid 只收可比较读数（后被整体退役取代） |
| `e222f961` | 退役 grid/compare/bins/ladder，新增 cartesian-plot |
| `63e4344f` | 追问收尾不出图（后被读图题判据细化取代） |
| `03bdf448` | 图型指南同步退役（修两处指引打架） |
| `bac46777` | 广度扫测驱动：学科线索扩容、areas 面积、读图题闸门 |
| `2d511014` | 新增 concept-map（概念结构图） |
| `dafd1c3b` | 概念图回环边独立车道 |

测试：后端 756 条、前端 144 条全绿。图型指南与引擎闸门的每条规则都有对应单测。

---

## 五、已知缺口与下一步（按优先级）

1. **概念图独立评审口径**（阻塞一切概念图迭代）：现在它被答案图的尺子判死。先写 rubric——
   结构完整性（该有的要素在不在）、关系正确性（方向/名字对不对）、可读性（重叠/裁切）、
   是否含「答案性内容」——再跑一轮概念卡探针验证。
2. **真环形布局**：回馈型知识（工业革命/水循环/反馈回路）目前是「纵向链+回环车道」，能读但不是真环。
   按强连通分量排圆，边走弧线，概念图的「循环」语义才立得住。
3. **把 `blockedConcept` 接进教学回合**：虚拟学习者判决每轮都产出「卡在哪个概念」，但教学侧看不见。
   接上之后，出图时机可以从「任务标题像结构」升级为「学生此刻卡的关系可以被画出来」。
4. **任务层绑定图蓝图**（结构性的终局）：排课/任务生成时就写明「这个任务要让学生看见哪个关系、
   用哪种几何」，课堂只负责在那一刻摆出来。五轮实验的数据都指向这里——临场写图天花板 ~4%。
5. **通道与额度**：平台 key（AI_API_KEY，sk-…yjWr）已欠费（402），批量探针改走渠道 key 直连；
   渠道 key 偶发 402/429（渠道池上游问题），重试可过。充值或换 key 前后应各跑一次回归。

## 六、运维现状

- 分支 `feat/teaching-figures`（工作树 `D:/test/wenflow-figures`），12 个本地提交**未推送**；主树 3001 与主库全程未动。
- 夜间后端 3005 已停；主树 3001 存活。
- 评审/探针产物：`outputs/figure-rounds.html`（五批对比）、`outputs/breadth-review.html`（广度）、
  `outputs/concept-review.html`（概念图）、各批 `vision-review-vis*.html`。
- 密钥：平台 key 在 `backend/.env`（gitignore，从未入库）；渠道 key 只在系统临时目录（现已清理），
  全仓扫描无任何被跟踪文件包含它。
