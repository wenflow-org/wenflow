import { agentConfigService } from '../../services/agentConfig.service';
import aiService from '../../services/ai/ai.service';
import { logger } from '../../utils/logger';
import {
  AgentContext,
  AgentDefinition,
  AgentInput,
  AgentOutput
} from '../protocol';
import {
  extractStructuredPayload,
  hasValidStructuredPayload,
  type GoalStructuredFailureType,
  type GoalStructuredParseMode,
  type StructuredParseResult,
  validateGoalConversationStructuredOutput
} from './structured-validator';

export interface QuickReply {
  text: string;
  icon?: string;
}

export interface GoalConversationInternal {
  core: {
    conversationId?: string | null;
    stage: 'understanding' | 'proposing' | 'ready' | 'completed';
    confidence: number;
    isCompleted: boolean;
    learningPath?: any;
  };
  ext: {
    goalConversation: {
      understanding: any;
      nextQuestions: string[];
      quickReplies?: QuickReply[];
      collected: any;
      structuredData?: any;
      confirmedProposal?: any;
      confidenceScores?: any;
    };
  };
}

export interface GoalConversationAgentResult {
  userVisible: string;
  internal: GoalConversationInternal;
  debug?: {
    attemptCount?: number;
    actualRetryCount?: number;
    formatFailureCount?: number;
    parseMode: StructuredParseResult['parseMode'];
    failureType?: GoalStructuredFailureType;
    violations?: string[];
    observationMode?: boolean;
    promptVersion?: number;
    requestMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    attempts?: Array<{
      attemptIndex: number;
      parseMode: StructuredParseResult['parseMode'];
      structuredOutputValid: boolean;
      failureType?: GoalStructuredFailureType;
      violations?: string[];
      rawContent: string;
    }>;
    structuredOutputValid?: boolean;
  };
}

interface StageControlOptions {
  latestUserInput?: string;
  previousStage?: 'understanding' | 'proposing' | 'ready' | 'completed' | string;
  previousConfidence?: number;
  confirmProposal?: boolean;
}

interface GoalConversationStateSnapshot {
  stage?: 'understanding' | 'proposing' | 'ready' | 'completed' | string;
  confidence?: number;
  understanding?: any;
  collected?: any;
  structuredData?: any;
  confirmedProposal?: any;
  confidenceScores?: any;
}

interface RetryAttemptInfo {
  attemptIndex: number;
  parseMode: StructuredParseResult['parseMode'];
  structuredOutputValid: boolean;
  failureType: GoalStructuredFailureType;
  violations: string[];
  rawContent: string;
}

interface CallAIResult {
  content: string;
  attemptCount: number;
  actualRetryCount: number;
  formatFailureCount: number;
  parseMode: StructuredParseResult['parseMode'];
  structuredOutputValid: boolean;
  failureType: GoalStructuredFailureType;
  violations: string[];
  attempts: RetryAttemptInfo[];
}

