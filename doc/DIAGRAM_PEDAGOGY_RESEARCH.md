# 教学图的理论依据与证据分级

> 📌 类型：参考资料｜文献核验 2026-10-22（联网检索 + 交叉核对）｜索引见 [doc/README.md](./README.md)
> 用途：教学图（位置线/对照/阶梯/交集/矩阵等）的图型配额、提示词措辞、评审口径的**理论依据引用源**；同时登记"哪些说法只有设计经验、不能当已验证结论"。
> 关联文档：[EDUCATIONAL_THEORY_MAP.md](./EDUCATIONAL_THEORY_MAP.md)（认知负荷理论 §二⑧）、[LEARNING_SCIENCE_AUDIT.md](./LEARNING_SCIENCE_AUDIT.md)。
>
> **证据分级**
> - **A｜强**：多项独立元分析或大样本一致结论，可直接写进产品说明。
> - **B｜中**：单篇实验、窄领域元分析，或有稳定主效应但边界条件多。
> - **C｜理论/综述**：有理论框架与间接证据，缺直接实验；只能作为设计语言。
> - **D｜设计经验**：没有图型级实证；属"假设待验"，不得对外声称有效。
>
> **核验说明**：A/B 级文献均核对到"作者 + 年份 + 期刊/会议"层级；个别页码从略。标 ⚠️ 的为本次未拿到原文、仅由二次来源确认，引用时需复核。
> **本仓库实测数据**（2026-10-22，744 张真实课堂图）与文献结论分列两节，不混用。

---

## 〇、一句话结论

**「图把抽象知识变成空间直觉，所以降低认知负荷」不是已被证实的因果命题。** 被实验支持的是更窄的一条：**同一信息换一种表征，会改变推理需要多少搜索、标注与中间步骤**（表征效应）；这种便宜只在"关系的拓扑被几何真实承载"时出现，且读出关系仍依赖注意、领域知识和读图惯例。把课堂文字原样装进方框，既没有新增信息，也没有减少推理步，属于冗余而非降负荷。

因此本项目的可用判据是：**这张图在遮住文字后，几何本身是否还承载了要教的那个关系**——它是诊断启发式，不是已验证量表（见 §四）。

---

## 一、机制：图为什么可能便宜，便宜到什么程度

### 1.1 表征效应：信息等价 ≠ 计算等价（A）

- **Larkin & Simon (1987)**，*Cognitive Science* 11(1), 65–99。核心是计算效率：图按平面位置索引、把需要一起用的信息聚在一起（局部性），减少符号匹配与搜索，并让部分推理由知觉承担。原题即 "sometimes"，且只对会构造/使用该图的人成立。
- **Zhang & Norman (1994)**，*Cognitive Science* 18(1), 87–122。同一汉诺塔抽象结构换成不同外部同构表征，被试行为显著不同，提出 "representational effect"。这是"换表征改变认知操作"最直接的实验证据。
- **Stenning & Oberlander (1995)**，*Cognitive Science*。补充：图的优势还包括 "specificity"（限制抽象程度），不只是局部性。
- **Shimojima (1996)** 的 "free ride"：图可让人顺带读出未明说的信息，但这是**推理步的省略**，不是注意与认知资源为零。

### 1.2 读图是分步过程，不是瞬间感知（A）

- **Hegarty (1992)**，*JEP: LMC*；**Hegarty (2004)**，*TiCS*。从静态机械图推断运动，被试做的是分单元、分步的"心理动画"；图帮助建心理模型，但推理仍费力。
- **Ullman (1984)**，*Cognition*。空间关系知觉 = 底层并行表征 + 顶层串行 visual routines（移动注意、索引、追踪边界）。关系提取是计算过程。
- **Pinker (1990)** 的 graph comprehension 理论：读图是"概念问题 → 视觉描述 → 匹配已学 graph schema → 概念消息"。**几何不自动产生关系意义，需要被匹配到惯例。**

### 1.3 空间图式与意象图式：能解释，不能证明（C）

