# Prompt 缓存优化设计

- 发布：2026-09-28
- 范围：平台 LLM 调用链的 prompt 缓存架构、标准通道实测缓存率、运维配置
- 数据来源：标准通道（会话亲和型 key）真机实测，2026-09-28，goal→learn 全链路双账号对照
- 口径权威：本文缓存率一律采用 `命中 tokens / promptTokens`（下称 hit/pt），见 §3.1

## 一、背景与机制

LLM 网关侧的前缀缓存（prefix caching）按**请求消息序列的字节前缀**复用 KV 缓存：
两次请求的消息序列从第一条开始逐字节比对，公共前缀部分直接复用已算好的 KV，
不重复计算。由此推论出三条工程约束：

1. 前缀匹配是**字节级、从第一条消息开始**——序列中任何一个位置的字节不同，
   该位置之后全部作废；
2. **会话内恒定的内容必须放最前**（system），**逐回合变化的必须放最后**（最后一条
   user 消息）；
3. 缓存命中的收益是 TTFT 与上游算力，是否折算为成本节省取决于通道计价模式
   （有缓存折扣档的计价才省钱）。

## 二、平台缓存架构

平台缓存优化分两层：应用侧负责「把可缓存的组装成稳定前缀」，通道侧负责「让同类
请求落到已暖的实例上」。

### 2.1 消息组装层（应用侧）

所有 skill 调用经网关组装为如下消息序列：

```
[ system(角色+课堂/会话稳定上下文) , …history(真 message 追加式) , user(动态载荷) ]
```

要点：

- **稳定上下文前置**：会话内恒定的大块（scenario、learner 主体、任务定义，约 5K
  tokens）解析后并入 system 尾部；逐回合必变的动态块（recentEvents、latestLearnerMessage、
  state 等）只留在最后一条 user 消息（约 6K 字节）。
- **历史是真 message、追加式**：每回合只在序列尾部追加 assistant/user 两条消息，
  不重排、不改写历史——保证上回合的前缀是本回合前缀的严格前缀。
- **churn 键不进 system**：会随时变的配置键（如 promptDirectives）进入 system 会把
  当回合缓存全部打穿，收益为负，固定放载荷尾部。
- goal-conversation 的 userPayload 键序为恒定 scaffold → task → conversationContext
  （追加式）→ userInput → state（易变块全在尾部），已按上述约束字节级优化到位。

### 2.2 通道层（会话亲和）

executor 支持注入会话亲和头（`backend/.env`：`AI_CACHE_SESSION_HEADER=x-opencode-session`，
未设置时零行为变化）：

```ts
// backend/src/gateway/api-gateway/executor.ts
headers[cacheSessionHeader] = context.conversationId || context.agentId || 'wenflow-global';
```

会话键取值：

| 调用形态 | 会话键 | 效果 |
|---|---|---|
| 有会话（goal 对话、课堂） | conversationId | 同会话所有轮次粘到同一上游实例 → 轮间满命中 |
| 无会话批跑（评测、仿真） | agentId（即 skill 名） | 同 skill 批量调用共享暖前缀 |
| 兜底 | 'wenflow-global' | 极少数无身份调用 |

注意：亲和头只对支持该机制的通道有意义。**切换渠道供应商时必须按 §3 重新实测**——
不具备实例级前缀保留能力的渠道（典型：多机轮询的转售池）连字节相同的背靠背请求都
无法命中，亲和头无效。

### 2.3 前缀缓存铁律（评审清单）

改动任何 prompt 组装代码时逐条检查：

- [ ] 逐回合变化的内容是否全部位于最后一条消息？
- [ ] 会话恒定的内容是否全部位于第一条 system 消息？
- [ ] 历史是否追加式（无重排/改写/截断头部）？
- [ ] 有没有新引入的随机量（时间戳、uuid、随机排序）进入前缀？
- [ ] 发布新 prompt 版本会更换 systemPromptHash——所有进行中会话的首轮缓存会失效，
      避免在高峰期批量发布。

## 三、标准通道实测缓存率

### 3.1 口径

- 命中率 = `Σ promptCacheHitTokens / Σ promptTokens`（每调用粒度求和后相除）。
- 不变量 `promptTokens = hit + miss` 已在 09-25~09-28 共 4,157 行遥测上验证零违例，
  pt 可作为真分母；`hit/(hit+miss)` 形式在 miss 字段未上报时会把分母塌缩成 hit
  （历史上有整段时间如此，表现为恒 100% 假数），**禁止使用**。
- 判定通道是否如实上报：按天统计「有 hit 的行里 miss>0 占比」，骤降即塌缩期。

### 3.2 goal-conversation（目标规划对话）

双账号对照（A=既有账号；B=全新注册账号，跑同一 goal→learn 链路）：

| 指标 | A 账号 | B 账号（全新） |
|---|---|---|
| 调用数 | 5 轮 | 10 次调用 |
| 聚合命中率 | 71.6% | **89.8%** |
| 首轮 | 0%（通道冷启） | **97%**（8704/8930，公共前缀仍热） |
| 轮 2 起 | 每轮命中前缀 8704 tokens，TTFT 1.2-2.8s | 命中 8704~11520 tokens，TTFT 1.2-2.7s |

