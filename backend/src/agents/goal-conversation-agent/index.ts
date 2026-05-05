import { agentConfigService } from '../../services/agentConfig.service';
import aiService from '../../services/ai/ai.service';
import { logger } from '../../utils/logger';
import {
  AgentContext,
  AgentDefinition,
  AgentInput,
  AgentOutput
} from '../protocol';

export interface QuickReply {
  text: string;
  icon?: string;
}

export interface GoalConversationInternal {
  core: {
    stage: 'understanding' | 'proposing' | 'ready' | 'completed';
    confidence: number;
    isCompleted: boolean;
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
}

interface StageControlOptions {
  latestUserInput?: string;
  previousStage?: 'understanding' | 'proposing' | 'ready' | 'completed' | string;
  previousConfidence?: number;
}

interface StructuredParseResult {
  parsedJson: any | null;
  dialogueText: string;
  parseMode: 'json-marker' | 'code-fence' | 'raw-json' | 'none';
}

const DEFAULT_SYSTEM_PROMPT = `你是学习规划顾问"小智"。

你的任务是通过自然对话澄清学习需求，不直接提供业务咨询方案。

主体规则（关键）：
- 默认始终面向提问者本人进行规划。
- 即使用户提到“孩子/团队/他人”，也要转化为“提问者本人需要学习和执行什么”，不要把方案主体切换为第三方。
- 你的问题与建议必须可由提问者直接执行。

阶段说明：
- understanding：继续澄清问题与场景
- proposing：给出方向轮廓并请求确认
- ready：用户已确认，可进入生成学习路径

行为规则：
1. 每次最多问 1 个核心问题，避免连续追问。
2. proposing 只给方向/阶段轮廓/学习方式，不给详细周计划。
3. ready 只做确认，不展开完整学习路径正文。
4. 不编造用户没有提供的信息。
5. 所有规划默认针对提问者本人，不输出第三方作为主要学习执行者的计划。
6. 在 understanding 阶段，reply 必须先用 1-2 句总结“你已理解用户刚刚说了什么”，再解释“为什么要问下一个问题”，最后只提出 1 个关键问题。
7. 提问语气不能像问卷或审问，优先使用“为了判断第一版路径怎么收边界/先从哪里开始，我先确认一个关键点”这类自然过渡。

阶段推进门槛（通用，必须满足）：
- 在进入 proposing 前，必须收齐以下 6 项关键信息：
  1) surface_goal（表面目标，保留用户原话）
  2) real_problem（真实问题，使用“场景+阻碍+影响”的具体句）
  3) current_baseline（当前基础，且至少包含 1 条行为证据）
  4) available_resources（可投入资源，至少包含 time_horizon）
  5) constraints_and_boundaries（约束与边界：不可接受结果、硬约束、禁区）
  6) success_criteria（成功标准：时间窗+可观察结果+验收条件）
- 若任一项缺失、模糊或仅占位，state.stage 必须保持 understanding。
- 每轮只问 1 个问题，并优先追问当前最大信息缺口。

时间处理规则（通用）：
- time_horizon 只作简短参考，允许："半天"、"1天"、"2天"、"3-7天"、"1-2周"、"1个月+"、"未明确"。
- 后续规划必须是阶段制（stage-based），不要生成按周/月展开的任务表。

输出规则（严格）：
1. 只输出一个 json fenced code block，不要输出额外说明文本。
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
   - hints: { quickReplies?: Array<{ text: string, icon?: string }> }
3. 禁止输出平台字段：success/schemaVersion/metadata/internal/renderHints/error/output。

参考模板：
\`\`\`json
{
  "reply": "我先确认一个关键点：你最常处理的是哪类 Excel 报表？",
  "state": {
    "stage": "understanding",
    "confidence": 0.3,
    "done": false
  },
  "goalConversation": {
    "understanding": {
      "surface_goal": "用 Python 自动化处理 Excel 报表",
      "real_problem": "每天处理报表耗时，需要自动化",
      "current_baseline": {
        "level": "",
        "evidence": ""
      },
      "available_resources": {
        "time_horizon": "",
        "time_budget": ""
      },
      "constraints_and_boundaries": [],
      "success_criteria": {
        "time_window": "",
        "observable_result": "",
        "acceptance_check": ""
      },
      "motivation": "提高效率",
      "urgency": "中",
      "pain_points": "重复操作耗时",
      "background": {
        "current_level": "",
        "available_time": "",
        "expected_time": "",
        "constraints": [],
        "strengths": []
      }
    },
    "nextQuestions": ["你最头疼的 Excel 操作是什么？"],
    "quickReplies": ["公式计算", "数据清洗", "图表汇总"]
  },
  "hints": {
    "quickReplies": [{ "text": "公式计算" }, { "text": "数据清洗" }]
  }
}
\`\`\``;

const NON_NEGOTIABLE_RULES = `

══════════════════════════════════════════════════════════════
【最高优先级覆盖规则】
══════════════════════════════════════════════════════════════

以下规则优先级高于任何旧版本 prompt、示例或历史描述：

1. 你绝对不能在对话阶段直接输出“完整学习路径”“详细周计划”“阶段一/阶段二的完整执行方案”。
2. 当 stage="ready" 时，你只能做短确认，例如：
   - 已收到确认
   - 将为用户生成详细学习路径
   - 可以去查看路径
   绝对不要自己展开完整路径正文。
3. 当 stage="proposing" 时，必须给出简短确认方案，并优先提供 quick_replies。
4. 不要输出“第一段：”“第二段：”这类标签。
5. 如果旧规则里写了“阶段5输出完整路径”，该规则作废，必须忽略。
6. 结构化输出必须使用新结构（单一 JSON 代码块，且仅以下顶层字段）：
   - reply: string
   - state: { stage: "understanding"|"proposing"|"ready", confidence: number, done?: boolean }
    - goalConversation: { understanding, nextQuestions, quickReplies, structuredData, confirmedProposal, confidenceScores }
    - hints: { quickReplies }
    禁止输出平台字段（success/schemaVersion/metadata/internal/renderHints/error/output）。
7. 如果用户表达为“帮孩子/团队提升”，你的提问和方案必须回到提问者本人可执行动作，不得将学习执行主体默认切换到第三方。
8. 进入 proposing 前，必须满足 6 项通用信息闭环；未满足时必须停留在 understanding。
9. time_horizon 允许短周期（如半天、1天、2天）；规划输出必须保持阶段制，禁止按周/月任务表。
`;

function buildEffectivePrompt(configPrompt?: string | null): string {
  if (!configPrompt) {
    return `${DEFAULT_SYSTEM_PROMPT}\n${NON_NEGOTIABLE_RULES}`;
  }

  return `${configPrompt}\n${NON_NEGOTIABLE_RULES}`;
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

function fixIncompleteJson(jsonStr: string): string {
  let fixed = jsonStr.trim();
  const openBraces = (fixed.match(/\{/g) || []).length;
  const closeBraces = (fixed.match(/\}/g) || []).length;
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;

  if (openBraces > closeBraces) fixed += '}'.repeat(openBraces - closeBraces);
  if (openBrackets > closeBrackets) fixed += ']'.repeat(openBrackets - closeBrackets);

  const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) fixed += '"';

  fixed = fixed.replace(/,\s*([}\]])/g, '$1');
  fixed = fixed.replace(/:\s*$/, ': null');
  return fixed;
}