export const DEFAULT_SYSTEM_PROMPT = `你是一个学习目标澄清与方向收敛助手。

你的任务是通过自然对话澄清学习目标、理解学习者当前处境，并在信息足够时收敛到第一版学习方向。你不是业务顾问，也不是正式的学习路径生成器；此阶段不直接替用户解决业务问题，也不展开完整学习路径正文。

系统每次只会给你一个结构化 user payload。这个 payload 代表一次新的回合判断，不是让你续写上一轮聊天。

payload 中会包含三类信息：
- userInput：当前这一轮用户刚刚新增的真实输入。
- state：当前已累积的主记忆，优先级最高。
- conversationContext：过往对话的摘要化上下文证据，仅用于核对用户原话和补足细节，不是要你继续模仿的聊天历史。

上下文使用规则（关键）：
- 这是 fresh turn evaluation。优先依据当前 user payload 里的 state 判断当前阶段、已收集信息和剩余关键缺口，不要把 conversationContext 当作需要续写的多轮聊天。
- conversationContext 只用来核对用户原话、补足语义细节、发现 state 中可能遗漏或偏差的信息。
- 若 state 与 current turn payload 里的 userInput 冲突，必须以 userInput 为准，并在输出中修正状态。
- 不要为了补全字段而编造用户没有明确提供的信息；不确定就保持空白、未明确或继续追问。
- 你的任务是基于当前输入对 state 做最小必要更新，而不是重写整份历史。 
- 不要机械延续 conversationContext 中 assistant 的措辞、语气或输出形式。

主体规则（关键）：
- 默认始终面向提问者本人进行规划。
- 即使用户提到“孩子/团队/他人”，也要转化为“提问者本人需要学习和执行什么”，不要把方案主体切换为第三方。
- 你的问题与建议必须可由提问者直接执行。

阶段说明：
- understanding：继续澄清目标、问题与学习者处境
- proposing：给出第一版大致学习方向并请求确认
- ready：用户已确认，可进入后续学习路径生成

行为规则：
1. 每次最多问 1 个核心问题，避免连续追问。
2. proposing 只给第一版大致学习方向，不给详细周计划、阶段细则或执行清单。
3. ready 只做确认，不展开完整学习路径正文。
4. 不编造用户没有提供的信息。
5. 所有规划默认针对提问者本人，不输出第三方作为主要学习执行者的计划。
6. 在 understanding 阶段，reply 默认先用 1-2 句总结“你已理解用户刚刚说了什么”；若确有必要再补一句“为什么要问下一个问题”；最后只提出 1 个关键问题。
7. 提问语气不能像问卷或审问，优先使用自然过渡，不要刻意解释“你问这个是为了规划路径”。
8. 当用户只能描述模糊困难（如“不知道怎么开始”“感觉很乱”“学了还是不会用”）时，不要继续追问抽象问题（如“你的真实问题是什么”）。优先追问 1 个最近发生的具体卡住场景，帮助用户把隐性困难外化为可回答的问题，优先问“最近一次卡住发生在什么任务/文件/场景里”。
9. 在 understanding 阶段，优先使用认知共情，而不是空洞安慰。认知共情指：先复述用户场景中的关键约束、冲突或难点，再推进问题；例如“你现在只有 Excel 基础，但希望 3 个月内找到数据分析工作，时间窗口确实很紧”，避免“我理解你的焦虑”这类空话。
10. 如果连续 3 轮以上仍处于 understanding，reply 可增加 1 句简短进度感知，让用户知道对话在推进，例如“目标已经比较清晰了，再确认一个关键点”。这句话不超过 15 个字，且不要每轮都说。
11. 如果已经连续追问 3 轮，且用户最近几轮回复都很简短（例如少于 10 个字），在提出下一个问题前，先用 1 句话整合已经收集到的关键信息，让用户感到你在理解和收敛，而不是机械追问。
12. 对新手用户，优先收集“最近一次失败场景、当时试图做什么、卡在哪里、造成了什么影响”。这类具体信息比抽象自我评估更可靠，应优先用于形成 real_problem。
12.1 real_problem 必须是对 surface_goal 的诊断结论，必须能回答“为什么会这样”，而不是把用户原话换一种说法重写一遍。
12.2 在写 real_problem 前先自检：如果它和 surface_goal 只是同义改写、抽象升级或语序调整，说明信息还停留在表面；此时不要硬写 real_problem，而是继续追问最近一次具体卡住场景。
13. 不要默认用户已经具备足够的背景经验，能够把抽象说明独立迁移到真实任务里。在 goal 澄清阶段，优先确认用户与当前目标直接相关的背景经验，并把它压缩写入 hidden 字段 background_experience。这个字段用于后续路径生成和用户画像聚合，不需要面向前端展示。
14. 不要主动追问“学习偏好”或要求用户做高抽象的自我诊断。但当用户在自然对话中流露出某种学习承接信号时（例如“看了很多教程还是不会”“能不能直接给我一个模板”“最好先给我一个能照着做的例子”），将其压缩记录到 hidden 字段 learning_signal。这个字段只做静默累积，供后续路径生成调整第一步交付形式使用，不作为阶段推进条件。
15. 提问优先级从高到低：最近一次具体卡住场景 > 当前要完成的任务 > 可投入时间/资源 > 偏好与细节。如果用户还说不清问题，不要先问偏好题。
16. 当用户回答模糊时，优先提供窄化选项帮助作答，但一次最多只给一个问题。选项是为了降低回答负担，不是问卷。
17. 禁止频繁使用“最后一个问题”“最后确认一个点”“就差最后一个信息”这类收口套话，除非你真的准备结束澄清。
18. 少用“为了给你规划更明确的路径”“为了帮你规划出可操作的学习路径”“为了给你规划出更精准的第一版学习路径，我想了解”这类机械流程化表达；优先直接复述你已理解到的冲突、约束和缺口，再自然进入下一个问题。
19. 如果下一条问题只是提升方案精细度，而不是决定方向所必需，就不要继续追问，改为进入 proposing。

阶段推进门槛（关键）：
- 进入 proposing 不要求把所有字段补满；只要已经足够给出第一版大致学习方向，就应及时收敛。
- 以下 4 项属于进入 proposing 的硬必需信息：
  1) surface_goal（表面目标，保留用户第一次表达诉求时的口语化原话，不要概括、不要升级成业务目标、不要改写成术语）
  2) real_problem（真实问题，使用“场景+阻碍+影响”的具体句，必须是对 surface_goal 的诊断结论，而不是表面诉求的复述）
  3) available_resources（至少包含 time_budget 或 time_horizon 其中之一）
  4) success_criteria（至少包含 1 条可观察结果，最好带时间窗）
- 以下 3 项属于软信息，可在 proposing 前后继续补充，不应阻止你给出第一版方向：
  1) current_baseline（当前基础、行为证据）
  2) background_experience（与当前目标直接相关的背景经验摘要，重点描述做过什么、试过什么、卡在什么真实场景，不是抽象水平标签）
  3) constraints_and_boundaries（不可接受结果、硬约束、禁区）
- 如果你已经可以用 2-4 句话说清“用户想改善什么、卡在哪里、能投入什么、希望达到什么结果”，并能给出一版大致学习方向，就应进入 proposing。
- 当用户连续 2-3 轮都在补充同一类细节时，优先判断是否应该收敛到 proposing，而不是继续细分追问。
- 只有当缺失的信息会直接影响第一版方向判断时，才继续停留在 understanding。

时间处理规则（通用）：
- time_horizon 只作简短参考，允许："半天"、"1天"、"2天"、"3-7天"、"1-2周"、"1个月+"、"未明确"。
- 后续规划必须是阶段制（stage-based），不要生成按周/月展开的任务表。

understanding 阶段输出要求：
- 优先表现为“我理解到的核心 + 还缺的唯一关键点”。
- 不要为了完整画像而连续追问用户的顾虑分支、性格分支、场景分支。
- 如果信息已经基本够了，可以先给一句方向判断，再问用户是否认同，而不是继续采集细节。
- 如果用户的问题描述仍然模糊，优先把问题锚定到最近一次具体场景，而不是继续追问抽象定义。
- 这 6 项信息是为了帮助你形成“可教、可规划的问题表征”，不是逐项盘问清单；如果用户暂时无法直接回答某一项，先通过具体场景推断问题边界，再做最小必要追问。

字段边界（关键）：
- surface_goal 是用户的原始诉求锚点，用来保留用户最初是怎么描述问题的。必须尽量保留用户原话，不要概括，不要改写，不要升级。
- real_problem 是你对用户困境的诊断结果，用来回答“为什么会这样”。必须优先包含具体场景和具体障碍，必要时再带影响。
- 如果 real_problem 和 surface_goal 很像，说明你还没有拿到足够的失败场景证据；这时应该追问具体场景，而不是继续停留在抽象层。
- surface_goal 正例："向上汇报时抓不住重点"、"一上坡就熄火，不敢开了"、"睡不着，脑子停不下来"
- surface_goal 反例："提升职场沟通效率"、"掌握坡道起步技巧"、"改善睡眠质量"
- real_problem 反例："向上汇报时组织重点困难"、"坡道起步容易熄火"、"睡眠质量不好"。这些都只是症状复述，不是诊断。

proposing 阶段输出要求：
- 用 2-4 句给出第一版大致学习方向。
- 明确指出：用户真正先要先聚焦什么，而不是什么都一起练。
- proposal 是可调整的第一版方向，不是终稿承诺，也不是完整学习路径正文。
- confirmedProposal 必须给出以下 4 类内容：
  1) learning_direction：这一版路径先聚焦解决什么
  2) first_deliverable：用户最先要拿到的最小结果是什么
  3) key_stages：给出你认为合理数量的大致阶段，用于预览方向，不展开执行细节；通常 2-5 个即可，但不要为凑数字而硬拆
  4) out_of_scope：当前版本先不展开什么，避免范围失控；允许为空数组
- reply 结尾应引导用户确认或调整，并优先给 quickReplies。

输出规则（严格）：
1. 只输出一个合法 JSON 对象，不要输出额外说明文本。
2. JSON 顶层字段只能是：
   - reply: string
   - state: { stage: "understanding"|"proposing"|"ready", confidence: number, done?: boolean }
   - goalConversation: {
        understanding: object,
        nextQuestions: string[],
        quickReplies: string[] | Array<{ text: string, icon?: string }>,
        structuredData?: object,
        confirmedProposal?: object,
        confidenceScores?: object
      }
   - quickReplies 的主要真相源是 goalConversation.quickReplies。
   - 不要再输出 hints.quickReplies，前端会直接解析 goalConversation.quickReplies。
3. 禁止输出平台字段：success/schemaVersion/metadata/internal/renderHints/error/output。
4. 你的最终输出必须严格满足以下格式纪律，否则视为失败：
   - 第一个非空字符必须是 {
   - 最后一个非空字符必须是 }
   - 整个回答必须就是这 1 个 JSON 对象本身
   - JSON 前后不能有任何前言、解释、总结、道歉、注释、markdown 包装或自然语言
   - 不要输出 reasoning、思考过程、分析说明、字段解释、示例前缀
   - 不要先写自然语言再补 JSON
   - 不要把 JSON 放进 markdown 列表、引用块、代码块或第二个对象里
5. 在发送最终答案前，先自行检查一次：
   - 是否只有 1 个 JSON 对象
   - 顶层是否只有 reply、state、goalConversation
   - goalConversation.quickReplies 是否为唯一 quickReplies 输出位置
   - 是否没有 hints、metadata、internal、renderHints、success、schemaVersion、error、output 等多余字段
   - 若不满足，先在内部修正，再输出最终结果
6. 如果你本来想输出普通对话文本，也必须把它放入 reply 字段，而不是输出到代码块外。
7. 宁可输出内容较短但结构完全合法，也不要输出自然语言散文式回复。
8. 当前这一轮的 user message 是结构化输入 payload，不是普通闲聊文本。你必须优先读取 payload 中的 userInput 与 state，再决定 reply 和 state 更新。

参考模板：
{
  "reply": "按你刚才说的，我先给你一版大致学习方向：第一步不是全面提升沟通能力，而是先练出一个稳定的汇报筛选和表达框架。这样更符合你每周可投入的时间，也更容易先看到效果。如果这版方向对，我下一步就按它生成正式路径。",
  "state": {
    "stage": "proposing",
    "confidence": 0.81,
    "done": false
  },
  "goalConversation": {
    "understanding": {
      "surface_goal": "向上汇报老抓不住重点，经常被打断",
      "real_problem": "上周向VP汇报项目进展时，我先讲了5分钟过程，结果被直接打断问\"结论是什么\"。卡点不只是表达紧张，而是我不知道该先筛出VP最关心的风险还是投入产出比，导致每次都把过程讲太多、核心结论讲太晚。",
      "current_baseline": {
        "level": "有表达意愿，但缺少稳定框架",
        "evidence": "习惯先讲过程再总结，汇报时容易被信息量带跑"
      },
      "background_experience": "做过日常口头汇报，但还没有形成稳定的结论优先表达框架，往往能理解建议却很难直接迁移到下一次真实汇报中。",
      "learning_signal": "更适合先给可直接套用的表达骨架和示例，再逐步理解背后的抽象原则。",
      "available_resources": {
        "time_horizon": "1-2周",
        "time_budget": "每周30分钟以内"
      },
      "constraints_and_boundaries": ["怕方法复杂记不住", "怕坚持不下来"],
      "success_criteria": {
        "time_window": "汇报当场或1-2天内",
        "observable_result": "2分钟内说清楚核心结论并推动反馈或决定",
        "acceptance_check": "能一句话说出核心结论，汇报中更少被打断"
      },
      "motivation": "提高表达与协作效率",
      "urgency": "中",
      "pain_points": "信息筛选困难，不知道领导最想听什么",
      "background": {
        "current_level": "",
        "available_time": "",
        "expected_time": "",
        "constraints": [],
        "strengths": []
      }
    },
    "nextQuestions": [],
    "quickReplies": ["这个预览可以，继续生成", "想先调整预览"],
    "confirmedProposal": {
      "learning_direction": "先稳定汇报筛选和表达框架，而不是同时全面提升所有沟通场景",
      "first_deliverable": "先形成一个可复用的2分钟汇报表达骨架，并在一次真实汇报里试用",
      "key_stages": [
        "先识别当前汇报最容易失焦的环节",
        "再练一个更稳定的结论优先表达框架",
        "最后在真实汇报中试用并根据反馈微调"
      ],
      "out_of_scope": [
        "暂不同时处理所有沟通场景",
        "暂不展开成详细周计划"
      ]
    }
  }
}
`;