- **Tversky (2001, 2011)**：人自发用位置、方向、容器、路径映射抽象关系；证据是产出、偏好、跨文化一致性，不是"几何替代逻辑"的因果实验。
- **Johnson (1987)**、**Lakoff & Johnson (1980)**：container / path / balance / force / link 等意象图式。证据多为语言隐喻与启动效应的**间接**支持；未找到实验证明"遮住文字后受试者靠该图式读出关系"。可作设计语言，不可作机制依据。
- **Gentner (1983)**，*Cognitive Science*：类比迁移的是关系系统而非表面相似。对图的规范含义是——**图的拓扑必须与知识的关系结构同构；装饰性相似会诱导错误映射**（另见 Gattis & Holyoak 1996 关于轴/斜率影响速率判断）。

### 1.4 边界：几何能读出什么、读不出什么

| 能稳定读出（粗粒度、惯例化） | 读不出（需标签/图例/知识） |
|---|---|
| 顺序与相邻（时间轴、位置线） | 精确数量与控制条件 |
| 包含与层级（树、嵌套框） | 否定、析取、全称/特称 |
| 交集与互斥（Venn/Euler，需阴影或 X 标记） | 身份指称（"这条指的是哪个对象"） |
| 连接与映射（二分连线、节点-边） | 无惯例的任意语义关系 |
| 方向与循环（箭头、闭环） | 原因与结果的**具体机制** |

依据：Treisman & Gelade (1980) 支持简单特征的前注意检测，不支持任意关系的前注意读取；Oliva & Torralba (2006) 的 gist 支持场景类别与整体布局，不等于命题关系。

---

## 二、教学干预：哪些有证据

| 干预 | 代表研究 | 效应量 | 关键边界 | 等级 |
|---|---|---|---|---|
| 概念图/知识图 | Nesbit & Adesope (2006)，*RER*；Schroeder et al. (2018)，*EPR* | 总体 g≈0.55–0.58；自己构造 g≈0.72，阅读现成图 g≈0.43 | 异质性高（I²≈87%）；构造 vs 阅读、支架、先验知识影响大 | A |
| 图形组织者（LD 学生） | Dexter & Hughes (2011)，*LDQ* | 近迁移 1.07、维持 0.78、科学 1.05、数学 0.59 | 限学习障碍学生；数学效应明显小于科学 | B |
| 矩阵/对比表笔记 | Kiewra 系列（1988–1999）；Robinson & Kiewra (1995)，*JEP* | 关系、应用、整合写作优于线性提纲；**事实回忆无差异** | 效果集中在"测关系"的任务；行列排列顺序会显著影响学习 | B |
| 数轴/位置线 | Siegler & Ramani (2009)，*JEP*；Ramani & Siegler (2008)，*Child Development* | 线性数字棋盘提升数量知识；圆形棋盘无同等效果 | 迁移到算术结果混合；分数数轴游戏有零结果 | A |
| 生成性绘图 | Fiorella & Mayer (2016)，*EPR*；Leutner & Biele (2025)，*EPR* 37(1):93 | 综述 median d≈0.40；2025 元分析：有整合支持 g≈0.35，**无整合支持 g≈−0.15** | "画"本身不是有效成分；跨表征整合才是 | B |
| 多重表征 | Ainsworth (2006) DeFT；Rau (2017)，*EPR*（**综述，非元分析**） | 无合并效应量；课堂实验显示无自我解释提示时多图可能不如单图 | 表征须互补、任务须要求整合、学生须具备表征能力 | B |
| 具体化消退 | Fyfe et al. (2014)，*EPR*；Kokkonen et al. (2022)，*L&I*；Lichtenberger et al. (2024)，*JRST* | 基础数学 d≈0.76–0.83；高中物理课堂中 fading 与"同时呈现/反向"**等价** | 高级科学概念不是通用最优；具体材料须与目标结构清晰映射 | B |
| 信号化/空间邻近 | Mayer & Fiorella (2014) | signaling d≈0.41；spatial contiguity d≈1.10（22/22） | 原则有实验支持；**把原则当清单使用未经信效度检验** | A（原则）/D（清单） |

