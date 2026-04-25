import { getAPIGateway, CallerInfo } from '../../gateway/api-gateway';
import { logger } from '../../utils/logger';
import type { AgentDefinition, AgentOutput } from '../protocol';

const AGENT_ID = 'teaching-turn-agent';

type MessageRole = 'user' | 'assistant' | 'system';

export interface TeachingTurnInput {
  messages: Array<{ role: MessageRole; content: string }>;
  scenario: {
    subject: string;
    topic: string;
    taskTitle: string;
    taskDescription: string;
    taskType: string;
    taskKnowledgeScope?: {
      primaryConcepts: string[];
      prerequisiteConcepts: string[];
    };
    pathTitle?: string;
    pathSummary?: string | null;
    currentMilestoneTitle?: string;
    currentStageNumber?: number;
    currentTaskOrder?: number;
    totalTasksInMilestone?: number;
    contextCompression?: {
      enabled: boolean;
      estimatedTokens: number;
      triggerTokens: number;
      recap: string | null;
    };
  };
  learner: {
    profile?: any;
    currentState?: {
      lss: number;
      ktl: number;
      lf: number;
      lsb: number;
    } | null;
    projection?: {
      stableProfile: {
        thinkingStyle: string;
        preferredStyle: string;
        theoryVsPractice: string;
        sessionLength: string;
        confidenceLevel: string;
      };
      liveState: {
        lss: number;
        ktl: number;
        lf: number;
        lsb: number;
        recentTrend: string;
        recommendedPacing: string;
      };
      pathContext: {
        pathTitle: string;
        pathSummary?: string | null;
        currentMilestoneTitle: string;
        currentStageNumber: number;
        currentTaskOrder: number;
        totalTasksInMilestone: number;
        completedPrerequisiteTasks: string[];
      };
      relevantKnowledge: {
        mastered: string[];
        fragile: string[];
        struggling: string[];
      };
      teachingHints: {
        promptEnhancement: string;
        recommendedApproach: string;
        emphasize: string[];
        avoid: string[];
      };
    };
  };
  knowledge: {
    points: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>;
  };
  controls?: {
    mode?: 'tutor' | 'peer' | 'debate';
  };
}

export interface TeachingTurnOutput {
  reply: string;
  analysis: {
    cognitiveLevel: string;
    levelScore: number;
    understanding: number;
    confusionPoints: string[];
    engagement: number;
    emotionalState: string;
  };
  knowledge: {
    currentPoint: string | null;
    points: Array<{
      name: string;
      status: 'pending' | 'learning' | 'mastered' | 'review';
      progress: number;
    }>;
  };
  pedagogy: {
    strategies: string[];
  };
  control: {
    isCompletionCandidate: boolean;
    shouldTriggerPeer: boolean;
  };
}

export const teachingTurnAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '教学回合 Agent',
  version: '1.0.0',
  type: 'teaching',
  category: 'standard',
  description: '根据课堂上下文生成本轮教学回复与结构化教学状态',
  capabilities: [
    'teaching-turn-generation',
    'cognitive-analysis',
    'knowledge-state-suggestion',
    'teaching-strategy-selection'
  ],
  subscribes: ['teaching:turn:requested'],
  publishes: ['teaching:turn:generated'],
  inputSchema: {
    type: 'object',
    properties: {
      messages: { type: 'array' },
      scenario: { type: 'object' },
      learner: { type: 'object' },
      knowledge: { type: 'object' },
      controls: { type: 'object' }
    },
    required: ['messages', 'scenario', 'knowledge']
  },
  outputSchema: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      analysis: { type: 'object' },
      knowledge: { type: 'object' },
      pedagogy: { type: 'object' },
      control: { type: 'object' }
    },
    required: ['reply', 'analysis', 'knowledge', 'pedagogy', 'control']
  },
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

const TEACHING_TURN_SYSTEM_PROMPT = `你是一位结构化教学回合生成器。

请根据课堂上下文，输出严格 JSON，字段必须完整：
{
  "reply": "老师本轮真正对学生说的话，允许 Markdown",
  "analysis": {
    "cognitiveLevel": "remember|understand|apply|analyze|evaluate|create",
    "levelScore": 1-6,
    "understanding": 0-1,
    "confusionPoints": ["困惑点"],
    "engagement": 0-1,
    "emotionalState": "positive|neutral|frustrated|confused"
  },
  "knowledge": {
    "currentPoint": "当前知识点名称或 null",
    "points": [
      {"name":"知识点名称","status":"pending|learning|mastered|review","progress":0-100}
    ]
  },
  "pedagogy": {
    "strategies": ["scaffolding", "example"]
  },
  "control": {
    "isCompletionCandidate": true,
    "shouldTriggerPeer": false
  }
}

规则：
1. 只输出 JSON
2. reply 是用户真正可见文本
3. points 必须输出完整数组；没有时输出 []
4. progress 用 0-100 的整数
5. 当前主题之外不展开无关内容
6. knowledge.points 是“当前任务知识看板”，不是整条路径知识快照
7. 如果输入提供了 scenario.taskKnowledgeScope，knowledge.points 只能优先从 primaryConcepts 中选；prerequisiteConcepts 只有在本轮被明确复习或解释时才允许出现
8. 不要把 learner.projection.relevantKnowledge 中的全局 mastered/fragile/struggling 直接抄到 knowledge.points
9. knowledge.points 最多输出 5 个，优先保留当前任务直接相关内容
10. 如果输入提供了学习者投影（projection），优先结合学习者偏好、当前路径位置、脆弱知识点与教学提示来生成 reply、strategies 与知识解释，但不要扩大 knowledge.points 的任务范围`;