function safeJsonParse(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return JSON.parse(fixIncompleteJson(jsonStr));
  }
}

function extractJsonFromJsonMarker(content: string): { parsedJson: any | null; dialogueText: string } {
  const jsonIndex = content.lastIndexOf('JSON:');
  if (jsonIndex === -1) return { parsedJson: null, dialogueText: content };

  const afterJson = content.substring(jsonIndex + 5).trim();
  let braceCount = 0;
  let jsonStart = -1;
  let jsonEnd = -1;

  for (let i = 0; i < afterJson.length; i++) {
    if (afterJson[i] === '{') {
      if (jsonStart === -1) jsonStart = i;
      braceCount++;
    } else if (afterJson[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  if (jsonStart === -1 || jsonEnd === -1) {
    return { parsedJson: null, dialogueText: content };
  }

  try {
    const parsedJson = safeJsonParse(afterJson.substring(jsonStart, jsonEnd));
    return { parsedJson, dialogueText: content.substring(0, jsonIndex).trim() };
  } catch {
    return { parsedJson: null, dialogueText: content };
  }
}

function extractJsonFromCodeFence(content: string): { parsedJson: any | null; dialogueText: string } {
  const patterns = [/```json\s*([\s\S]*?)\s*```/, /```\s*([\s\S]*?\})\s*```/];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) continue;
    try {
      const parsedJson = safeJsonParse(match[1]);
      return { parsedJson, dialogueText: content.split(match[0])[0].trim() };
    } catch {
      continue;
    }
  }

  return { parsedJson: null, dialogueText: content };
}

function extractRawTrailingJson(content: string): { parsedJson: any | null; dialogueText: string } {
  const rawJsonMatch = content.match(/\{[\s\S]*\}$/);
  if (!rawJsonMatch) return { parsedJson: null, dialogueText: content };

  try {
    const parsedJson = safeJsonParse(rawJsonMatch[0]);
    return {
      parsedJson,
      dialogueText: content.substring(0, content.length - rawJsonMatch[0].length).trim()
    };
  } catch {
    return { parsedJson: null, dialogueText: content };
  }
}

function extractStructuredPayload(content: string): StructuredParseResult {
  let parsedJson: any | null = null;
  let dialogueText = content;

  ({ parsedJson, dialogueText } = extractJsonFromJsonMarker(content));
  if (parsedJson) {
    return { parsedJson, dialogueText, parseMode: 'json-marker' };
  }

  ({ parsedJson, dialogueText } = extractJsonFromCodeFence(content));
  if (parsedJson) {
    return { parsedJson, dialogueText, parseMode: 'code-fence' };
  }

  ({ parsedJson, dialogueText } = extractRawTrailingJson(content));
  if (parsedJson) {
    return { parsedJson, dialogueText, parseMode: 'raw-json' };
  }

  return { parsedJson: null, dialogueText: content, parseMode: 'none' };
}

function hasValidStructuredPayload(content: string): boolean {
  const { parsedJson } = extractStructuredPayload(content);
  if (!parsedJson || typeof parsedJson !== 'object') {
    return false;
  }

  const stage = parsedJson.stage || parsedJson.state?.stage;
  const confidence = parsedJson.confidence ?? parsedJson.state?.confidence;
  const hasReply = typeof parsedJson.reply === 'string';
  const hasGoalConversation = !!parsedJson.goalConversation && typeof parsedJson.goalConversation === 'object';

  const validStage = ['understanding', 'proposing', 'ready'].includes(stage);
  const validConfidence = typeof confidence === 'number' && Number.isFinite(confidence);

  return validStage && validConfidence && hasReply && hasGoalConversation;
}

function normalizeDialogueText(text: string): string {
  return text
    .replace(/^第一段[：:]/m, '')
    .replace(/^第二段[：:].*$/m, '')
    .replace(/```json[\s\S]*$/m, '')
    .trim();
}

function enforceSingleQuestionForUnderstanding(text: string, stage: 'understanding' | 'proposing' | 'ready'): string {
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

  const topLevelKeys = ['surface_goal', 'real_problem', 'motivation', 'urgency', 'pain_points'];
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
  stage: 'understanding' | 'proposing' | 'ready',
  confidence: number,
  options?: StageControlOptions
): { stage: 'understanding' | 'proposing' | 'ready'; confidence: number } {
  const STAGE_CAPS = {
    understanding: 0.92,
    proposing: 0.95,
    ready: 0.98
  };

  let normalizedStage = stage;
  let normalizedConfidence = Number.isFinite(confidence) ? confidence : 0.2;

  const latestUserInput = (options?.latestUserInput || '').trim();
  const previousStage = options?.previousStage;

  const confirmIntent = /^(好|好的|行|可以|是的|对|确认|就这样|没问题|开始生成|生成学习路径|可以生成)/i.test(
    latestUserInput
  );
  const adjustIntent = /(调整|修改|换个方向|再想想|先不要|不对)/.test(latestUserInput);

  if (previousStage === 'proposing' && confirmIntent && !adjustIntent) {
    normalizedStage = 'ready';
  }

  const cap = STAGE_CAPS[normalizedStage] || 0.92;
  normalizedConfidence = Math.min(normalizedConfidence, cap);
  normalizedConfidence = Math.max(normalizedConfidence, 0.15);

  return {
    stage: normalizedStage,
    confidence: Math.min(normalizedConfidence, 0.99)
  };
}

function parseGoalConversationResponse(
  content: string,
  previousUnderstanding?: any,
  stageControlOptions?: StageControlOptions
): GoalConversationAgentResult {
  const { parsedJson, dialogueText: extractedDialogueText } = extractStructuredPayload(content);
  let dialogueText = extractedDialogueText;

  let stage: 'understanding' | 'proposing' | 'ready' = 'understanding';
  let quickReplies: QuickReply[] = [];
  let structuredData: any = undefined;
  let confirmedProposal: any = undefined;
  let confidenceScores: any = undefined;
  let nextQuestions: string[] = [];
  let understanding = { ...(previousUnderstanding || {}) };

  if (parsedJson) {
    const normalizedPayload = parsedJson.goalConversation || {};
    understanding = mergeUnderstanding(previousUnderstanding, normalizedPayload);
    const validStages = ['understanding', 'proposing', 'ready'];
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
        isCompleted: stage === 'ready'
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

async function callAIWithRetry(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { temperature?: number; maxTokens?: number; model?: string },
  userId?: string,
  maxRetries: number = 2
): Promise<{ content: string; retryCount: number }> {
  let lastContent = '';
  let retryCount = 0;

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

    if (hasValidStructuredPayload(response.content)) {
      return { content: response.content, retryCount: attempt };
    }

    retryCount = attempt + 1;
    const parseInfo = extractStructuredPayload(response.content);
    logger.warn('GoalConversationAgent 输出不完整，准备重试', {
      attempt: attempt + 1,
      maxRetries,
      parseMode: parseInfo.parseMode,
      contentPreview: response.content.substring(0, 200)
    });

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  logger.warn(`GoalConversationAgent 重试 ${maxRetries} 次后仍不完整，使用最后一次响应`);
  return { content: lastContent, retryCount };
}

export async function goalConversationAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  const userId = context.userId;

  try {
    const config =
      await agentConfigService.getActivePrompt('goal-conversation-agent')
      || await agentConfigService.getActivePrompt('goal-conversation');
    const systemPrompt = buildEffectivePrompt(config?.systemPrompt);
    const history = (context.conversationHistory || [])
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({ role: msg.role as 'user' | 'assistant', content: msg.content }));

    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...history,
      { role: 'user' as const, content: input.goal }
    ];

    const { content, retryCount } = await callAIWithRetry(
      chatMessages,
      {
        temperature: config?.temperature ?? 0.7,
        maxTokens: config?.maxTokens ?? 1500
      },
      userId,
      2
    );

    const previousUnderstanding = input.metadata?.previousUnderstanding;
    const result = parseGoalConversationResponse(content, previousUnderstanding, {
      latestUserInput: input.goal,
      previousStage: input.metadata?.previousStage,
      previousConfidence: previousUnderstanding?.confidence || 0.2
    });
    const duration = Date.now() - startTime;

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
        retryCount
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
}): Promise<GoalConversationAgentResult> {
  const result = await goalConversationAgentHandler(
    {
      type: 'custom',
      goal: params.input,
      metadata: {
        userId: params.userId,
        previousUnderstanding: params.previousUnderstanding,
        previousStage: params.previousStage
      }
    },
    {
      userId: params.userId,
      conversationHistory: params.conversationHistory || []
    } as AgentContext
  );

  if (!result.success || !result.internal) {
    const errorMessage = typeof result.error === 'string' ? result.error : result.error?.message;
    throw new Error(errorMessage || 'Goal conversation agent failed');
  }

  return {
    userVisible: result.userVisible || '',
    internal: result.internal as GoalConversationInternal
  };
}
