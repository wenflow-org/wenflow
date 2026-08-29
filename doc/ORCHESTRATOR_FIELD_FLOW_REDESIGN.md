# 编排结构页重构落盘（字段流转图 + 行级编辑）

> 2026-08-28 · 调查驱动重构：用户核心诉求 =「看到字段是做什么的 + 字段怎么流转的拓扑图」，其次编辑。
> 涉及前端：`Orchestrator.vue` / `FieldFlowGraph.vue`（新）· 后端：`routes/admin/field-routings.ts`。

## 1. 现状调查结论（改前）

- 页面原为 5 个视图 tab：主视图（阶段管线五卡 + 节点展开）、工作台、拓扑（运行时调用拓扑）、字段路由、沙盘/漂移。
- **「主视图」只有阶段卡片流水**：每阶段显示 ~5 个字段名字段 + Skill 只显示输出字段，没有「字段怎么流转」的可视化。
- 数据完全够用（实测 API 全通）：
  - `GET /admin/runtime-definitions/orchestrators` → 编排定义（steps 含 role/condition/loopOver/impl + variableGraph 字段分组）；
  - `GET /admin/field-routings/stages/:stage` → 阶段完整字段表（fieldId/含义/类型/promptRole/锁定/pathInRawOutput/persistKey）+ 路由行（render/handoff/internal/accumulate/visibilityPreset/notes）；
  - `GET /admin/agents/topology` → 运行时节点（调用量/成功率，与字段流转是两回事）。
- 关键限制：**handoff 只到 agent/阶段级别**，无字段名级目标（字段级精确边需后端扩 schema，本期不做）。

## 2. 改动内容

### 2.1 主视图重构为「字段流转图」（`FieldFlowGraph.vue`，新组件）

- **泳道 = 阶段**：goal / path / teaching / profile / simulation 五泳道（横向），泳道头 = 阶段名 + Agent id + 字段计数。
- **字段分组 = 产出方**：泳道内按 `skill:<id>` / `<stage>-agent`（桥接组）分组；字段即节点卡片。
- **节点卡片**：字段名（mono）+ 含义（2 行 clamp）+ 角色徽章 + 锁定/内部/累积标签；左侧色条表达语义（蓝 = 有 handoff，琥珀 = 累积，紫 = 内部信令，灰 = 隐藏）。
- **边 = handoff 去向**：字段 → 目标（阶段 / skill / agent）连线；隐藏字段虚线。
- **字段抽屉**（点节点打开）：含义 / 产出方 / 类型 / 角色（后端词表人话）/ 可见性 / 落库键 / 抽取路径 / 锁定 / 备注 / 流转去向，以及**行级编辑表单**。
- 工具栏：含隐藏字段开关 + 图例（移交/累积/内部/终点）。
- 阶段切换：主视图内点泳道头切当前阶段（`:stage="active"`）。

### 2.2 页面 tab 重组（`Orchestrator.vue`）

```
字段流转（主视图） | 拓扑 | 字段路由 | 工作台 | 沙盘 | 漂移
```

- 「主视图」→「字段流转」；字段路由 / 沙盘 / 漂移 / 工作台 全部升为页面级 tab（原主视图内的阶段展开区移除，节点/定义步骤详情收敛到字段抽屉与字段路由 tab）。
- `?tab=routing|field-routings|sandbox|drift|topology` 深链保持兼容。
- 行级编辑 / 编排文件保存后通过 `changed` 事件刷新字段流转图（`flowKey` 重挂载）。

### 2.3 行级编辑（后端 `PATCH /admin/field-routings/routings/:agentId/:fieldId`）

- **恢复**行级 PATCH（批次 D 曾退役），与编排文件编辑并存：行级编辑只允许改路由行属性
  （render / handoff / internal / accumulate / visibilityPreset / notes），不碰字段定义。
- **File-as-Truth 保持**：落库前把改动回写编排文件对应 routing 条目（逐块扫描定位，
  支持 goal-agent 桥接路由被 YAML 拆成多段的情况）；写盘前整体校验（`validateOrchestrationContent`），
  校验失败整体拒绝。
- **锁判定双通道**：路由行自身锁 + 字段定义级锁（字段 `systemLocked` → 该字段所有路由行锁定）→ 423。
- **handoff 校验**：目标必须在 manifest 或阶段名白名单内，否则 422。
- **审计**：写 `node_config_changes`（changeType=`routing-patch`，before/after 全量）。
- 前端 `adminFieldRoutingsApi.patchRouting()` 接入字段抽屉「保存修改」。

## 3. 验证记录