---

## 三、反面证据：什么时候图没有帮助甚至有害

| 现象 | 代表研究 | 效应量 | 对本项目的含义 |
|---|---|---|---|
| 冗余（同一信息逐字重复） | Mayer & Fiorella (2014)；Adesope & Nesbit (2012) | 图+旁白 vs 图+旁白+逐字屏显：median d≈0.86（16/16） | 把老师刚说过的句子抄进方框 = 冗余；但"部分重叠/关键词提示"可能有益，不能泛化 |
| 装饰性图形 | Sung & Mayer (2012)，*CHB* | 提高喜好，无学习收益 | 图里的装饰元素不应增加 |
| Seductive details | Rey (2012)，*ERR*；Sundararajan & Adesope (2020)，*EPR* | g≈−0.33；静态图、图文同现、置于末尾可到 ≈−0.70 | 与目标无关但"有趣"的内容要删 |
| 专家反转 | Tetzlaff et al. (2025)，*L&I*（元分析） | 新手高支架 d≈0.505，专家高支架 d≈−0.428 | 同一图对高先验知识者可能是负担；不能一刀切 |

---

## 四、评审方法：不存在"结构质量总分"

本次检索的明确结论：**没有经过心理测量学验证、专门判断"这张图是否在传递结构"的量表。** 可用的只有三层：

| 层级 | 方法 | 证据状态 | 用法 |
|---|---|---|---|
| 命题正确性 | 逐命题评分（概念图范围）：数正确"概念—连接词—概念"、有效交叉连接 | 验证过（McClure et al. 1999：六种评分法信度 r=.23–.76，逐命题最高） | 仅适用 node-link 图；不能给任意图型打分 |
| 读者任务 | task-based evaluation：遮住标签后复述/推断/迁移，记正确率与时间 | 作为评估范式有大量实证（Lam et al. 2012, *IEEE TVCG*） | 最接近"图是否传递结构"；建议做成抽样任务 |
| 设计原则 | Mayer 的 coherence / signaling / spatial contiguity | 原则层 A；**作为检查清单未验证** | 只做启发式检查，不计分 |

### 4.1 「眯眼测试」的证据边界

- 设计界常用（NN/g、LukeW 的实践说明），检验的是**视觉层级与显著性**，不是语义结构。
- 唯一相关实证是网页截图研究：Thielsch & Hirschfeld (2012) 发现低通滤波（模糊）版本与整体美学评价 r≈0.53、高通与原始评价 r≈0.76 ⚠️（来源为会议/工作论文，需复核）。
- gist 研究（Oliva & Torralba 2006）对象是自然场景，结论是"快速类别识别"，不是"命题关系读取"。
- **结论**：眯眼测试可作诊断启发式（"模糊后还能看出分组/主次吗"），**不能当通过/不通过的门槛，也不能计分**。更稳的做法是把它改成"标签移除任务"——去掉文字后让人复述关系，与 spec 的 ground truth 比对。

### 4.2 建议的评审口径

1. **标签移除任务**（主判据）：批量生成去文字版图，抽样复述"谁在谁前/谁包含谁/谁连向谁"，与 spec 对账。
2. **逐命题/关系计数**：对 node-link 类图数正确关系边；对位置线数"点位方向与区间关系"是否正确。
3. **Mayer 清单**（辅判据）：一致性、信号化、空间邻近；只记问题，不打分。
4. **明确标注**：眯眼测试与"几何承载率"均为启发式，未验证，不得写进对外材料当结论。

---

## 五、图型 × 证据分级（本仓库 15 个 kind + compare 的链路形态）

> "图型级实证"指有研究直接比较该图型 vs 文本/其他图型；"大类证据"指只能借概念图/图形组织者元分析外推。

