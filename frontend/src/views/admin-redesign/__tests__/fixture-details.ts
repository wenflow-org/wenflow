// 运行时真实数据快照（work/orch-probe/stage-details.json 提取，仅字段路由矩阵）
// 注：字段定义/契约行做了必要精简，routings 为全量；结构与 GET /stages/:stage 一致
import type { StageDetailLike } from '../fieldFlowLayout'
export const fixtureDetails: Record<string, StageDetailLike> = {
  "goal": {
    "stage": "goal",
    "fields": [
      {
        "fieldId": "confidenceScores",
        "valueType": "object",
        "promptRole": "control-signal",
        "description": "分项置信度评分（每轮产出）",
        "pathInRawOutput": "internal.ext.goalConversation.confidenceScores",
        "persistKey": null
      },
      {
        "fieldId": "core.confidence",
        "valueType": "number",
        "promptRole": "control-signal",
        "description": "收敛置信度",
        "pathInRawOutput": "internal.core.confidence",
        "persistKey": null
      },
      {
        "fieldId": "core.conversationId",
        "valueType": "string",
        "promptRole": "control-signal",
        "description": "对话 ID",
        "pathInRawOutput": "internal.core.conversationId",
        "persistKey": null
      },
      {
        "fieldId": "core.isCompleted",
        "valueType": "boolean",
        "promptRole": "control-signal",
        "description": "对话是否完成",
        "pathInRawOutput": "internal.core.isCompleted",
        "persistKey": null
      },
      {
        "fieldId": "core.stage",
        "valueType": "string",
        "promptRole": "control-signal",
        "description": "对话阶段",
        "pathInRawOutput": "internal.core.stage",
        "persistKey": null
      },
      {
        "fieldId": "understanding.available_resources.time_budget",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "时间预算（几周/几月）",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.available_resources.time_budget",
        "persistKey": null
      },
      {
        "fieldId": "understanding.real_problem",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "深层真实问题（回溯后收敛）",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.real_problem",
        "persistKey": null
      },
      {
        "fieldId": "understanding.success_criteria.observable_result",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "学习成功的可观察结果",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.success_criteria.observable_result",
        "persistKey": null
      },
      {
        "fieldId": "understanding.surface_goal",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "用户最初表述的\"想学什么\"原话",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.surface_goal",
        "persistKey": "surfaceGoal"
      },
      {
        "fieldId": "understanding.background_experience",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "背景经验推断（prompt 明确不展示给前端）",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.background_experience",
        "persistKey": null
      },
      {
        "fieldId": "understanding.cognitive_bandwidth",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "认知带宽推断（可选 hidden，core yaml 已声明）",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.cognitive_bandwidth",
        "persistKey": null
      },
      {
        "fieldId": "understanding.learning_signal",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "学习信号（隐式推断）",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.learning_signal",
        "persistKey": null
      },
      {
        "fieldId": "confirmedProposal.first_deliverable",
        "valueType": "string",
        "promptRole": "proposal-output",
        "description": "第一个交付物",
        "pathInRawOutput": "internal.ext.goalConversation.confirmedProposal.first_deliverable",
        "persistKey": null
      },
      {
        "fieldId": "confirmedProposal.key_stages",
        "valueType": "array<string>",
        "promptRole": "proposal-output",
        "description": "关键阶段",
        "pathInRawOutput": "internal.ext.goalConversation.confirmedProposal.key_stages",
        "persistKey": null
      },
      {
        "fieldId": "confirmedProposal.learning_direction",
        "valueType": "string",
        "promptRole": "proposal-output",
        "description": "确认的学习方向",
        "pathInRawOutput": "internal.ext.goalConversation.confirmedProposal.learning_direction",
        "persistKey": null
      },
      {
        "fieldId": "confirmedProposal.out_of_scope",
        "valueType": "array<string>",
        "promptRole": "proposal-output",
        "description": "不在此次学习的范围",
        "pathInRawOutput": "internal.ext.goalConversation.confirmedProposal.out_of_scope",
        "persistKey": null
      },
      {
        "fieldId": "goalConversation.nextQuestions",
        "valueType": "array<string>",
        "promptRole": "public-reply",
        "description": "下一轮建议问题",
        "pathInRawOutput": "internal.ext.goalConversation.nextQuestions",
        "persistKey": null
      },
      {
        "fieldId": "goalConversation.quickReplies",
        "valueType": "array<string>",
        "promptRole": "public-reply",
        "description": "快捷回复选项",
        "pathInRawOutput": "internal.ext.goalConversation.quickReplies",
        "persistKey": null
      },
      {
        "fieldId": "userVisible",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "给用户看的内容（适合 LLM 聊天 UI）",
        "pathInRawOutput": "userVisible",
        "persistKey": null
      },
      {
        "fieldId": "structuredData",
        "valueType": "object",
        "promptRole": "soft-info",
        "description": "结构化画像旁路字段（learner.identity/learning_context 等）",
        "pathInRawOutput": "internal.ext.goalConversation.structuredData",
        "persistKey": null
      },
      {
        "fieldId": "understanding.available_resources.time_horizon",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "时间视角（紧迫 vs 从容）",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.available_resources.time_horizon",
        "persistKey": null
      },
      {
        "fieldId": "understanding.available_resources.time_per_session",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "每次学习时长",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.available_resources.time_per_session",
        "persistKey": null
      },
      {
        "fieldId": "understanding.constraints_and_boundaries",
        "valueType": "array<string>",
        "promptRole": "soft-info",
        "description": "约束与边界",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.constraints_and_boundaries",
        "persistKey": null
      },
      {
        "fieldId": "understanding.current_baseline.evidence",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "当前水平的证据",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.current_baseline.evidence",
        "persistKey": null
      },
      {
        "fieldId": "understanding.current_baseline.level",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "当前水平评估",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.current_baseline.level",
        "persistKey": null
      },
      {
        "fieldId": "understanding.deadline_text",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "截止日期文本",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.deadline_text",
        "persistKey": null
      },
      {
        "fieldId": "understanding.motivation",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "学习动机",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.motivation",
        "persistKey": null
      },
      {
        "fieldId": "understanding.pain_points",
        "valueType": "array<string>",
        "promptRole": "soft-info",
        "description": "当前痛点",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.pain_points",
        "persistKey": null
      },
      {
        "fieldId": "understanding.scenario",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "学习场景",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.scenario",
        "persistKey": null
      },
      {
        "fieldId": "understanding.success_criteria.acceptance_check",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "验收检查方法",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.success_criteria.acceptance_check",
        "persistKey": null
      },
      {
        "fieldId": "understanding.urgency",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "紧急程度",
        "pathInRawOutput": "internal.ext.goalConversation.understanding.urgency",
        "persistKey": null
      }
    ],
    "agents": [
      {
        "agentId": "goal-agent",
        "description": "收集学习目标与上下文，输出 Goal Understanding"
      },
      {
        "agentId": "skill:goal-conversation",
        "description": "与学习者多轮对话，收集学习目标"
      }
    ],
    "routings": [
      {
        "agentId": "goal-agent",
        "fieldId": "confidenceScores",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "confirmedProposal.first_deliverable",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "confirmedProposal.key_stages",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "confirmedProposal.learning_direction",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "confirmedProposal.out_of_scope",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "structuredData",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.available_resources.time_budget",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.available_resources.time_horizon",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.available_resources.time_per_session",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.background_experience",
        "render": "hidden",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.cognitive_bandwidth",
        "render": "hidden",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.constraints_and_boundaries",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.current_baseline.evidence",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.current_baseline.level",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.deadline_text",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.learning_signal",
        "render": "hidden",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.motivation",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.pain_points",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.real_problem",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": "path description 的最终兜底"
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.scenario",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.success_criteria.acceptance_check",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.success_criteria.observable_result",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.surface_goal",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "goal-agent",
        "fieldId": "understanding.urgency",
        "render": "visible",
        "handoff": [
          "path"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "confidenceScores",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "confirmedProposal.first_deliverable",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "confirmedProposal.key_stages",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "confirmedProposal.learning_direction",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "confirmedProposal.out_of_scope",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "core.confidence",
        "render": "visible",
        "handoff": [],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "internal — 仅作 UI 进度条"
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "core.conversationId",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "core.isCompleted",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "core.stage",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "goalConversation.nextQuestions",
        "render": "visible",
        "handoff": [],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "goalConversation.quickReplies",
        "render": "visible",
        "handoff": [],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "structuredData",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.available_resources.time_budget",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.available_resources.time_horizon",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.available_resources.time_per_session",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.background_experience",
        "render": "hidden",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.cognitive_bandwidth",
        "render": "hidden",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.constraints_and_boundaries",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.current_baseline.evidence",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.current_baseline.level",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.deadline_text",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.learning_signal",
        "render": "hidden",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.motivation",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.pain_points",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.real_problem",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.scenario",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.success_criteria.acceptance_check",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.success_criteria.observable_result",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.surface_goal",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "understanding.urgency",
        "render": "visible",
        "handoff": [
          "goal-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:goal-conversation",
        "fieldId": "userVisible",
        "render": "visible",
        "handoff": [],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      }
    ]
  },
  "path": {
    "stage": "path",
    "fields": [
      {
        "fieldId": "path.id",
        "valueType": "string",
        "promptRole": "control-signal",
        "description": "路径 ID",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "path.totalMilestones",
        "valueType": "number",
        "promptRole": "derived-presentation",
        "description": "milestone 总数",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "previousMilestone",
        "valueType": "object",
        "promptRole": "derived-presentation",
        "description": "前一里程碑上下文（title/coreConcept），consolidate 回捞输入；首阶段不注入",
        "pathInRawOutput": "previousMilestone",
        "persistKey": null
      },
      {
        "fieldId": "milestones.goal",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "阶段目标",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "milestones.stageNumber",
        "valueType": "number",
        "promptRole": "hard-required",
        "description": "阶段编号",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "milestones.title",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "阶段标题",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.problemSpace.realProblem",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "真实问题（清洗）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.resources.timeBudget",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "时间预算",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.successCriteria.observableResult",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "可观察结果",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "subtasks.title",
        "valueType": "string",
        "promptRole": "hard-required",
        "description": "子任务标题",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.planningHints.conceptRange",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "推断的 concept 数量范围",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.planningHints.maxWeeks",
        "valueType": "number",
        "promptRole": "hidden-inference",
        "description": "推断的最大周数",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.planningHints.milestoneRange",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "推断的 milestone 数量范围",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.planningHints.paceSignal",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "推断的学习节奏信号",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.planningHints.subtaskMinutesRange",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "推断的 subtask 分钟数范围",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.planningHints.subtasksPerStageRange",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "推断的每阶段 subtask 数量范围",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.confirmedProposal.firstDeliverable",
        "valueType": "string",
        "promptRole": "proposal-output",
        "description": "确认的第一交付物",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.confirmedProposal.keyStages",
        "valueType": "string",
        "promptRole": "proposal-output",
        "description": "确认的关键阶段",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "path.name",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "路径名称",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "path.summary",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "路径摘要",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "cognitiveCore.cognitiveDomain",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "认知领域归类",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "cognitiveCore.coreConcepts",
        "valueType": "array<object>",
        "promptRole": "soft-info",
        "description": "核心概念列表",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "milestones.coreConcept",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "阶段核心概念",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "milestones.estimatedHours",
        "valueType": "number",
        "promptRole": "soft-info",
        "description": "阶段估时（小时）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.learnerProfile.backgroundExperience",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "学习者背景经验（清洗）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.learnerProfile.constraintsAndBoundaries",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "学习者约束与边界（清洗）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.problemSpace.currentPainPoint",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "当前痛点（清洗）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.problemSpace.scenario",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "学习场景（清洗）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "normalizedInput.resources.timeBudgetCadence",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "时间预算节奏",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "subtasks.acceptanceCriteria",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "验收标准（skill 实际产出键为 acceptanceHint，落库时映射为 subtasks.acceptanceCriteria）",
        "pathInRawOutput": null,
        "persistKey": "acceptanceHint"
      },
      {
        "fieldId": "subtasks.cognitiveLevel",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "认知层次（Bloom 等级）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "subtasks.estimatedMinutes",
        "valueType": "number",
        "promptRole": "soft-info",
        "description": "子任务估时（分钟）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "subtasks.knowledgeType",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "知识类型（factual / conceptual / procedural / metacognitive）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "subtasks.linkedConcept",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "关联的认知概念",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "subtasks.transferable",
        "valueType": "boolean",
        "promptRole": "soft-info",
        "description": "是否可迁移",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "subtasks.type",
        "valueType": "string",
        "promptRole": "soft-info",
        "description": "子任务类型（learn / practice / verify）",
        "pathInRawOutput": null,
        "persistKey": null
      }
    ],
    "agents": [
      {
        "agentId": "path-agent",
        "description": "规划学习路径与阶段拆分"
      },
      {
        "agentId": "skill:path-planning",
        "description": "生成学习路径主结构"
      },
      {
        "agentId": "skill:stage-designer",
        "description": "细化阶段内的任务与验收点"
      }
    ],
    "routings": [
      {
        "agentId": "path-agent",
        "fieldId": "milestones.goal",
        "render": "visible",
        "handoff": [
          "teaching"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "path-agent",
        "fieldId": "milestones.title",
        "render": "visible",
        "handoff": [
          "teaching"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.confirmedProposal.firstDeliverable",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.confirmedProposal.keyStages",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.learnerProfile.backgroundExperience",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.learnerProfile.constraintsAndBoundaries",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.planningHints.conceptRange",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.planningHints.maxWeeks",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.planningHints.milestoneRange",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.planningHints.paceSignal",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.planningHints.subtaskMinutesRange",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.planningHints.subtasksPerStageRange",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.problemSpace.currentPainPoint",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.problemSpace.realProblem",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.problemSpace.scenario",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.resources.timeBudget",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.resources.timeBudgetCadence",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "normalizedInput.successCriteria.observableResult",
        "render": "hidden",
        "handoff": [
          "skill:path-planning",
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": "确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "path.name",
        "render": "visible",
        "handoff": [
          "teaching"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "path-agent",
        "fieldId": "path.summary",
        "render": "visible",
        "handoff": [
          "teaching"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "path-agent",
        "fieldId": "previousMilestone",
        "render": "hidden",
        "handoff": [
          "skill:stage-designer"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "loopOver 编排注入（前一 milestone 上下文），非 LLM 输出"
      },
      {
        "agentId": "path-agent",
        "fieldId": "subtasks.acceptanceCriteria",
        "render": "visible",
        "handoff": [
          "teaching"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "path-agent",
        "fieldId": "subtasks.title",
        "render": "visible",
        "handoff": [
          "teaching"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "cognitiveCore.cognitiveDomain",
        "render": "visible",
        "handoff": [
          "path-agent",
          "skill:stage-designer"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "cognitiveCore.coreConcepts",
        "render": "visible",
        "handoff": [
          "path-agent",
          "skill:stage-designer"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "milestones.coreConcept",
        "render": "visible",
        "handoff": [
          "skill:stage-designer",
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "milestones.estimatedHours",
        "render": "visible",
        "handoff": [
          "skill:stage-designer",
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "milestones.goal",
        "render": "visible",
        "handoff": [
          "skill:stage-designer",
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "milestones.stageNumber",
        "render": "visible",
        "handoff": [
          "skill:stage-designer",
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "milestones.title",
        "render": "visible",
        "handoff": [
          "skill:stage-designer",
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "path.id",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "path.name",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "path.summary",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:path-planning",
        "fieldId": "path.totalMilestones",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:stage-designer",
        "fieldId": "subtasks.acceptanceCriteria",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:stage-designer",
        "fieldId": "subtasks.cognitiveLevel",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:stage-designer",
        "fieldId": "subtasks.estimatedMinutes",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:stage-designer",
        "fieldId": "subtasks.knowledgeType",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:stage-designer",
        "fieldId": "subtasks.linkedConcept",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:stage-designer",
        "fieldId": "subtasks.title",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "skill:stage-designer",
        "fieldId": "subtasks.transferable",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:stage-designer",
        "fieldId": "subtasks.type",
        "render": "visible",
        "handoff": [
          "path-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      }
    ]
  },
  "teaching": {
    "stage": "teaching",
    "fields": [
      {
        "fieldId": "control.checkpoint",
        "valueType": "object",
        "promptRole": "control-signal",
        "description": "检查点（question/type/options/hint），间隔满足时可选输出",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "control.isCompletionCandidate",
        "valueType": "boolean",
        "promptRole": "control-signal",
        "description": "是否触发 task 完成判定",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "control.shouldTriggerPeer",
        "valueType": "boolean",
        "promptRole": "control-signal",
        "description": "是否触发伴学回合",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "knowledge.currentPoint",
        "valueType": "string",
        "promptRole": "derived-presentation",
        "description": "当前知识点",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "knowledge.points",
        "valueType": "array<object>",
        "promptRole": "derived-presentation",
        "description": "本轮涉及的知识点状态列表",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.knowledgeItems",
        "valueType": "array<object>",
        "promptRole": "derived-presentation",
        "description": "本次会话知识点列表（name/status/progress/evidence）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.metricInterpretation",
        "valueType": "object",
        "promptRole": "derived-presentation",
        "description": "本节/长期指标解读",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.summaryVersion",
        "valueType": "string",
        "promptRole": "derived-presentation",
        "description": "summary 结构版本（固定 v2）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "analysis.cognitiveLevel",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "学习者认知层级（Bloom 等级）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "analysis.confusionPoints",
        "valueType": "array<string>",
        "promptRole": "hidden-inference",
        "description": "本轮检测到的困惑点",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "analysis.emotionalState",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "情绪状态推断",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "analysis.engagement",
        "valueType": "number",
        "promptRole": "hidden-inference",
        "description": "本轮参与度 0-1",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "analysis.levelScore",
        "valueType": "number",
        "promptRole": "hidden-inference",
        "description": "认知层级量化分数",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "analysis.understanding",
        "valueType": "number",
        "promptRole": "hidden-inference",
        "description": "本轮理解程度 0-1",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "control.completionCandidateEvidence",
        "valueType": "object",
        "promptRole": "hidden-inference",
        "description": "完成候选的内部证据（供编排层门禁，不面向前端）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "evaluation.confidence",
        "valueType": "number",
        "promptRole": "hidden-inference",
        "description": "本次评估的置信度",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "evaluation.reasoning",
        "valueType": "string",
        "promptRole": "hidden-inference",
        "description": "评估依据（引用 1-2 个关键证据）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "evaluation.sessionKtl",
        "valueType": "number",
        "promptRole": "hidden-inference",
        "description": "本次会话 KTL（知识获得质量，8-10 好）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "evaluation.sessionLf",
        "valueType": "number",
        "promptRole": "hidden-inference",
        "description": "本次会话 LF（疲劳负担，8-10 高疲劳）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "evaluation.sessionLss",
        "valueType": "number",
        "promptRole": "hidden-inference",
        "description": "本次会话 LSS（学习压力评分，8-10 高压力）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "pedagogy.strategies",
        "valueType": "array<string>",
        "promptRole": "hidden-inference",
        "description": "使用的教学策略",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "emptyStateCopy",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "空态文案",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "followUpQuestions",
        "valueType": "array<string>",
        "promptRole": "public-reply",
        "description": "伴学后续追问",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "headline",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "引导文案主标题",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "message",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "伴学补强的对话回复",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "nextStep",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "下一步建议",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "paceHint",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "节奏相关提示",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "pathHint",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "路径相关提示",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "reply",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "教学回合的对话回复（落库为消息正文）",
        "pathInRawOutput": null,
        "persistKey": "messages[].content"
      },
      {
        "fieldId": "subtitle",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "引导文案副标题",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.actionPlan",
        "valueType": "array<string>",
        "promptRole": "public-reply",
        "description": "行动列表（含检索式自测）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.evaluationHighlights",
        "valueType": "object",
        "promptRole": "public-reply",
        "description": "亮点与改进（strengths/improvements）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.keyTakeaways",
        "valueType": "array<string>",
        "promptRole": "public-reply",
        "description": "收获列表",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.knowledgeSummary",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "本次会话知识点总结",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.learningEvaluation",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "学习评估文本",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.practiceAdvice",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "练习建议",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "summary.topicSummary",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "本次会话主题总结",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "todayActions",
        "valueType": "array<object>",
        "promptRole": "public-reply",
        "description": "今日行动列表（label/to）",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "warningCopy",
        "valueType": "string",
        "promptRole": "public-reply",
        "description": "预警文案",
        "pathInRawOutput": null,
        "persistKey": null
      },
      {
        "fieldId": "classroomContext",
        "valueType": "object",
        "promptRole": "soft-info",
        "description": "课堂上下文（上轮持久化）",
        "pathInRawOutput": "teachingState.classroomContext",
        "persistKey": null
      },
      {
        "fieldId": "controls.teachingControlContext",
        "valueType": "object",
        "promptRole": "soft-info",
        "description": "教学控制上下文（priority/allow* 标志）",
        "pathInRawOutput": "teachingState.teachingControlContext",
        "persistKey": null
      },
      {
        "fieldId": "knowledge.state",
        "valueType": "object",
        "promptRole": "soft-info",
        "description": "知识看板当前状态（points/currentPoint）",
        "pathInRawOutput": "session.knowledgeState",
        "persistKey": null
      },
      {
        "fieldId": "learner.learnerProjection",
        "valueType": "object",
        "promptRole": "soft-info",
        "description": "学习者教学投影（toTeachingProjection）",
        "pathInRawOutput": "context.learnerProjection",
        "persistKey": null
      },
      {
        "fieldId": "visibleDialogueContext",
        "valueType": "array<object>",
        "promptRole": "soft-info",
        "description": "最近可见对话（role/content）",
        "pathInRawOutput": "session.messages",
        "persistKey": null
      }
    ],
    "agents": [
      {
        "agentId": "skill:peer-reinforcement",
        "description": "同伴式引导讨论与理解补强"
      },
      {
        "agentId": "teaching-agent",
        "description": "AI 教学会话编排：单轮教学、伴学补强、课后产出"
      },
      {
        "agentId": "skill:teaching-turn",
        "description": "生成单轮教学回复与结构化教学状态"
      },
      {
        "agentId": "skill:adaptive-guidance-copy",
        "description": "根据情境生成自适应引导话术"
      },
      {
        "agentId": "skill:session-wrapup",
        "description": "生成课后总结与评估"
      }
    ],
    "routings": [
      {
        "agentId": "skill:adaptive-guidance-copy",
        "fieldId": "emptyStateCopy",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:adaptive-guidance-copy",
        "fieldId": "headline",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:adaptive-guidance-copy",
        "fieldId": "nextStep",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:adaptive-guidance-copy",
        "fieldId": "paceHint",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:adaptive-guidance-copy",
        "fieldId": "pathHint",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:adaptive-guidance-copy",
        "fieldId": "subtitle",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:adaptive-guidance-copy",
        "fieldId": "todayActions",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:adaptive-guidance-copy",
        "fieldId": "warningCopy",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:peer-reinforcement",
        "fieldId": "followUpQuestions",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:peer-reinforcement",
        "fieldId": "message",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "evaluation.confidence",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "evaluation.reasoning",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "evaluation.sessionKtl",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "evaluation.sessionLf",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "evaluation.sessionLss",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.actionPlan",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.evaluationHighlights",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.keyTakeaways",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.knowledgeItems",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.knowledgeSummary",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.learningEvaluation",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.metricInterpretation",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.practiceAdvice",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.summaryVersion",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:session-wrapup",
        "fieldId": "summary.topicSummary",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "analysis.cognitiveLevel",
        "render": "hidden",
        "handoff": [
          "teaching-agent",
          "skill:peer-reinforcement"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "analysis.confusionPoints",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "analysis.emotionalState",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "analysis.engagement",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "analysis.levelScore",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "analysis.understanding",
        "render": "hidden",
        "handoff": [
          "teaching-agent",
          "skill:peer-reinforcement"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "control.checkpoint",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "可选输出：满足间隔时才产生"
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "control.completionCandidateEvidence",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "编排层门禁内部证据，不面向前端"
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "control.isCompletionCandidate",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "control.shouldTriggerPeer",
        "render": "visible",
        "handoff": [
          "skill:peer-reinforcement",
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "触发 peer 流程的信号"
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "knowledge.currentPoint",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "knowledge.points",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "pedagogy.strategies",
        "render": "hidden",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "skill:teaching-turn",
        "fieldId": "reply",
        "render": "visible",
        "handoff": [
          "teaching-agent"
        ],
        "internal": false,
        "accumulate": false,
        "locks": {
          "level": "system-locked"
        },
        "notes": null
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "analysis.confusionPoints",
        "render": "hidden",
        "handoff": [
          "profile"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "analysis.understanding",
        "render": "hidden",
        "handoff": [
          "profile"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "classroomContext",
        "render": "hidden",
        "handoff": [
          "skill:teaching-turn"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "回合输入通道（AITeachingOrchestrator 组装注入）"
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "controls.teachingControlContext",
        "render": "hidden",
        "handoff": [
          "skill:teaching-turn"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "回合输入通道（AITeachingOrchestrator 组装注入）"
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "evaluation.sessionKtl",
        "render": "hidden",
        "handoff": [
          "profile"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "evaluation.sessionLf",
        "render": "hidden",
        "handoff": [
          "profile"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "evaluation.sessionLss",
        "render": "hidden",
        "handoff": [
          "profile"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "knowledge.points",
        "render": "hidden",
        "handoff": [
          "profile"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "knowledge.state",
        "render": "hidden",
        "handoff": [
          "skill:teaching-turn"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "回合输入通道（AITeachingOrchestrator 组装注入）"
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "learner.learnerProjection",
        "render": "hidden",
        "handoff": [
          "skill:teaching-turn"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "回合输入通道（AITeachingOrchestrator 组装注入）"
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "pedagogy.strategies",
        "render": "hidden",
        "handoff": [
          "profile"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "summary.knowledgeItems",
        "render": "hidden",
        "handoff": [
          "profile"
        ],
        "internal": false,
        "accumulate": true,
        "locks": {
          "level": "fully-editable"
        },
        "notes": null
      },
      {
        "agentId": "teaching-agent",
        "fieldId": "visibleDialogueContext",
        "render": "hidden",
        "handoff": [
          "skill:teaching-turn"
        ],
        "internal": true,
        "accumulate": false,
        "locks": {
          "level": "fully-editable"
        },
        "notes": "回合输入通道（AITeachingOrchestrator 组装注入）"
      }
    ]
  }
}
