# 会话大 JSON 列增量化改造设计（messages / logs）

> 📌 类型：设计留痕（已落地）｜最后核验：2026-10-16。索引见 [doc/README.md](./README.md)。

> **状态（2026-09-22）**：两侧均已落地。
> - virtual_sessions.logs → commit 157090f4（子表 + hydrateSessionLogsField 兼容桥）
> - teaching_sessions.messages → commit e912c29f（messagesBaseCount 协议穿线 +
>   TeachingMessageBaseStaleError 基线对账 + appendPeerMessages 行追加 + revision CAS）
> **部署前提**：迁移 20260921120000（logs）与 20260922110000（messages）都需在后端
> 停止窗口 `prisma migrate deploy`（运行中的 dev 后端持 SQLite 写锁会 database is locked），
> 可与 `npm run database:vacuum` 合并同一个停机窗口执行。

> 来源：2026-09-21 全项目性能调研。teaching_sessions.messages 与 virtual_sessions.logs
> 均为「读全量 → parse → 追加 → 整包 stringify 写回」模式，单回合写成本随会话长度线性
> 恶化（simulation.coordinator.ts 注释自认单会话累计冗余写可达 MB 级）。
> 本文是动手前的设计定稿：两侧触点地图、方案、约束与建议顺序。

## 结论先行

- **先做 virtual_sessions.logs**：单写者追加型，无协议耦合，改造面收敛。
- **teaching_sessions.messages 缓一步**：调研发现「整包覆写」不是随手写的，而是当前
  并发控制机制的一部分（见下），增量化必须改操作协议契约，需要专门一批。
- 两侧共用同一套「子表 + 双读 + 惰性播种」骨架，先落的一侧把模式踩熟。

## 一、teaching_sessions.messages（热路径，暂缓）

### 现状写路径

- 开课：`TeachingSessionRepository.reserve` → `completeInitialization` 写入初始数组。
- 每教学回合：`claimOperation`（操作租约）→ 回合基于**claim 时的消息快照**运行 →
  `commitTurnState(operationId, payload.messages)` 用**回合开始快照+新消息**整包覆写，
  带 revision CAS。
- 伴学：`appendPeerMessages` 用 revision CAS 整包追加；**在途回合（operationId 非空）时
  拒绝写入**——注释明说：commitTurnState 会用回合开始时快照整包覆写，此时写入会被静默
  覆盖丢失。

### 关键约束（为什么不能只改存储）

「整包覆写」正是 last-write-wins 的并发语义载体：租约保证同一时刻只有一个回合在写，
快照覆写天然丢弃并发期间的脏数据。改成「按行追加」后，这个语义必须由**显式的快照基线**
（claim 时消息长度 / 或 operationId 隔离的增量集合）重建，否则并发窗口内伴学消息、
超时补偿等路径会出现重复插入或丢消息。

### 方案（下一批实施）

1. 新表 `teaching_session_messages`：`id autoincrement`、`sessionId`、`seq`（单调）、
   `payload JSON`（TeachingSessionMessage 原样）、`createdAt`，`@@index([sessionId, seq])`。
2. 读：仓储内统一 `侧表 ORDER BY seq`；侧表无行时回退解析 `messages` 列（双读过渡）。
3. 写：首次追加时**惰性播种**（事务内：列 → 侧表），此后 `commitTurnState` 只
   INSERT 新增消息 + 更新会话行（不再写 messages 列，列冻结）。快照基线 =
   播种后侧表行数；commit 时 `payload.messages.slice(baseline)` 为增量。
   协议契约推荐改显式：claim 返回 `messagesBaseLength`，coordinator commit 传增量数组，
   repo 校验 `baseLength` 未变（侧表 COUNT 对账）后落库。
4. `appendPeerMessages` 改为：revision CAS + INSERT 行（不再整包重写）；
   「在途回合拒绝」语义保留。
5. 消费方（评估转录/管理端 teaching detail/导出）必须全部经仓储读，直查
   `messages` 列的代码清零（实施时以 grep 验收）。
6. 迁移：加表轻量；惰性播种避免 1.7GB 库一次性回填；`messages` 列过渡期冻结保留，
   稳定后另开迁移清空（届时可再回收一大截库体积）。

## 二、virtual_sessions.logs（建议先做）

### 触点地图（2026-09-21 实测）

| 角色 | 位置 |
|---|---|
| 写 | `simulation.coordinator.ts:821-890`（addSessionLog / addSessionLogs / phase 计数，已有 appendSimulationLog 批量化防 O(n²)） |
| 写 | `virtual-lab/session-reclaim.service.ts:305`（回收时读改写列） |
| 字节预算 | `services/virtual-lab/simulation-log-buffer.ts`（写入期封顶） |
| 读 | `routes/admin/virtual-learners.ts:231、562、1921、2520、3323` |
| 读 | `simulation.coordinator.ts:1108`、`simulation.goal.steps.ts:90`（params 透传） |
| 裁剪 | `services/log-retention.service.ts`（旧会话列裁剪，冷却窗，只裁列不删行） |
| 测试 | coordinator 两个测试 mock `select.logs` 形状；session-reclaim 测试断言 `update.data.logs` |

### 方案

1. 新表 `virtual_session_logs`：`id autoincrement`、`sessionId`、`phase`（真列，统计
   不再 parse 全量）、`payload JSON`、`createdAt`，`@@index([sessionId, id])`。
2. 写：coordinator 追加 = INSERT（天然利用自增 id 保序）；字节预算改为「裁最旧行」。
3. 读：双读（侧表有行用侧表，否则回退列）；管理端 5 处经统一 helper。
4. reclaim：读改写改为 INSERT 终态行；retention：对侧表会话 DELETE 行（不再是列裁剪）。
5. 惰性播种同侧；`logs` 列过渡期冻结，后续迁移清空。

## 三、验收清单（任一侧实施时）

- [ ] grep 全仓无「直读直写原 JSON 列」的残留（仓储外零直连）
- [ ] 双读回归：旧会话（列）与新会话（侧表）在管理端/评估/续学三条路径表现一致
- [ ] 并发回归：教学回合 vs 伴学消息、reclaim vs 在途会话、retention vs 活跃会话
- [ ] 压测对账：长会话（500+ 消息/日志）单回合写延迟对比（目标：O(新增) 代替 O(全量)）
- [ ] SQLite 迁移在 dev.db（1.7GB）与生产卷上的锁窗口评估（加表迁移轻量，可在线）