| 图型 | 图型级实证 | 代表研究 | 等级 | 备注 |
|---|---|---|---|---|
| position-line（位置线/时间轴） | 有（数轴强、时间轴弱） | Siegler & Ramani 2009；Boroditsky 2000（时间轴方向受语言影响） | **A（数轴）/ B（时间轴）** | 本项目唯一有强证据的图型；方向惯例需按语言/读写习惯 |
| matrix（矩阵） | 有（矩阵笔记） | Kiewra et al. 1988/1991；Robinson & Kiewra 1995 | **B** | 行列顺序影响学习；适合"命中/归属"类关系 |
| grid（网格） | 有（邻近矩阵笔记，弱一级） | Kiewra 系列；Colliot et al. 2022（完整组织者优于部分） | B/C | 与 matrix 共用证据，单独实验少 |
| tree（树） | 有（领域特定：系统发育/分类） | Novick & Hurley 2001；Catley & Novick 2008；Eddy et al. 2013 | **B** | 树会暗示"单一父节点 + 排他层级"，交叉分类会误导 |
| compare（对照） | 无图型级；借对比表/矩阵证据 | Robinson & Kiewra 1995 | **C（大类 B）** | 效果取决于任务是否要求用表做关系判断；纯展示等于冗余 |
| compare.chain（链路形态） | 无 | — | **D** | 拓扑本身可读（跳数/边界），但无教学实验 |
| cycle（闭环） | 弱 | 系统图/因果环探索性研究 ⚠️ | **C** | 循环布局可能暗示"同一/不死"；线性有时更准 |
| venn（交集） | 弱（小样本、常与合作学习混淆） | Bauer & Johnson-Laird 1993；Stenning & Oberlander 1995 | **C** | 几何只给包含/交叠骨架；非空/为空需阴影或 X |
| bipartite（二分连线） | 未找到 | 可归入 node-link/概念图大类 | **D** | 概念图元分析不能直接外推；但任务可判定，适合探索 |
| bins（归类） | 未找到 | — | **D** | "分类边界"是难点时才有价值；否则等于列表 |
| ladder（阶梯） | 未找到 | — | **D** | 无连线时几何只反映步数 |
| balance（权衡） | 未找到（平衡秤是测评任务不是教学图） | Inhelder & Piaget 1958；Siegler 1976 | **D** | 隐喻直观，但无教学效果证据 |
| range-bar（区间条） | 未找到 | 条形图知觉研究可外推 | **D** | 适合"包住/不重叠"这类量级关系 |
| quadrant（象限） | 未找到 | — | **D** | 2×2 是决策工具，非学习图型 |
| bullseye（靶盘） | 未找到 | — | **D** | 同心圆有讨论结构实践，非靶盘教学证据 |
| board（棋盘） | 未找到 | — | **D** | 领域专用（棋类已被排除出测试范围） |

> 注：报告里写"16 种"是把 compare 的链路形态单独计一种；渲染器 switch 实际 14 个 kind + position-line 模板 = 15，另加 chain 子形态。

---

## 六、2023–2025 新研究（本次新增检索）