- 后端 tsc / 前端 vue-tsc / eslint 全绿（仅存量的 `any` warning）。
- 后端 field-routings 单测 13 例通过；前端 admin 路由测试 15 例通过；`vite build` 成功。
- 端到端（真实后端 192.168.66.24:3001，登录 admin）：
  - `PATCH goal-agent/confidenceScores {notes}` → 200，编排文件 `goal.yaml` 同步新增 `notes` 行、DB 同步、审计落库；
  - `PATCH skill:goal-conversation/understanding.surface_goal {notes}`（system-locked 字段）→ **423 拒绝**；
  - 验证后已 `git checkout` 恢复 `goal.yaml` 与 DB（重新同步回文件声明值），仓库无残留脏数据。

## 4. 后续增强（未做，按 ROI）

- **字段级精确边**：handoff 扩展到字段名级目标（需后端编排文件 schema 扩展 + `agent_field_routings` 支持），可让「surface_goal → path 的某字段」精确成边。
- 字段流转图支持跨阶段整链视图（当前为单阶段聚焦，泳道内分组）。
- 行级编辑增加「新建字段」表单（后端 `POST /fields` 亦可恢复，需补锁/审计）。

## 4.1 展示形式升级（2026-08-29，联网调研驱动）

**背景**：用户反馈首版字段流转图「非常乱」。像素级审计定位根因：① 画布无 fitView（1538px 高直接铺开）；② 折叠组锚点坐标错位（边全指向泳道头部同一错误点）；③ 字段→折叠组头放射状蜘蛛网边（8 条挤一团）；④ fitView 把整图压到 61% 字号 7px 不可读。

**调研结论**（数据血缘 Atlan/DataHub/Snowflake + Airflow 3 UX + 图可视化研究 Cockburn/iSphere/Grafana）：
- 列级血缘**绝不整图全量展示**，默认聚合视图 + 渐进披露（"Show just enough, not too much"）；
- 交互范式 = **搜索 → 定位 → 展开**（query-based exploration），聚焦时上下游高亮、其余压暗（focus+context）；
- 结构图与状态图形态分化（Airflow Grid vs Graph），不可两张图长得一样。

**落地改动**：
1. **组级视图（默认开）**：非桥接 Skill 组默认折叠为「组头 + 前 2 字段预览 + N 更多」，桥接组保持折叠；点组头 / "+N 更多" 展开该组全部字段。默认态 5 泳道 204-736px（原 1464px 减半），6 条主干聚合边。
2. **搜索定位**：工具栏搜索框输入字段 / Skill / 描述 → 自动展开命中组 + 聚焦高亮（`focusId`），清空恢复。
3. **聚焦高亮（focus+context）**：聚焦字段上下游 1 跳（handoff 目标精确匹配 + 阶段级匹配）高亮，其余 35% 透明度压暗——「影响分析」视角一眼可见（实测 `learnerState` 聚焦 → 22 个相关字段）。
4. **字段卡瘦身**：去掉卡上「锁/内/累/角色」多标签，只留名字 + 角色色点 + 去向 chip，详情进抽屉（title 保留完整信息）。
5. **布局引擎**：`fieldFlowLayout.ts` 新增 `groupsCollapsed` 参数（第 4 参，默认关闭），折叠组保留 `PREVIEW_N=2` 预览字段、组尾预留 "+N" 按钮空间；`Topology.vue` 不传（运行时视图保持全字段）。
6. **修复**：组容器显式高度（30 + N*42 + 按钮区），杜绝预览字段溢出压到下一组；预览/完整字段渲染互斥（v-show）避免同名字段重叠。

**验证**：像素审计 0 重叠 / 0 边穿卡 / 0 按钮越界；交互链路（默认→展开→搜索→聚焦→清除）全通、无控制台错误；vue-tsc / eslint / build / 15 路由测试全绿；视觉模型 8.7/10（"非常干净、无重叠错位、层次感强"）。

## 4.2 tab 结构重组（2026-08-29，信息架构驱动）

**背景**：原 6 个平铺 tab（字段流转 / 拓扑 / 字段路由 / 工作台 / 沙盘 / 漂移）违背图可视化与编排工具的信息架构惯例——浏览型与编辑型平级、同一画布的两个状态拆成两个 tab、治理与主图混排。子代理调研（Airflow/Dagster/DataHub/Atlan/LangSmith/n8n + Prefect #18142 反面案例）确认：

- 结构（定义）与运行（实例）应在**同一画布叠加**，而非两个 tab；
- **编辑型功能不与浏览型平铺**（LangSmith 拆 Playground/Prompts 为顶级页；Dify 拆分日志/监测）；
- **治理/审计独立成 tab**（DataHub 新增 Governance tab；Airflow Audit Log）；
- 沙盘/测试是**独立工作流**（LangSmith Datasets 顶级页）。