function extractJsonObject(content: string): Record<string, any> | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidates = [fenced?.[1], content].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      const match = candidate.match(/\{[\s\S]*\}/);
      if (!match) continue;
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        continue;
      }
    }
  }

  return null;
}

function normalizeOutput(parsed: Record<string, any>): TeachingTurnOutput {
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
    ? parsed.reply.trim()
    : '我们继续沿着这个主题往下学。';

  const analysis = parsed.analysis && typeof parsed.analysis === 'object' ? parsed.analysis : {};
  const knowledge = parsed.knowledge && typeof parsed.knowledge === 'object' ? parsed.knowledge : {};
  const pedagogy = parsed.pedagogy && typeof parsed.pedagogy === 'object' ? parsed.pedagogy : {};
  const control = parsed.control && typeof parsed.control === 'object' ? parsed.control : {};
  const points = Array.isArray(knowledge.points) ? knowledge.points : [];

  return {
    reply,
    analysis: {
      cognitiveLevel: typeof analysis.cognitiveLevel === 'string' ? analysis.cognitiveLevel : 'understand',
      levelScore: Number.isFinite(analysis.levelScore) ? Number(analysis.levelScore) : 2,
      understanding: Number.isFinite(analysis.understanding) ? Number(analysis.understanding) : 0.5,
      confusionPoints: Array.isArray(analysis.confusionPoints)
        ? analysis.confusionPoints.map((item: any) => String(item))
        : [],
      engagement: Number.isFinite(analysis.engagement) ? Number(analysis.engagement) : 0.5,
      emotionalState: typeof analysis.emotionalState === 'string' ? analysis.emotionalState : 'neutral',
    },
    knowledge: {
      currentPoint: typeof knowledge.currentPoint === 'string' && knowledge.currentPoint.trim()
        ? knowledge.currentPoint.trim()
        : null,
      points: points.map((point: any) => ({
        name: typeof point?.name === 'string' ? point.name : '',
        status: ['pending', 'learning', 'mastered', 'review'].includes(point?.status)
          ? point.status
          : 'pending',
        progress: Number.isFinite(point?.progress)
          ? Math.max(0, Math.min(100, Math.round(Number(point.progress))))
          : 0,
      })).filter((point: any) => point.name),
    },
    pedagogy: {
      strategies: Array.isArray(pedagogy.strategies)
        ? pedagogy.strategies.map((item: any) => String(item))
        : [],
    },
    control: {
      isCompletionCandidate: !!control.isCompletionCandidate,
      shouldTriggerPeer: !!control.shouldTriggerPeer,
    },
  };
}

export async function teachingTurnAgentHandler(input: TeachingTurnInput): Promise<AgentOutput> {
  try {
    const gateway = getAPIGateway();
    const caller: CallerInfo = { agentId: AGENT_ID };
    const response = await gateway.execute({
      messages: [
        { role: 'system', content: TEACHING_TURN_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify(input)
        }
      ]
    }, caller, { userId: 'system' });

    const raw = response.choices[0]?.message.content || '{}';
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      throw new Error('TEACHING_TURN_OUTPUT_INVALID');
    }

    const output = normalizeOutput(parsed);
    return {
      success: true,
      userVisible: output.reply,
      internal: {
        core: {
          stage: 'turn-completed',
          confidence: 0.8,
          isCompleted: output.control.isCompletionCandidate,
        },
        ext: {
          teaching: output,
        }
      },
      renderHints: {
        component: 'teaching-turn'
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '教学回合 Agent',
        agentType: 'teaching',
        confidence: 0.8,
        generatedAt: new Date().toISOString(),
      }
    };
  } catch (error) {
    logger.error('[TeachingTurnAgent] 执行失败', { error });
    return {
      success: false,
      userVisible: '这一轮教学内容生成失败，请稍后重试。',
      error: {
        code: 'TEACHING_TURN_FAILED',
        message: error instanceof Error ? error.message : String(error)
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '教学回合 Agent',
        agentType: 'teaching',
        confidence: 0,
        generatedAt: new Date().toISOString(),
      }
    };
  }
}