| 文献 | 出处 | 要点 | 对判断的影响 |
|---|---|---|---|
| Kim, Abel, Leutner, Schmiemann & Roelle (2025) | *Learning and Instruction* 98, 102143 | 生成性绘图 + 提取练习的整合；测 2 周与 8 周后的保持 | 把"画图"与"回忆"结合，才改善长期保持 |
| Leutner & Biele (2025) | *Educational Psychology Review* 37(1), 93；DOI 10.1007/s10648-025-10067-7 | 绘图支持的元分析："没有整合，一切皆空"——简化的支持若不要求组织/整合，反而失去绘图效应 | 支持"有效成分是整合，不是画" |
| Dechamps & Skulmowski (2025) | *Educational Psychology Review* 37, 50 | 绘图任务设计的趋势与方法学进展 | 提醒多数研究是短时实验室任务 |
| Ponce, Mayer & Méndez (2025) | *Educational Psychology Review* 37(4), 107 | 自构 vs 现成图形组织者的元分析：两者大致相当 | 削弱"必须让学生自己画"的强主张 |
| Tetzlaff et al. (2025) | *Learning and Instruction* | 专家反转元分析（d 差异≈0.97） | 同一图对高先验知识者可能有害 |
| Jaeger (2025) ⚠️ | *Learning and Instruction*（PII S104160802500007X） | "When mistakes instruct"：图中的错误如何被解释 | 图不仅传递正确结构，也会传递错误结构 |
| Lee, Chen & Liang (2025) | CHI EA '25, Article 347；DOI 10.1145/3706599.3719790 | Interactive Sketchpad：LMM 生成"代码 → 图"的辅导系统，用户可手写批注回传 | 与本项目"确定性渲染 + 学生批注"路线同构；其评估为任务理解/正确率/参与度提升 |
| Zala et al. (2024) ⚠️ | COLM 2024 | DiagrammerGPT：LLM 规划开放域图示 | 说明"LLM 规划 + 渲染器执行"是主流可行架构 |
| Ma & Zhong (2025) ⚠️ | *Journal of Computer Assisted Learning*；DOI 10.1111/jcal.70117 | 生成式 AI 教育应用元分析（34 项）：总体 g≈0.68 | 与图无关，仅作"生成式 AI 有效"的背景，不可外推到图型 |

**这些新研究改变了什么**：把"绘图/可视化有效"的重心从**产出物**移到**任务设计**——必须有组织、整合、回忆或翻译的要求；单纯提供一张图（无论多好看）不构成教学干预。

---

## 七、对本项目意味着什么（推论，不是文献结论）

### 7.1 证据支持的做法（含落地状态｜复核 2026-10-22 晚）

1. **图后一问**：每张图配一个必须用图回答的问题（排序、找反例、预测、翻译回符号）。依据：生成性学习/自我解释与 §二、§六 的"整合"结论。｜**未落地**（会改变教学回合句式，待单独验证）。
2. **图型配额按证据分级**：A/B 级（position-line、matrix、grid、tree）优先；C 级（compare、venn、cycle）须配惯例标记；D 级（balance、bins、ladder、bipartite、range-bar、quadrant、bullseye、board）标注"假设待验"，不作为已验证手段对外宣传。｜**已落地**：`figureKindCap()`，A 4 / B 4 / C 3 / D 2（`e0ad361a`）。
3. **生成前加"几何承载"闸门**：spec 里没有数值/方向/包含/连接字段的 compare/ladder/bins 不应出图。依据：§一与 §三（冗余、无计算优势）。｜**改为按等级配额**：先验算了"逐字冗余"判据，用 487 张有上下文正文的图测，只有 0.2% 的图其标签 ≥80% 逐字出现在正文里——说明"文字重排"是**改写与再排版**，不是逐字复制；逐字冗余闸门在这批数据上几乎不会触发，故未采用。
4. **评审改成标签移除任务**：§四；不再用"眯眼通过/不通过"当门槛。｜**部分落地**：已完成按 spec 字段的"几何承载"粗判（§八），标签移除截图任务未做。

### 7.2 不能声称的（负面清单）

- ❌ "图能降低认知负荷"作为既成事实——准确说法是"改变推理成本，条件成立时更省"。
- ❌ "意象图式（天平=权衡）已被实验证明"——只有理论框架与间接证据。
- ❌ "眯眼测试是验证过的评审方法"——只是设计启发式。
- ❌ "某种图型对应某类知识"是已证实的教学原则——属设计经验，缺直接实验。
- ❌ "多表征越多越好"——Rau (2017) 恰恰给出的是条件清单。

### 7.3 待验证清单（本项目自己的实验）

| 假设 | 判定指标 | 现状 |
|---|---|---|
| 几何承载的图比文字重排的图更能促成关系性回答 | 图后一问的正确率（同课对照） | 未测 |
| 标签移除后复述正确率可作为"结构质量"代理 | 与人工评审的一致性 | 未测 |
| D 级图型（平衡/阶梯/归类）在真实课里有可测收益 | 前后测迁移题 | 未测 |