function buildEffectivePrompt(configPrompt?: string | null, overridePrompt?: string | null): string {
  const normalizedOverridePrompt = typeof overridePrompt === 'string' ? overridePrompt.trim() : '';
  if (normalizedOverridePrompt) {
    return normalizedOverridePrompt;
  }

  const normalizedConfigPrompt = typeof configPrompt === 'string' ? configPrompt.trim() : '';
  if (normalizedConfigPrompt) {
    return normalizedConfigPrompt;
  }

  return DEFAULT_SYSTEM_PROMPT;
}

function buildGoalConversationUserPayload(input: {
  userInput: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  previousState?: GoalConversationStateSnapshot;
  previousUnderstanding?: any;
  previousStage?: string;
}): string {
  const statePayload = input.previousState
    ? input.previousState
    : input.previousUnderstanding
      ? {
          stage: input.previousStage || 'understanding',
          confidence: input.previousUnderstanding?.confidence || 0,
          understanding: input.previousUnderstanding
        }
      : {
          stage: input.previousStage || 'understanding',
          confidence: 0,
          understanding: {}
        };

  const conversationContext = (input.conversationHistory || []).map((item) => ({
    role: item.role,
    text: item.content
  }));

  return JSON.stringify({
    userInput: input.userInput,
    state: statePayload,
    conversationContext,
    task: {
      mode: 'goal-conversation-turn-update',
      requirements: [
        'treat state as primary memory',
        'treat conversationContext as supporting evidence only',
        'if state conflicts with userInput, trust userInput',
        'do not treat conversationContext as chat history to continue',
        'return exactly one raw JSON object with no extra text'
      ]
    }
  }, null, 2);
}

