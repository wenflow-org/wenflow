# Live LLM 契约烟测

`llm-contract-smoke.ts` 用**真实上游**验证「代码形状」之外的三件事：

1. system 提示词到底有没有到达模型（折叠或原生都算通过）；
2. 多轮 history 的顺序有没有被打乱；
3. 流式、JSON 模式、`top_p` 是否被上游接受；
4. 完整 composer 链路（`callPrompt → buildMessages → gateway → prompt_call_logs`）是否可用。

`teaching-idempotency-e2e.mjs` 则走**真实产品 HTTP API**：注册新用户 → goal 对话 → 路径生成 →
开课 → 非流式/流式教学消息 → 同 `Idempotency-Key` 重放 → 同 key 异请求 409，并回读数据库核对
消息数与幂等账本。约 4–5 分钟，报告写到 `outputs/e2e-live-<本地时间>/`。

## 为什么需要它

2026-09-22 的事故是「上游静默丢弃 system、单元测试全绿」：mock 永远无法证明真实 wire
format 被遵守。本脚本是这个事故的端到端回归，也是接入新供应商/新模型时的第一道实测。

## 运行

```bash
# 只看计划，不发请求（CI 可跑）
npm --prefix backend run test:live:plan

# 真正调用上游（产生少量费用）
npm --prefix backend run test:live
npm --prefix backend run test:live -- --model=deepseek-v4.1-flash --max-tokens=32
```

要求：`backend/.env` 里 `AI_API_URL` / `AI_API_KEY` 可用，且模型已在
`backend/config/llm-providers.json` 注册。

## 成本

- 默认模型优先选注册表里最便宜的 chat 模型（当前是 `agnes-3.0-flash`）；
- 每次调用 `max_tokens ≤ 256`（默认 32），共 5 次；
- 整轮约 500–800 tokens，按当前价目远低于 $0.001。

## 判读

| 用例 | 类型 | 失败意味着 |
|---|---|---|
| `gateway.system_contract` | 硬 | system 文本没到模型（折叠/原生两条路都失效） |
| `gateway.history_secret` | 硬 | 多轮顺序或 system 记忆被破坏 |
| `gateway.stream` | 硬 | 流式请求上游不接受或聚合为空 |
| `gateway.json_and_topp` | 软 | 参数被接受但输出不是目标 JSON；上游明确不支持时记 `unsupported` |
| `composer.full_path` | 硬 | composer 链路（含 `systemPromptOverride`、遥测落库）断了 |

报告写到 `outputs/test-live-<本地时间>/REPORT.md` 与 `report.json`。

## CI

`npm --prefix backend run test:contract` 会跑 wire-format / provider 能力 / 幂等 / 初始化事务 /
冻结考卷包装测试，并执行本脚本的 **dry-run**（不花钱）。