---

## 八、本仓库实测数据（2026-10-22，744 张真实课堂图）

> 与文献结论分列；这些是测量结果，不是理论证据。

- 图型分布：compare 266、ladder 148、bins 124、venn 70、position-line 53、grid 23、balance 18、bipartite 15、cycle 12、matrix 7、range-bar 7、tree 1（合计 744；12 个 kind 被真实课触发）。
- 触发源：recap-cadence 292（39.2%）、task-structure 221、structure-content 175、ascii-structure 23、time-order 10、position-description 7。
- kindHint 失配：412 张带建议，80 张改了图型（19.4%）。
- 链路形态：10 张 compare.chain、47 跳，**0 跳写了 `from:"prev"`**，全部按"从客户端跨边界并联"渲染。
- 闸门实测：同图型上限触发 102 次；**会话上限 4 触发 0 次**（100+ 会话超限，最多 12 张）；**同骨架去重触发 0 次**（同会话相似度 0.55/0.60 仍渲染）。
- 几何承载粗判（按 spec 字段）：强承载 93 张（12.5%）、中等 123 张（16.5%）、弱/无 528 张（71%）。该方法为本仓库自定义启发式，未经信效度检验。
- 排版复检：7206 条 SVG 文本节点，越界 0、两两重叠 0；5 处省略号均为源文本自带。

---

## 九、参考文献

### 9.1 已核对（A/B 级）