export const goalConversationAgentDefinition: AgentDefinition = {
  id: 'goal-conversation-agent',
  name: '目标对话Agent',
  version: '1.1.0',
  type: 'custom',
  category: 'standard',
  description: '负责学习目标澄清、问题穿透和阶段推进的专用业务 Agent',
  capabilities: ['goal-clarification', 'problem-discovery', 'stage-transition', 'quick-replies'],
  subscribes: [],
  publishes: ['goal-conversation:updated', 'goal-conversation:ready'],
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      metadata: { type: 'object' },
      conversationHistory: { type: 'array' }
    },
    required: ['goal']
  },
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      userVisible: { type: 'string' },
      internal: {
        type: 'object',
        properties: {
          core: {
            type: 'object',
            properties: {
              stage: {
                type: 'string',
                enum: ['understanding', 'proposing', 'ready', 'completed']
              },
              confidence: { type: 'number' },
              isCompleted: { type: 'boolean' }
            },
            required: ['stage', 'confidence', 'isCompleted']
          },
          ext: {
            type: 'object',
            properties: {
              goalConversation: { type: 'object' }
            },
            required: ['goalConversation']
          }
        },
        required: ['core', 'ext']
      },
      renderHints: {
        type: 'object'
      },
      schemaVersion: {
        type: 'string',
        enum: ['agent-output-v1']
      }
    },
    required: ['success', 'userVisible', 'internal', 'schemaVersion']
  },
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};


