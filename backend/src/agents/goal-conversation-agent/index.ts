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
  understanding: any;
  confidence: number;
  stage: 'understanding' | 'proposing' | 'ready';
  nextQuestions: string[];
  quickReplies?: QuickReply[];
  collected: any;
  structuredData?: any;
  confirmedProposal?: any;
  confidence_scores?: any;
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

const DEFAULT_SYSTEM_PROMPT = `你是学习规划顾问"小智"。

你的职责不是直接给解决方案，而是通过自然对话帮助用户理清真正想学什么，并收集生成学习路径所需的信息。

关键原则：
1. 用户说“我要学 X”，X 往往不是最终要解决的问题，要帮助用户穿透表象。
2. 每次只问 1-2 个关键问题，不要像审问。
3. 当用户已经说出具体场景时，直接确认，不重复追问。
4. 在给出学习路径之前，先给出方向轮廓让用户确认。
5. 你的身份是学习规划顾问，不是咨询师，不直接告诉用户业务怎么做。

对话阶段：
- understanding: 还在收集和澄清信息
- proposing: 已有方向轮廓，等待用户确认
- ready: 用户确认，可以生成详细学习路径

输出规则：
1. 第一部分只输出给用户看的自然对话内容，不要输出“第一段”“第二段”等标签。
2. 第二部分必须在最后输出一个 fenced json 代码块。
3. 如果进入 proposing 阶段，必须给出简短确认方案，不要继续探索。
4. 如果用户明确说“确认”“就这样”“好的，生成学习路径”等，必须进入 ready。
5. 给选项时优先通过 quick_replies 字段提供 2-4 个简短选项。

必须输出：

自然对话内容

\`\`\`json
{
  "understanding": {
    "surface_goal": "用户表面说的目标",
    "real_problem": "真正要解决的问题",
    "motivation": "学习动机",
    "urgency": "高/中/低",
    "pain_points": "当前最头疼的问题",
    "background": {
      "current_level": "当前水平",
      "available_time": "可用时间",
      "expected_time": "期望见效时间",
      "constraints": ["约束"],
      "strengths": ["优势"],
      "deadline": "2026-12-31",
      "deadline_text": "原始时间表达"
    },
    "learning_style": {
      "preferred_format": "视频/阅读/动手/混合",
      "theory_vs_practice": "理论优先/实践优先/平衡",
      "study_rhythm": "集中突击/分散细水长流"
    }
  },
  "stage": "understanding/proposing/ready",
  "confidence": 0.5,
  "next_questions": ["还想确认的问题"],
  "quick_replies": ["选项1", "选项2"],
  "structuredData": {
    "learner": {
      "identity": "本人",
      "relationship": null,
      "skill_level": "beginner"
    },
    "end_user": null,
    "learning_context": {
      "urgency": "normal",
      "motivation": "work"
    }
  },
  "confirmedProposal": {
    "learning_direction": "学习方向",
    "key_stages": ["阶段1", "阶段2"],
    "learning_style": "学习方式"
  },
  "confidence_scores": {
    "understanding": 0.8,
    "learner_identity": 0.8,
    "scenario": 0.8
  }
}
\`\`\`

补充规则：
- proposing 阶段只允许给“方向、阶段轮廓、学习方式”，不能给周计划。
- proposing 阶段必须用一句确认问题收尾：这个方向对吗？如有补充可以告诉我。
- ready 阶段 quick_replies 可以为空。
- 不要编造用户没说的信息。`;

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
      goalConversation: {
        type: 'object',
        properties: {
          userVisible: { type: 'string' },
          internal: { type: 'object' }
        }
      }
    }
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
  let parsedJson: any | null = null;
  let dialogueText = content;

  ({ parsedJson, dialogueText } = extractJsonFromJsonMarker(content));
  if (!parsedJson) ({ parsedJson, dialogueText } = extractJsonFromCodeFence(content));
  if (!parsedJson) ({ parsedJson, dialogueText } = extractRawTrailingJson(content));

  let stage: 'understanding' | 'proposing' | 'ready' = 'understanding';
  let quickReplies: QuickReply[] = [];
  let structuredData: any = undefined;
  let confirmedProposal: any = undefined;
  let confidenceScores: any = undefined;
  let nextQuestions: string[] = [];
  let understanding = { ...(previousUnderstanding || {}) };

  if (parsedJson) {
    understanding = mergeUnderstanding(previousUnderstanding, parsedJson);
    const validStages = ['understanding', 'proposing', 'ready'];
    stage = validStages.includes(parsedJson.stage) ? parsedJson.stage : 'understanding';
    nextQuestions = Array.isArray(parsedJson.next_questions) ? parsedJson.next_questions : [];
    if (Array.isArray(parsedJson.quick_replies)) {
      quickReplies = parsedJson.quick_replies.map((text: string) => ({ text }));
    }
    structuredData = parsedJson.structuredData;
    confirmedProposal = parsedJson.confirmedProposal;
    confidenceScores = parsedJson.confidence_scores;
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
  let confidence = typeof parsedJson?.confidence === 'number'
    ? parsedJson.confidence
    : 0.2;

  const stageControl = normalizeStageAndConfidence(stage, confidence, stageControlOptions);
  stage = stageControl.stage;
  confidence = stageControl.confidence;

  understanding = sanitizeUnderstanding(understanding);

  dialogueText = normalizeDialogueText(dialogueText);
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
      understanding,
      confidence,
      stage,
      nextQuestions,
      quickReplies: quickReplies.length > 0 ? quickReplies : undefined,
      collected: buildCollected(understanding, parsedJson),
      structuredData,
      confirmedProposal,
      confidence_scores: confidenceScores
    }
  };
}

function isResponseComplete(content: string): boolean {
  return content.includes('###END###') || content.includes('```json') || content.includes('JSON:');
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
      action: 'chat'
    });

    lastContent = response.content;

    if (isResponseComplete(response.content)) {
      return { content: response.content, retryCount: attempt };
    }

    retryCount = attempt + 1;
    logger.warn('GoalConversationAgent 输出不完整，准备重试', {
      attempt: attempt + 1,
      maxRetries,
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
): Promise<AgentOutput & { goalConversation?: GoalConversationAgentResult }> {
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
        maxTokens: config?.maxTokens ?? 1500,
        model: config?.model
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
        stage: result.internal.stage,
        quickReplies: result.internal.quickReplies?.length || 0,
        retryCount
      }
    });

    await agentConfigService.updateStats('goal-conversation-agent', config?.version || 0, duration, true);

    return {
      success: true,
      goalConversation: result,
      metadata: {
        agentId: 'goal-conversation-agent',
        agentName: '目标对话Agent',
        agentType: 'custom',
        confidence: result.internal.confidence,
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
      goalConversation: {
        userVisible: '抱歉，我刚才走神了，能再说一遍吗？',
        internal: {
          understanding: input.metadata?.previousUnderstanding || {},
          confidence: 0,
          stage: 'understanding',
          nextQuestions: [],
          collected: {},
          quickReplies: undefined
        }
      },
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

  if (!result.goalConversation) {
    throw new Error(result.error || 'Goal conversation agent failed');
  }

  return result.goalConversation;
}
