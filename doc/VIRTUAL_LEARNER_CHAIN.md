# 虚拟学习者链路（Source of Truth）

## 顶层模型

```
虚拟人（稳定人设 persona）
  └─ N 个故事（情境 → 当次学习需求）
        └─ 选故事启动会话
              └─ 故事需求 **传递** 进正式 Goal（开场 = conversation.description）
                    └─ Goal 收束 / handoff
                          └─ 正式 Path（只吃 Goal，不读 story，不改 Path 契约）
                                └─ Learn / 指标 / 前台投影验收

快捷支路：账号自动学习（账号已有 Path 后直接上课，不经故事/Goal）
```

## 分层与职责

| 层 | 存储 | 职责 |
|----|------|------|
| 人设 | `virtual_learner_profiles` + JSON `profile` | 稳定身份；`learningGoal` 仅=可选长期倾向 |
| 故事 | `profile.storyPool[]`（JSON） | 产生当次学习需求（`visibleOpening` / `goalSeed`） |
| 会话 | `virtual_sessions` + `stageResults.story` | 必须绑定故事；一人多故事时必须 `storyId` |
| Goal | `goal_conversations.description` | 开场诉求写入 description；正式对话收束 |
| Path | `learning_paths` | **只消费 Goal 产物**（`rawGoal`/`visibleSummary`/`history`） |
| Learn | teaching sessions + metrics | 真平台上课链路 |
| 快捷 | `virtual_quick_learn_runs` | 跳过故事/Goal，按账号已有 Path/task 自动学 |
| 投影 | projection token | 前台以虚拟账号视角验收 |

## 传递规则（故事 → Goal → Path）

解析实现：`backend/src/virtual-lab/story-demand.ts`

### 当次诉求优先级

1. `story.visibleOpening`
2. `story.goalSeed.surfaceGoal`
3. `story.goalSeed.realProblem`
4. `story.triggerEvent` / `outline`
5. `profile.learningGoal`（仅兜底，不是正规路径）

### 入口行为

| 入口 | 开场如何进 Goal |
|------|-----------------|
| Blackbox | `demand.text` 原样 → `startGoal` → `description` |
| Assisted | **`description` 固定 = `storyDemand.text`**；模拟者开场只记旁路，不改写 description |
| Path 生成 | `rawGoal` 必须来自 `conversation.description`；缺失时恢复 Goal，禁止回退读取故事 |

### 硬约束

- **不**让 Path 读 `story` / `goalSeed`
- **不**给 Path 加虚拟人特判
- 「一故事一 Path」是操作语义（经 Goal 传递），不是 Path 契约扩展

## 管理台操作流

1. 新建虚拟人：称呼 + 人物背景（人设优先；学习目标非必填）
2. 画像页生成故事（学习需求）
3. 选故事启动（辅助 / 黑盒）
4. 会话推进：Goal → Path → Learn
5. 前台投影 / 账号自动学习验收

## 快捷支路

「账号自动学习」：账号已有 Path 后，`startSession → teaching-turn → endSession → completeTask`，不经故事与 Goal。

## 残余

- 故事↔Path 仍是软关联（会话 JSON + `learningPathId`），无硬 FK
- 画像 `learningGoal` 列保留兼容，产品语义=长期倾向