**解读**：

- 轮间命中的恒定 8704 tokens = 全局公共前缀（system + 通用 scaffold + task 定义），
  是跨账号、跨会话共享的；各账号自己的对话内容是逐轮新增的尾部，不参与共享——
  这是设计使然，不是损失。
- 聚合率的差异（71.6% vs 89.8%）几乎全部来自首轮：通道上有持续流量时公共前缀常热，
  新会话首轮也能命中（B）；池冷时首轮全价（A）。**稳态运营（多账号日常流量）下
  goal-conversation 的现实预期是 ~90%。**

### 3.3 teaching-turn（课堂教学回合）

| 指标 | A 账号（8 回合课） | B 账号（9 回合课） |
|---|---|---|
| 聚合命中率 | 57.7% | 58.6% |
| 首轮 | 0%（该 skill 前缀冷启） | 0% |
| 轮 2 起 | 命中 8192~13312 tokens/轮 | 命中 8192~17920 tokens/轮（轮 2 即 98%） |
| TTFT | 1.4-2.8s | 1.3-1.9s |

**解读**：teaching-turn 稳态 ~58% 是**设计内的结构上限**，不是优化欠账：单轮
prompt 中 ~44% 是必要新鲜内容（学员最新消息 + 课堂状态变更 + 动态块），这些内容
本来就不可能命中；可缓存部分（system + 稳定场景上下文 + 历史）已按 §2.1 全部前置
并实际命中。要再往上只能压缩载荷（牺牲上下文质量），不建议。

### 3.4 缓存共享模型（三层）

| 层级 | 是否共享 | 证据 |
|---|---|---|
| 会话内（同 conversationId 轮次） | ✅ 满命中 | A/B 两账号轮间 96-100% |
| 跨账号（公共前缀） | ✅ 共享 system+通用 scaffold ≈8704 tokens | B 全新账号首轮即 97%；同前缀在池冷时 0%、暖后 97% 的天然对照 |
| 跨技能 | ❌ 隔离 | B 的 teaching 首轮=0%，尽管它自己的 goal 前缀 20 分钟前刚暖过（system 不同，字节前缀不匹配） |

推论：**账号越多、流量越密，整体命中率越高**（公共前缀被暖概率上升）；多账号
不会互相「挤掉」缓存——相同前缀只叠加变热。

### 3.5 各技能预期缓存率（标准通道参考值）

| 技能形态 | 预期稳态 | 说明 |
|---|---|---|
| goal-conversation | ~90% | 公共前缀大、会话轮间满命中 |
| teaching-turn | ~58% | 必要新鲜内容占比高的结构上限 |
| 短 prompt 单发技能（adaptive-guidance-copy 等） | 0-15% | 无稳定前缀可缓存，属正常 |

## 四、运维与配置

### 4.1 配置开关

| 配置 | 位置 | 说明 |
|---|---|---|
| `AI_CACHE_SESSION_HEADER` | backend/.env | 设为通道要求的会话头名即启用亲和注入；删除或留空即关闭，无其他行为变化 |
| skill 级路由（key/endpoint） | admin → skill-model-configs | 按 skill 指定通道；路由读取**裸 skillId 行** |

### 4.2 路由配置三个坑（踩过实锤）

1. skill_model_configs 运行时路由只读**裸 skillId 行**；带 `skill:` 前缀的同名行是
   展示名，写入不生效。
2. skill 级 endpoint 必须带 scheme（`http://…`），executor 自动补 `/v1/chat/completions`；
   无 scheme 时调用报 `NETWORK_POLICY_BLOCKED「URL 格式无效」`。
3. backend/.env 新增变量需 dev 进程 respawn 一次才生效（ts-node-dev 改任一源码文件触发）。

### 4.3 遥测护栏（建议告警项）

数据源 `llm_execution_attempts`：

| 告警 | 条件 | 含义 |
|---|---|---|
| 缓存字段塌缩 | `promptCacheMissTokens=0 且 hit>0 且 pt-hit>1000` 行数突增 | 通道停止上报 miss，命中率统计将失真 |
| 输出截断（变体退化） | `finishReason='length' 且 completionTokens=该 skill maxTokens` | 通道静默更换了输出量异常的模型变体，大 JSON 技能（path-planning@12000、session-wrapup@8000）会组装失败 |
| 命中率跌破基线 | goal-conversation 日聚合 < 60% | 亲和头失效 / 通道切换未复测 / 池冷 |

## 五、边界与注意

- **首轮冷启**：每个新会话首轮无会话内前缀可命中；公共前缀在通道有持续流量时通常
  仍热（B 账号首轮 97%）。低流量时段或刚切换 key 后，首轮全价属预期。
- **发布 prompt 版本**会更换 systemPromptHash，所有进行中会话首轮缓存失效一次。
- **模型变体风险**：标准通道分组上曾观测到输出量异常的模型变体（大 JSON 技能截断），
  见 §4.3 第二条护栏；挂新 skill 路由时先跑一次 path-planning 冒烟。
- 非标准渠道（无实例级前缀保留能力的转售池）实测连相同字节请求都零命中，且命中
  是否省钱取决于计价模式——切换渠道时按 §3 重测，勿直接沿用本文数字。