**新结构（核心 = 浏览 + 编辑）：**

```
主 tab：  [ 浏览 ]  [ 编辑 ]
          │         ├─ 字段路由（表格 + 编排文件编辑）
          │         └─ 治理折叠区：漂移报告 + 变更审计（?tab=drift 自动展开）
          │
浏览内画布级切换（非 tab，不丢缩放/平移上下文）：
  [ 字段流转 ]  [ 拓扑 ]   ← segmented control
  ├─ 字段流转 = FieldFlowGraph（结构，默认）
  └─ 拓扑     = Topology（运行时叠加，时间范围/图层）

沙盘（?tab=sandbox / 次要入口）：独立 pane，顶部带「返回浏览」
工作台：移出编排页（独立页面 /admin/skill-workbench）
```

**归属与依据**：
1. **拓扑并入浏览画布内切换**：同一张图叠加运行时状态（Airflow run 选择器 / Alation metadata layer），切换不丢画布上下文；
2. **字段路由 + 漂移并入编辑**：编辑（改路由）→ 治理（查漂移/审计）是同一闭环的写读两端；
3. **沙盘独立 pane（深链）**：契约对照是独立工作流，不占主 tab；
4. **工作台移出**：与独立页 `/admin/skill-workbench` 重复，收敛为单一入口；
5. 深链兼容：`?tab=topology`→浏览+拓扑、`?tab=field-routings|routing`→编辑、`?tab=drift`→编辑+治理展开、`?tab=sandbox`→沙盘 pane。

**验证**：10 场景浏览器实测（默认/切拓扑/切回/编辑/治理展开/4 深链/沙盘返回）全通、无控制台错误；vue-tsc / eslint / build / 15 路由测试全绿；视觉模型 浏览 9/10、编辑 8.5/10（"主 tab 非常分明，定位明确"）。

## 4.3 阶段聚焦模式（2026-08-29，focus+context 落地）

**需求**：用户提出「按阶段来，每阶段展示上下游即可」——一次只看一个阶段，上下游收敛到它的直接输入/输出（血缘产品 focus+context 范式）。

**实现**（`FieldFlowGraph.vue`）：
1. **聚焦模式（默认）**：只渲染当前阶段单泳道 + 左右锚点列：
   - 左列「↑ 上游输入」：其他阶段中 **handoff 指向当前阶段**的字段（**精确到字段级**，弥补 agent 级 handoff 的信息粒度）；
   - 右列「↓ 下游输出」：当前阶段字段 handoff 出去的目标 agent（agent 级，按目标阶段去重）；
   - 泳道右移让出左列（`cur.x = ANCHOR_X0 + ANCHOR_W + ANCHOR_GAP`），画布宽 = 两列 + 泳道。
2. **阶段选择器**（工具栏）：5 阶段分段按钮切换，`emit('stage')` 同步父级 active（字段路由/编辑联动同阶段）。
3. **跨列边**：上游字段 → 当前阶段目标组（蓝色实线）；当前字段/折叠组头 → 下游锚点（灰蓝虚线）。折叠桥接组也出聚合边（组头右缘 → 下游）。
4. **锚点跳转**：点上游字段锚点 → 切到来源阶段 + 聚焦该字段 + 滚动定位；点下游锚点 → 切到目标阶段。
5. **搜索跨阶段**：命中字段不在当前阶段时自动切阶段。
6. **全览开关**：保留 5 泳道全览模式（工具栏「全览」checkbox），切换不丢聚焦阶段。
7. **深链**：`?stage=xxx` 落位对应阶段聚焦。

**验证**：goal（无上游、下游 path 锚点 + 折叠组聚合边）/ teaching（6 上游 + 1 下游 + 8 边）/ 仿真（终点无上下游）均正确；全览 ↔ 聚焦切换正常；无控制台错误；eslint / build / 15 路由测试全绿。顺带恢复被误删的 `Devtools/Admins/ExportData/Settings.vue`（build 依赖）。

## 5. 相关文件

| 文件 | 说明 |
|---|---|
| `frontend/src/views/admin-redesign/FieldFlowGraph.vue` | 新增：字段流转图 + 字段抽屉 + 行级编辑 |
| `frontend/src/views/admin-redesign/Orchestrator.vue` | 主视图重构为字段流转图，tab 重组 |
| `frontend/src/views/admin-redesign/fieldFlowLayout.ts` | 共享布局模块（新增，含组级折叠/PREVIEW_N） |
| `frontend/src/api/adminApi.ts` | 新增 `patchRouting` |
| `backend/src/routes/admin/field-routings.ts` | 恢复 `PATCH /routings/:agentId/:fieldId`（锁/审计/回写编排文件） |
