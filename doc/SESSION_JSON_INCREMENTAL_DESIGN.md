# 会话大 JSON 列增量化改造设计（messages / logs）

> 📌 类型：设计方案（会话 messages / logs 的增量存储、读写与迁移方式）｜索引见 [doc/README.md](./README.md)。

`teaching_sessions.messages` 与 `virtual_sessions.logs` 共用「子表 + 双读 + 惰性播种」骨架：写入只追加新行，读侧先查侧表、无行时回退原 JSON 列，首次写入时把列内容搬入侧表并置 null（原地回收）。动因是整包「读全量 → parse → 追加 → 整包 stringify 写回」的写成本随会话长度线性恶化（单会话累计冗余写可达 MB 级）。

## 一、teaching_sessions.messages

### 写路径与并发约束

- 开课：`TeachingSessionRepository.reserve` → `completeInitialization` 写入初始数组。
- 每教学回合：`claimOperation`（操作租约）→ 回合基于 **claim 时的消息快照**运行 → `commitTurnState(operationId, payload.messages)` 用**回合开始快照 + 新消息**整包覆写，带 revision CAS。
- 伴学：`appendPeerMessages` 用 revision CAS 整包追加；**在途回合（operationId 非空）时拒绝写入**——`commitTurnState` 会用回合开始时快照整包覆写，此时写入会被静默覆盖丢失。

「整包覆写」是 last-write-wins 的并发语义载体：租约保证同一时刻只有一个回合在写，快照覆写天然丢弃并发期间的脏数据。改成「按行追加」后，这个语义必须由**显式的快照基线**（claim 时消息长度 / 或 operationId 隔离的增量集合）重建，否则并发窗口内伴学消息、超时补偿等路径会出现重复插入或丢消息。

### 现行方案

1. 新表 `teaching_session_messages`：`id autoincrement`、`sessionId`、`seq`（单调）、`payload JSON`（TeachingSessionMessage 原样）、`createdAt`，`@@index([sessionId, seq])`。
2. 读：仓储内统一 `侧表 ORDER BY seq`；侧表无行时回退解析 `messages` 列（双读）。
3. 写：首次追加时**惰性播种**（事务内：列 → 侧表），此后 `commitTurnState` 只 INSERT 新增消息 + 更新会话行（不再写 messages 列，列冻结）。快照基线 = 播种后侧表行数；commit 时 `payload.messages.slice(baseline)` 为增量。协议契约：claim 返回 `messagesBaseCount`，coordinator commit 回传该基线（仍携带整包消息），repo 校验基线未变（侧表 COUNT 对账）后仅落 `slice(baseCount)` 的新增消息。
4. `appendPeerMessages`：revision CAS + INSERT 行（不再整包重写）；「在途回合拒绝」语义保留。
5. 消费方（评估转录 / 管理端 teaching detail / 导出）必须全部经仓储读，直查 `messages` 列的代码清零。
6. 迁移：加表轻量；惰性播种避免 1.7GB 库一次性回填；`messages` 列在首次写入时即把列内容搬入侧表并置 null（原地回收，无需再等后续迁移清空）。

## 二、virtual_sessions.logs

### 现行方案

1. 新表 `virtual_session_logs`：`id autoincrement`、`sessionId`、`phase`（真列，统计不再 parse 全量）、`payload JSON`、`createdAt`，`@@index([sessionId, id])`。
2. 写：coordinator 追加 = INSERT（天然利用自增 id 保序）；字节预算（`services/virtual-lab/simulation-log-buffer.ts`）改为「裁最旧行」。
3. 读：双读（侧表有行用侧表，否则回退列）；管理端 5 处经统一 helper。
4. reclaim：读改写改为 INSERT 终态行；retention：对侧表会话 DELETE 行（不再是列裁剪）。
5. 惰性播种同侧；`logs` 列在首次写入时即搬入侧表并置 null（原地回收）。

## 部署前提

迁移 `20260921120000`（logs）与 `20260922110000`（messages）都需在后端停止窗口 `prisma migrate deploy`（运行中的 dev 后端持 SQLite 写锁会 `database is locked`），可与 `npm run database:vacuum` 合并同一个停机窗口执行。