1. Adesope, O. O., & Nesbit, J. C. (2012). Verbal redundancy in multimedia learning environments: A meta-analysis. *Journal of Educational Psychology, 104*(1), 250–263.
2. Ainsworth, S. (2006). DeFT: A conceptual framework for considering learning with multiple representations. *Learning and Instruction, 16*(3), 183–198.
3. Bauer, M. I., & Johnson-Laird, P. N. (1993). How diagrams can improve reasoning. *Psychological Science, 4*(6), 372–378.
4. Boroditsky, L. (2000). Metaphoric structuring: Understanding time through spatial metaphors. *Cognition, 75*(1), 1–28.
5. Catley, K. M., & Novick, L. R. (2008). Seeing the wood for the trees: An analysis of evolutionary diagrams in biology textbooks. *BioScience, 58*(10), 976–987.
6. Dexter, D. D., & Hughes, C. A. (2011). Graphic organizers and students with learning disabilities: A meta-analysis. *Learning Disability Quarterly, 34*(1), 51–72.
7. Fiorella, L., & Mayer, R. E. (2016). Eight ways to promote generative learning. *Educational Psychology Review, 28*(4), 717–741.
8. Fyfe, E. R., McNeil, N. M., Son, J. Y., & Goldstone, R. L. (2014). Concreteness fading in mathematics and science instruction: A systematic review. *Educational Psychology Review, 26*(1), 9–25.
9. Gentner, D. (1983). Structure-mapping: A theoretical framework for analogy. *Cognitive Science, 7*(2), 155–170.
10. Hegarty, M. (2004). Diagrams in the mind and in the world: Relations between internal and external visualizations. In *Diagrammatic Representation and Inference* (pp. 1–13). Springer.
11. Larkin, J. H., & Simon, H. A. (1987). Why a diagram is (sometimes) worth ten thousand words. *Cognitive Science, 11*(1), 65–99.
12. Mayer, R. E., & Fiorella, L. (2014). Principles for reducing extraneous processing in multimedia learning. In *The Cambridge Handbook of Multimedia Learning* (2nd ed., pp. 279–315).
13. Nesbit, J. C., & Adesope, O. O. (2006). Learning with concept and knowledge maps: A meta-analysis. *Review of Educational Research, 76*(3), 413–448.
14. Novick, L. R., & Hurley, S. M. (2001). To matrix, network, or hierarchy: That is the question. *Cognitive Psychology, 42*(2), 158–216.
15. Rau, M. A. (2017). Conditions for the effectiveness of multiple visual representations in enhancing STEM learning. *Educational Psychology Review, 29*(4), 717–761.
16. Robinson, D. H., & Kiewra, K. A. (1995). Visual argument: Graphic organizers are superior to outlines in improving learning from text. *Journal of Educational Psychology, 87*(3), 455–467.
17. Schroeder, N. L., Nesbit, J. C., Anguiano, C. J., & Adesope, O. O. (2018). Studying and constructing concept maps: A meta-analysis. *Educational Psychology Review, 30*(2), 431–455.
18. Siegler, R. S., & Ramani, G. B. (2009). Playing linear number board games—but not circular ones—improves low-income preschoolers' numerical understanding. *Journal of Educational Psychology, 101*(3), 545–560.
19. Stenning, K., & Oberlander, J. (1995). A cognitive theory of graphical and linguistic reasoning: Logic and implementation. *Cognitive Science, 19*(1), 97–140.
20. Sundararajan, N., & Adesope, O. (2020). Keep it coherent: A meta-analysis of the seductive details effect. *Educational Psychology Review, 32*(3), 707–734.
21. Tversky, B. (2011). Visualizing thought. *Topics in Cognitive Science, 3*(3), 499–535.
22. Ullman, S. (1984). Visual routines. *Cognition, 18*(1–3), 97–159.
23. Zhang, J., & Norman, D. A. (1994). Representations in distributed cognitive tasks. *Cognitive Science, 18*(1), 87–122.
24. Leutner, D., & Biele, J. (2025). Without integration everything is nothing: A meta-analysis of the effectiveness of instructional support for drawing-to-learn. *Educational Psychology Review, 37*(1), 93.
25. Kim, S., Abel, R., Leutner, D., Schmiemann, P., & Roelle, J. (2025). Can the effects of generative drawing on lasting learning be optimized through integration of retrieval practice? *Learning and Instruction, 98*, 102143.
26. Dechamps, A., & Skulmowski, A. (2025). The effective design of tasks involving learning by drawing. *Educational Psychology Review, 37*, 50.
27. Ponce, H. R., Mayer, R. E., & Méndez, E. E. (2025). Learner-generated and instructor-provided graphic organizers as aids to learning from text: A meta-analysis. *Educational Psychology Review, 37*(4), 107.
28. Tetzlaff, L., et al. (2025). A cornerstone of adaptivity: A meta-analysis of the expertise reversal effect. *Learning and Instruction*.
29. Lee, J., Chen, S.-S., & Liang, P. P. (2025). Interactive Sketchpad: A multimodal tutoring system for collaborative, visual problem-solving. *CHI EA '25*, Article 347.
30. McClure, J. R., Sonak, B., & Suen, H. K. (1999). Concept map assessment of classroom learning: Reliability, validity, and logistical practicality. *Journal of Research in Science Teaching, 36*(4), 475–492.

### 9.2 待核（⚠️ 只作线索，引用前需拿原文）

- Thielsch & Hirschfeld (2012) 的模糊/高通截图与评价相关（网页材料，非教学图）。
- Zala et al. (2024) DiagrammerGPT，COLM 2024（由二手参考文献确认）。
- Jaeger (2025) 的确切卷期与作者全名。
- 流程图教学效果的 Hooshyar / Zimmermann / Chemnitz 系列（编程入门，样本偏小）。
- 时间轴、Venn、闭环的课堂对照研究（多为多组织者混合设计）。

---

## 十、维护规范

1. 新增图型或修改图型语义时，必须在本文件 §五 登记证据等级；D 级图型不得在对外材料中声称"已验证有效"。
2. 引入新的理论引用，须登记作者/年份/期刊，并在 §一–§三 标注等级；未核实的放 §9.2。
3. 若评审口径变更（如启用标签移除任务），同步更新 §四 与本仓库评审脚本的说明。
4. 本文件是"证据账本"，不是产品规范；产品行为变更仍以提示词与代码为准，并在 PR 描述里引用本文件对应小节。