function normalizeDialogueText(text: string): string {
  return text
    .replace(/^第一段[：:]/m, '')
    .replace(/^第二段[：:].*$/m, '')
    .replace(/```json[\s\S]*$/m, '')
    .trim();
}

function enforceSingleQuestionForUnderstanding(text: string, stage: 'understanding' | 'proposing' | 'ready' | 'completed'): string {
  if (!text || stage !== 'understanding') {
    return text;
  }

  let usedQuestion = false;
  const lines = text.split('\n');
  const normalizedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      normalizedLines.push(line);
      continue;
    }

    const hasQuestion = /[？?]/.test(trimmed);
    if (!hasQuestion) {
      normalizedLines.push(line);
      continue;
    }

    if (!usedQuestion) {
      const chineseIdx = trimmed.indexOf('？');
      const englishIdx = trimmed.indexOf('?');
      const firstQuestionIdx = chineseIdx === -1
        ? englishIdx
        : englishIdx === -1
          ? chineseIdx
          : Math.min(chineseIdx, englishIdx);
      if (firstQuestionIdx >= 0) {
        normalizedLines.push(trimmed.slice(0, firstQuestionIdx + 1));
      } else {
        normalizedLines.push(trimmed);
      }
      usedQuestion = true;
      continue;
    }

    // 超过 1 个问题时，将其改写为说明句，避免连续追问
    normalizedLines.push(trimmed.replace(/[？?]/g, '。'));
  }

  return normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function inferQuickRepliesFromList(content: string): QuickReply[] {
  const listItems = content.match(/(?:^|\n)\s*(?:\d+[.、]|[•\-])\s*(.+?)(?=\n|$)/g);
  if (!listItems || listItems.length < 2 || listItems.length > 5) return [];

  return listItems.map((item) => ({
    text: item.replace(/^\s*(?:\d+[.、]|[•\-])\s*/, '').trim()
  }));
}

function buildConfirmationBlock(parsedJson: any): string {
  return `【确认方案】
你想学的是：${parsedJson.real_problem || parsedJson.understanding?.real_problem || parsedJson.understanding?.surface_goal || '学习目标'}
你的情况是：${parsedJson.background?.current_level || parsedJson.understanding?.background?.current_level || '待确认'}
期望见效：${parsedJson.background?.expected_time || parsedJson.understanding?.background?.expected_time || '待确认'}
${parsedJson.pain_points || parsedJson.understanding?.pain_points ? `你的痛点是：${parsedJson.pain_points || parsedJson.understanding?.pain_points}\n` : ''}
确认这个方向对吗？如有补充可以告诉我。`;
}

function mergeUnderstanding(previousUnderstanding: any, parsedJson: any): any {
  const understanding = { ...(previousUnderstanding || {}) };
  const nextUnderstanding = parsedJson?.understanding || {};

  if (parsedJson?.real_problem && !nextUnderstanding.real_problem) {
    nextUnderstanding.real_problem = parsedJson.real_problem;
  }
  if (parsedJson?.motivation && !nextUnderstanding.motivation) {
    nextUnderstanding.motivation = parsedJson.motivation;
  }
  if (parsedJson?.urgency && !nextUnderstanding.urgency) {
    nextUnderstanding.urgency = parsedJson.urgency;
  }
  if (parsedJson?.pain_points && !nextUnderstanding.pain_points) {
    nextUnderstanding.pain_points = parsedJson.pain_points;
  }
  if (parsedJson?.background) {
    nextUnderstanding.background = {
      ...(nextUnderstanding.background || {}),
      ...parsedJson.background
    };
  }

  return {
    ...understanding,
    ...nextUnderstanding,
    background: {
      ...(understanding.background || {}),
      ...(nextUnderstanding.background || {})
    },
    learning_style: {
      ...(understanding.learning_style || {}),
      ...(nextUnderstanding.learning_style || {})
    },
    cognitive_profile: {
      ...(understanding.cognitive_profile || {}),
      ...(nextUnderstanding.cognitive_profile || {})
    },
    emotional_profile: {
      ...(understanding.emotional_profile || {}),
      ...(nextUnderstanding.emotional_profile || {})
    }
  };
}

function buildCollected(understanding: any, parsedJson: any): any {
  return {
    surface_goal: understanding.surface_goal || null,
    real_problem: understanding.real_problem || null,
    background_experience: understanding.background_experience || null,
    learning_signal: understanding.learning_signal || null,
    motivation: understanding.motivation || null,
    urgency: understanding.urgency || null,
    pain_points: understanding.pain_points || null,
    background: understanding.background || {},
    learning_style: understanding.learning_style || {},
    goal: understanding.real_problem || understanding.surface_goal || null,
    level: understanding.background?.current_level || null,
    timePerDay: understanding.background?.available_time || understanding.background?.expected_time || null,
    expected_time: understanding.background?.expected_time || null,
    questions_to_ask: parsedJson?.next_questions || []
  };
}

function isPlaceholderValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;

  const text = value.trim();
  if (!text) return true;

  const placeholderPatterns = [
    /^待确认$/,
    /^待收集$/,
    /^未知$/,
    /^未明确$/,
    /^未确定$/,
    /^null$/i,
    /^undefined$/i,
    /尚未/,
    /不明确/,
    /未.*表达/,
    /可能是/,
    /初步判断/,
    /需要厘清/,
    /待补充/
  ];

  return placeholderPatterns.some((pattern) => pattern.test(text));
}

function sanitizeUnderstanding(understanding: any): any {
  if (!understanding || typeof understanding !== 'object') return {};

  const sanitized = {
    ...understanding,
    background: { ...(understanding.background || {}) },
    learning_style: { ...(understanding.learning_style || {}) },
    cognitive_profile: { ...(understanding.cognitive_profile || {}) },
    emotional_profile: { ...(understanding.emotional_profile || {}) }
  };

  const topLevelKeys = ['surface_goal', 'real_problem', 'motivation', 'urgency', 'pain_points', 'background_experience', 'learning_signal'];
  topLevelKeys.forEach((key) => {
    if (isPlaceholderValue(sanitized[key])) {
      delete sanitized[key];
    }
  });

  Object.keys(sanitized.background).forEach((key) => {
    if (isPlaceholderValue(sanitized.background[key])) {
      delete sanitized.background[key];
    }
  });

  return sanitized;
}

function normalizeStageAndConfidence(
  stage: 'understanding' | 'proposing' | 'ready' | 'completed',
  confidence: number,
  options?: StageControlOptions
): { stage: 'understanding' | 'proposing' | 'ready' | 'completed'; confidence: number } {
  const STAGE_CAPS = {
    understanding: 0.92,
    proposing: 0.95,
    ready: 0.98
  };

  const STAGE_MINIMUMS = {
    understanding: 0.15,
    proposing: 0.75,
    ready: 0.95
  };

  let normalizedStage = stage;
  let normalizedConfidence = Number.isFinite(confidence) ? confidence : 0.2;

  const previousStage = options?.previousStage;

  if (previousStage === 'proposing' && options?.confirmProposal === true) {
    normalizedStage = 'ready';
  }

  const cap = STAGE_CAPS[normalizedStage] || 0.92;
  const floor = STAGE_MINIMUMS[normalizedStage] || 0.15;
  normalizedConfidence = Math.min(normalizedConfidence, cap);
  normalizedConfidence = Math.max(normalizedConfidence, floor);

  return {
    stage: normalizedStage,
    confidence: Math.min(normalizedConfidence, 0.99)
  };
}

function hasThinProposalPayload(payload: {
  understanding?: any;
  confirmedProposal?: any;
  structuredData?: any;
}): boolean {
  const understanding = payload.understanding || {};
  const confirmedProposal = payload.confirmedProposal || {};
  const structuredData = payload.structuredData || {};

  const hasRealProblem = typeof understanding.real_problem === 'string' && understanding.real_problem.trim().length > 0;
  const hasTimeBudget = typeof understanding.available_resources?.time_budget === 'string'
    && understanding.available_resources.time_budget.trim().length > 0;
  const hasTimeHorizon = typeof understanding.available_resources?.time_horizon === 'string'
    && understanding.available_resources.time_horizon.trim().length > 0;
  const hasSuccessCriteria = typeof understanding.success_criteria?.observable_result === 'string'
    && understanding.success_criteria.observable_result.trim().length > 0;
  const hasProposalDirection = typeof confirmedProposal.learning_direction === 'string'
    && confirmedProposal.learning_direction.trim().length > 0;
  const hasFirstDeliverable = typeof confirmedProposal.first_deliverable === 'string'
    && confirmedProposal.first_deliverable.trim().length > 0;
  const hasKeyStages = Array.isArray(confirmedProposal.key_stages)
    && confirmedProposal.key_stages.filter((item: any) => typeof item === 'string' && item.trim().length > 0).length >= 2;
  const hasOutOfScope = Array.isArray(confirmedProposal.out_of_scope);
  const hasStructuredOutline = structuredData && typeof structuredData === 'object' && Object.keys(structuredData).length > 0;

  const evidenceCount = [
    hasRealProblem,
    hasTimeBudget || hasTimeHorizon,
    hasSuccessCriteria,
    hasProposalDirection,
    hasFirstDeliverable,
    hasKeyStages,
    hasOutOfScope,
    hasStructuredOutline
  ].filter(Boolean).length;

  return !(hasRealProblem && (hasTimeBudget || hasTimeHorizon) && hasSuccessCriteria && hasProposalDirection && hasFirstDeliverable && hasKeyStages && hasOutOfScope) || evidenceCount < 6;
}

function parseGoalConversationResponse(
  content: string,
  previousUnderstanding?: any,
  stageControlOptions?: StageControlOptions
): GoalConversationAgentResult {
  const { parsedJson, dialogueText: extractedDialogueText } = extractStructuredPayload(content);
  let dialogueText = extractedDialogueText;

  let stage: 'understanding' | 'proposing' | 'ready' | 'completed' = 'understanding';
  let quickReplies: QuickReply[] = [];
  let structuredData: any = undefined;
  let confirmedProposal: any = undefined;
  let confidenceScores: any = undefined;
  let nextQuestions: string[] = [];
  let understanding = { ...(previousUnderstanding || {}) };

  if (parsedJson) {
    const normalizedPayload = parsedJson.goalConversation || {};
    understanding = mergeUnderstanding(previousUnderstanding, normalizedPayload);
    const validStages = ['understanding', 'proposing', 'ready', 'completed'];
    const stageFromPayload = parsedJson.stage || parsedJson.state?.stage;
    stage = validStages.includes(stageFromPayload) ? stageFromPayload : 'understanding';

    const payloadNextQuestions = normalizedPayload.nextQuestions;
    nextQuestions = Array.isArray(payloadNextQuestions) ? payloadNextQuestions : [];

    const payloadQuickReplies = normalizedPayload.quickReplies || parsedJson.hints?.quickReplies;
    if (Array.isArray(payloadQuickReplies)) {
      quickReplies = payloadQuickReplies.map((item: string | QuickReply) => (
        typeof item === 'string' ? { text: item } : { text: item.text, icon: item.icon }
      )).filter((item: QuickReply) => item.text && item.text.trim().length > 0);
    }

    structuredData = normalizedPayload.structuredData;
    confirmedProposal = normalizedPayload.confirmedProposal;
    confidenceScores = normalizedPayload.confidenceScores;

    if (!understanding || Object.keys(understanding).length === 0) {
      understanding = mergeUnderstanding(previousUnderstanding, normalizedPayload);
    }
  } else {
    if (content.includes('【确认方案】')) {
      stage = 'proposing';

      const goalMatch = content.match(/你想学的是[：:]\s*([\s\S]+?)(?=\n你的情况|\n背景|\n期望|\n每周|$)/);
      const baseMatch = content.match(/你的情况(?:是)?[：:]\s*([\s\S]+?)(?=\n期望|\n每周|\n痛点|\n确认|$)/);
      const timeMatch = content.match(/期望见效[：:]\s*(.+?)(?:\n|$)/);
      const painMatch = content.match(/你的痛点(?:是)?[：:]\s*([\s\S]+?)(?=\n确认|\n如有|$)/);

      if (goalMatch) understanding.real_problem = goalMatch[1].trim();
      if (baseMatch || timeMatch) {
        understanding.background = {
          ...(understanding.background || {}),
          ...(baseMatch ? { current_level: baseMatch[1].trim() } : {}),
          ...(timeMatch ? { expected_time: timeMatch[1].trim() } : {})
        };
      }
      if (painMatch) understanding.pain_points = painMatch[1].trim();
    } else {
      quickReplies = inferQuickRepliesFromList(content);
    }

    const contentLower = content.toLowerCase();
    if (contentLower.includes('确认请回复') || contentLower.includes('如有补充')) {
      stage = 'proposing';
    }
  }

  // 直接使用 AI 返回的 confidence
  let confidence = typeof (parsedJson?.confidence ?? parsedJson?.state?.confidence) === 'number'
    ? (parsedJson?.confidence ?? parsedJson?.state?.confidence)
    : 0.2;

  const stageControl = normalizeStageAndConfidence(stage, confidence, stageControlOptions);
  stage = stageControl.stage;
  confidence = stageControl.confidence;

  if (stage === 'proposing' && hasThinProposalPayload({ understanding, confirmedProposal, structuredData })) {
    stage = 'understanding';
    confidence = Math.min(confidence, 0.78);
  }

  understanding = sanitizeUnderstanding(understanding);

  dialogueText = normalizeDialogueText(dialogueText);
  if (parsedJson?.reply) {
    dialogueText = normalizeDialogueText(String(parsedJson.reply));
  }
  if (!dialogueText && parsedJson) {
    dialogueText = stage === 'proposing' ? buildConfirmationBlock(parsedJson) : '我来帮你分析一下...';
  }

  if (!dialogueText) {
    dialogueText = content.trim();
  }

  dialogueText = enforceSingleQuestionForUnderstanding(dialogueText, stage);

  if (stage === 'understanding') {
    nextQuestions = nextQuestions.slice(0, 1);
  }

  if (!quickReplies.length && stage === 'proposing') {
    quickReplies = [
      { text: '确认，生成学习路径' },
      { text: '需要调整' }
    ];
  }

  return {
    userVisible: dialogueText,
    internal: {
      core: {
        stage,
        confidence,
        isCompleted: stage === 'ready' || stage === 'completed'
      },
      ext: {
        goalConversation: {
          understanding,
          nextQuestions,
          quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
          collected: buildCollected(understanding, parsedJson),
          structuredData,
          confirmedProposal,
          confidenceScores
        }
      }
    }
  };
}

function buildStructuredOutputErrorMessage(attemptCount: number): string {
  return `本轮结构化输出连续 ${attemptCount} 次未通过校验，状态未更新。请点击重试，再尝试一次。`;
}

async function callAIWithRetry(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { temperature?: number; maxTokens?: number; model?: string },
  userId?: string,
  maxRetries: number = 2
): Promise<CallAIResult> {
  let lastContent = '';
  let lastParseMode: StructuredParseResult['parseMode'] = 'none';
  const attempts: RetryAttemptInfo[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await aiService.chat(messages, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      model: options.model,
      agentId: 'goal-conversation-agent',
      userId,
      action: 'goal-conversation:dialogue',
      sanitizeUserVisible: false
    });

    lastContent = response.content;
    const validation = validateGoalConversationStructuredOutput(response.content);
    lastParseMode = validation.parseMode;
    const structuredOutputValid = validation.valid;
    attempts.push({
      attemptIndex: attempt + 1,
      parseMode: validation.parseMode,
      structuredOutputValid,
      failureType: validation.failureType,
      violations: validation.violations,
      rawContent: response.content
    });

    if (structuredOutputValid) {
      return {
        content: response.content,
        attemptCount: attempts.length,
        actualRetryCount: Math.max(0, attempts.length - 1),
        formatFailureCount: attempts.filter((item) => !item.structuredOutputValid).length,
        parseMode: validation.parseMode,
        structuredOutputValid: true,
        failureType: 'none',
        violations: [],
        attempts
      };
    }

    logger.warn('GoalConversationAgent 输出不完整，准备重试', {
      attempt: attempt + 1,
      maxRetries,
      parseMode: validation.parseMode,
      failureType: validation.failureType,
      violations: validation.violations,
      contentPreview: response.content.substring(0, 200)
    });

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  logger.warn(`GoalConversationAgent 重试 ${maxRetries} 次后仍不完整，使用最后一次响应`);
  return {
    content: lastContent,
    attemptCount: attempts.length,
    actualRetryCount: Math.max(0, attempts.length - 1),
    formatFailureCount: attempts.filter((item) => !item.structuredOutputValid).length,
    parseMode: lastParseMode,
    structuredOutputValid: false,
    failureType: attempts[attempts.length - 1]?.failureType || 'missing_json_block',
    violations: attempts[attempts.length - 1]?.violations || ['结构化输出校验失败'],
    attempts
  };
}

interface GoalConversationAgentOptions {
  maxFormatRetries?: number;
  allowInvalidStructuredOutput?: boolean;
  systemPromptOverride?: string;
}

export async function goalConversationAgentHandler(
  input: AgentInput,
  context: AgentContext,
  options: GoalConversationAgentOptions = {}
): Promise<AgentOutput> {
  const startTime = Date.now();
  const userId = context.userId;

  try {
    const config =
      await agentConfigService.getActivePrompt('goal-conversation-agent')
      || await agentConfigService.getActivePrompt('goal-conversation');
    const systemPrompt = buildEffectivePrompt(config?.systemPrompt, options.systemPromptOverride);
    const history = (context.conversationHistory || [])
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({ role: msg.role as 'user' | 'assistant', content: msg.content }));
    const previousState = input.metadata?.previousState as GoalConversationStateSnapshot | undefined;
    const previousUnderstanding = input.metadata?.previousUnderstanding;

    const structuredUserPayload = buildGoalConversationUserPayload({
      userInput: input.goal,
      conversationHistory: history,
      previousState,
      previousUnderstanding,
      previousStage: input.metadata?.previousStage
    });

    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: structuredUserPayload }
    ];

    const retryInfo = await callAIWithRetry(
      chatMessages,
      {
        temperature: config?.temperature ?? 0.7,
        maxTokens: config?.maxTokens ?? 8000
      },
      userId,
      options.maxFormatRetries ?? 2
    );

    const duration = Date.now() - startTime;

    if (!retryInfo.structuredOutputValid && options.allowInvalidStructuredOutput) {
      const observedResult = parseGoalConversationResponse(retryInfo.content, previousUnderstanding, {
        latestUserInput: input.goal,
        previousStage: input.metadata?.previousStage,
        previousConfidence: previousUnderstanding?.confidence || 0.2,
        confirmProposal: input.metadata?.confirmProposal === true
      });

      await agentConfigService.recordAgentCall({
        agentId: 'goal-conversation-agent',
        userId: userId || 'anonymous',
        promptVersion: config?.version || 0,
        duration,
        tokensUsed: 0,
        success: false,
        error: 'Structured output validation bypassed in observation mode',
        input: { messages: chatMessages.length, lastMessage: input.goal.substring(0, 200) },
        output: {
          responseLength: observedResult.userVisible.length,
          stage: observedResult.internal.core.stage,
          quickReplies: observedResult.internal.ext.goalConversation.quickReplies?.length || 0,
          attemptCount: retryInfo.attemptCount,
          actualRetryCount: retryInfo.actualRetryCount,
          formatFailureCount: retryInfo.formatFailureCount,
          parseMode: retryInfo.parseMode,
          failureType: retryInfo.failureType,
          violations: retryInfo.violations,
          observationMode: true
        }
      });

      return {
        success: true,
        userVisible: observedResult.userVisible,
        internal: observedResult.internal,
        renderHints: {
          component: 'goal-conversation',
          quickReplies: observedResult.internal.ext.goalConversation.quickReplies || []
        },
        schemaVersion: 'agent-output-v1',
        metadata: {
          agentId: 'goal-conversation-agent',
          agentName: '目标对话Agent',
          agentType: 'custom',
          confidence: observedResult.internal.core.confidence,
          generatedAt: new Date().toISOString()
        },
        debug: {
          attemptCount: retryInfo.attemptCount,
          actualRetryCount: retryInfo.actualRetryCount,
          formatFailureCount: retryInfo.formatFailureCount,
          parseMode: retryInfo.parseMode,
          failureType: retryInfo.failureType,
          violations: retryInfo.violations,
          promptVersion: config?.version || 0,
          requestMessages: chatMessages,
          attempts: retryInfo.attempts,
          structuredOutputValid: false,
          observationMode: true
        }
      };
    }

    if (!retryInfo.structuredOutputValid) {
      await agentConfigService.recordAgentCall({
        agentId: 'goal-conversation-agent',
        userId: userId || 'anonymous',
        promptVersion: config?.version || 0,
        duration,
        tokensUsed: 0,
        success: false,
        error: 'Structured output validation failed after retries',
        input: { messages: chatMessages.length, lastMessage: input.goal.substring(0, 200) },
        output: {
          attemptCount: retryInfo.attemptCount,
          actualRetryCount: retryInfo.actualRetryCount,
          formatFailureCount: retryInfo.formatFailureCount,
          parseMode: retryInfo.parseMode,
          failureType: retryInfo.failureType,
          violations: retryInfo.violations
        }
      });

      return {
        success: false,
        error: 'STRUCTURED_OUTPUT_INVALID',
        userVisible: buildStructuredOutputErrorMessage(retryInfo.attemptCount),
        internal: {
          core: {
            stage: input.metadata?.previousStage === 'proposing' || input.metadata?.previousStage === 'ready'
              ? 'proposing'
              : 'understanding',
            confidence: typeof previousState?.confidence === 'number' ? previousState.confidence : 0,
            isCompleted: false
          },
          ext: {
            goalConversation: {
              understanding: previousUnderstanding || {},
              nextQuestions: [],
              collected: previousState?.collected || {}
            }
          }
        },
        schemaVersion: 'agent-output-v1',
        metadata: {
          agentId: 'goal-conversation-agent',
          agentName: '目标对话Agent',
          agentType: 'custom',
          confidence: typeof previousState?.confidence === 'number' ? previousState.confidence : 0,
          generatedAt: new Date().toISOString()
        },
        debug: {
          attemptCount: retryInfo.attemptCount,
          actualRetryCount: retryInfo.actualRetryCount,
          formatFailureCount: retryInfo.formatFailureCount,
          parseMode: retryInfo.parseMode,
          failureType: retryInfo.failureType,
          violations: retryInfo.violations,
          promptVersion: config?.version || 0,
          requestMessages: chatMessages,
          attempts: retryInfo.attempts,
          structuredOutputValid: false
        }
      };
    }

    const result = parseGoalConversationResponse(retryInfo.content, previousUnderstanding, {
      latestUserInput: input.goal,
      previousStage: input.metadata?.previousStage,
      previousConfidence: previousUnderstanding?.confidence || 0.2,
      confirmProposal: input.metadata?.confirmProposal === true
    });

    await agentConfigService.recordAgentCall({
      agentId: 'goal-conversation-agent',
      userId: userId || 'anonymous',
      promptVersion: config?.version || 0,
      duration,
      tokensUsed: 0,
      success: true,
      input: { messages: chatMessages.length, lastMessage: input.goal.substring(0, 200) },
      output: {
        responseLength: result.userVisible.length,
        stage: result.internal.core.stage,
        quickReplies: result.internal.ext.goalConversation.quickReplies?.length || 0,
        attemptCount: retryInfo.attemptCount,
        actualRetryCount: retryInfo.actualRetryCount,
        formatFailureCount: retryInfo.formatFailureCount,
        parseMode: retryInfo.parseMode,
        failureType: retryInfo.failureType,
        violations: retryInfo.violations
      }
    });

    await agentConfigService.updateStats('goal-conversation-agent', config?.version || 0, duration, true);

    return {
      success: true,
      userVisible: result.userVisible,
      internal: result.internal,
      renderHints: {
        component: 'goal-conversation',
        quickReplies: result.internal.ext.goalConversation.quickReplies || []
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'goal-conversation-agent',
        agentName: '目标对话Agent',
        agentType: 'custom',
        confidence: result.internal.core.confidence,
        generatedAt: new Date().toISOString()
      },
      debug: {
        attemptCount: retryInfo.attemptCount,
        actualRetryCount: retryInfo.actualRetryCount,
        formatFailureCount: retryInfo.formatFailureCount,
        parseMode: retryInfo.parseMode,
        failureType: retryInfo.failureType,
        violations: retryInfo.violations,
        promptVersion: config?.version || 0,
        requestMessages: chatMessages,
        attempts: retryInfo.attempts,
        structuredOutputValid: true
      }
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    await agentConfigService.recordAgentCall({
      agentId: 'goal-conversation-agent',
      userId: userId || 'anonymous',
      promptVersion: 0,
      duration,
      tokensUsed: 0,
      success: false,
      error: error.message || 'Unknown error'
    });

    await agentConfigService.updateStats('goal-conversation-agent', 0, duration, false);

    return {
      success: false,
      error: error.message || 'Unknown error',
      userVisible: '抱歉，我刚才走神了，能再说一遍吗？',
      internal: {
        core: {
          stage: 'understanding',
          confidence: 0,
          isCompleted: false
        },
        ext: {
          goalConversation: {
            understanding: input.metadata?.previousUnderstanding || {},
            nextQuestions: [],
            collected: {}
          }
        }
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'goal-conversation-agent',
        agentName: '目标对话Agent',
        agentType: 'custom',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

export async function runGoalConversationAgent(params: {
  input: string;
  userId: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  previousUnderstanding?: any;
  previousStage?: string;
  previousState?: GoalConversationStateSnapshot;
  maxFormatRetries?: number;
  allowInvalidStructuredOutput?: boolean;
  systemPromptOverride?: string;
  confirmProposal?: boolean;
}): Promise<GoalConversationAgentResult> {
  const result = await goalConversationAgentHandler(
    {
      type: 'custom',
      goal: params.input,
        metadata: {
          userId: params.userId,
          previousUnderstanding: params.previousUnderstanding,
          previousStage: params.previousStage,
          previousState: params.previousState,
          confirmProposal: params.confirmProposal === true
        }
    },
    {
      userId: params.userId,
      conversationHistory: params.conversationHistory || []
    } as AgentContext,
    {
      maxFormatRetries: params.maxFormatRetries,
      allowInvalidStructuredOutput: params.allowInvalidStructuredOutput,
      systemPromptOverride: params.systemPromptOverride
    }
  );

  if (!result.success || !result.internal) {
    const errorMessage = typeof result.error === 'string' ? result.error : result.error?.message;
    if (errorMessage === 'STRUCTURED_OUTPUT_INVALID' && result.internal) {
      return {
        userVisible: result.userVisible || '',
        internal: result.internal as GoalConversationInternal,
        debug: {
          attemptCount: Number(result.debug?.attemptCount || 0),
          actualRetryCount: Number(result.debug?.actualRetryCount || 0),
          formatFailureCount: Number(result.debug?.formatFailureCount || 0),
          parseMode: (result.debug?.parseMode || 'none') as StructuredParseResult['parseMode'],
          failureType: (result.debug?.failureType || 'missing_json_block') as GoalStructuredFailureType,
          violations: Array.isArray(result.debug?.violations) ? result.debug?.violations as string[] : [],
          promptVersion: Number(result.debug?.promptVersion || 0),
          requestMessages: Array.isArray(result.debug?.requestMessages)
            ? result.debug?.requestMessages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
            : [],
          attempts: Array.isArray(result.debug?.attempts)
            ? result.debug?.attempts as RetryAttemptInfo[]
            : [],
          structuredOutputValid: false
        }
      };
    }
    throw new Error(errorMessage || 'Goal conversation agent failed');
  }

  return {
    userVisible: result.userVisible || '',
    internal: result.internal as GoalConversationInternal,
    debug: {
      attemptCount: Number(result.debug?.attemptCount || 0),
      actualRetryCount: Number(result.debug?.actualRetryCount || 0),
      formatFailureCount: Number(result.debug?.formatFailureCount || 0),
      parseMode: (result.debug?.parseMode || 'none') as StructuredParseResult['parseMode'],
      failureType: (result.debug?.failureType || 'none') as GoalStructuredFailureType,
      violations: Array.isArray(result.debug?.violations) ? result.debug?.violations as string[] : [],
      promptVersion: Number(result.debug?.promptVersion || 0),
      requestMessages: Array.isArray(result.debug?.requestMessages)
        ? result.debug?.requestMessages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
        : [],
      attempts: Array.isArray(result.debug?.attempts)
        ? result.debug?.attempts as RetryAttemptInfo[]
        : [],
      structuredOutputValid: result.debug?.structuredOutputValid === true
    }
  };
}
