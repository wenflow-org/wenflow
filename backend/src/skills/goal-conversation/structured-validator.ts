export type GoalStructuredParseMode = 'json-marker' | 'code-fence' | 'raw-json' | 'none';

export type GoalStructuredFailureType =
  | 'none'
  | 'missing_json_block'
  | 'json_parse_error'
  | 'invalid_top_level_keys'
  | 'missing_required_fields'
  | 'invalid_stage'
  | 'invalid_goal_payload';

export interface StructuredParseResult {
  parsedJson: any | null;
  dialogueText: string;
  parseMode: GoalStructuredParseMode;
  /** 检测到 JSON 片段但解析失败（失败归因：json_parse_error vs missing_json_block） */
  parseError: boolean;
}

export interface StructuredValidationResult {
  valid: boolean;
  parseMode: GoalStructuredParseMode;
  parsedJson: any | null;
  dialogueText: string;
  failureType: GoalStructuredFailureType;
  violations: string[];
}

// JSON 提取核心（3 级策略 + 不完整 JSON 修复 + 对话文本拆分）已提升至 composers/json-extractor.ts（2026-08 去重合并）
import { extractStructuredPayloadWithDialogue } from '../../composers/json-extractor';
import type { StructuredPayloadParseResult } from '../../composers/json-extractor';

export type { StructuredPayloadParseResult };

/**
 * 从 LLM 原始响应中提取结构化 JSON 与对话正文。
 * 复用共享核心（raw-trailing → code-fence → JSON: marker），行为与原实现一致。
 */
export function extractStructuredPayload(content: string): StructuredParseResult {
  const result = extractStructuredPayloadWithDialogue(content);
  return {
    parsedJson: result.parsedJson,
    dialogueText: result.dialogueText,
    parseMode: result.parseMode as GoalStructuredParseMode,
    parseError: result.parseError,
  };
}

export function validateGoalConversationStructuredOutput(
  content: string,
  options: { deltaMode?: boolean } = {}
): StructuredValidationResult {
  // 允许新版扁平结构（understanding/nextQuestions/...直接在顶层）和旧版包装结构（goalConversation 包装层）
  const allowedTopLevelKeys = new Set([
    'reply', 'state', 'goalConversation', 'hints',
    'understanding', 'nextQuestions', 'quickReplies', 'confirmedProposal', 'confidenceScores', 'structuredData'
  ]);
  const { parsedJson, dialogueText, parseMode, parseError } = extractStructuredPayload(content);

  if (!parsedJson || typeof parsedJson !== 'object') {
    return {
      valid: false,
      parseMode,
      parsedJson: null,
      dialogueText,
      failureType: parseError ? 'json_parse_error' : 'missing_json_block',
      violations: parseError
        ? ['检测到 JSON 片段，但未能成功解析']
        : ['响应中未检测到合法的结构化 JSON 输出']
    };
  }

  const stage = parsedJson.stage || parsedJson.state?.stage;
  const confidence = parsedJson.confidence ?? parsedJson.state?.confidence;
  const hasReply = typeof parsedJson.reply === 'string' && parsedJson.reply.trim().length > 0;
  const goalConversation = parsedJson.goalConversation;
  const topLevelKeys = Object.keys(parsedJson);
  const invalidTopLevelKeys = topLevelKeys.filter((key) => !allowedTopLevelKeys.has(key));

  if (invalidTopLevelKeys.length > 0) {
    return {
      valid: false,
      parseMode,
      parsedJson,
      dialogueText,
      failureType: 'invalid_top_level_keys',
      violations: [`存在未允许的顶层字段: ${invalidTopLevelKeys.join(', ')}`]
    };
  }

  if (parsedJson.hints !== undefined) {
    return {
      valid: false,
      parseMode,
      parsedJson,
      dialogueText,
      failureType: 'invalid_top_level_keys',
      violations: ['新版结构化输出不应包含 hints；quickReplies 直接放在顶层']
    };
  }

  // reply + state 在新旧两版都必需；Delta 模式（§5.4）下 state 缺席合法（缺席=不变）
  const stateRequired = !options.deltaMode;
  if (!hasReply || (stateRequired && (!parsedJson.state || typeof parsedJson.state !== 'object'))) {
    const missing: string[] = [];
    if (!hasReply) missing.push('reply');
    if (stateRequired && (!parsedJson.state || typeof parsedJson.state !== 'object')) missing.push('state');
    return {
      valid: false,
      parseMode,
      parsedJson,
      dialogueText,
      failureType: 'missing_required_fields',
      violations: [`缺少必要字段: ${missing.join(', ')}`]
    };
  }
  if (parsedJson.state !== undefined && (typeof parsedJson.state !== 'object' || parsedJson.state === null)) {
    return {
      valid: false,
      parseMode,
      parsedJson,
      dialogueText,
      failureType: 'missing_required_fields',
      violations: ['state 必须是对象（Delta 模式下可整体缺席）']
    };
  }

  // 兼容新旧两版结构：新版 understanding 等字段在顶层；旧版在 goalConversation 包装层；
  // 同时兼容模型按输入 shape 回写、把 understanding/nextQuestions 嵌进 state 的情况（统一协议 v2 止血）。
  // 优先级：顶层 > goalConversation 包装 > state.xxx
  const payload: any = goalConversation || parsedJson;
  const hasUnderstanding =
    (payload.understanding && typeof payload.understanding === 'object')
    || (parsedJson.state?.understanding && typeof parsedJson.state.understanding === 'object');
  const hasNextQuestions =
    Array.isArray(payload.nextQuestions)
    || Array.isArray(parsedJson.state?.nextQuestions);

  if (!hasUnderstanding && !options.deltaMode) {
    return {
      valid: false,
      parseMode,
      parsedJson,
      dialogueText,
      failureType: 'missing_required_fields',
      violations: ['缺少 understanding 对象 (查找位置：顶层 | goalConversation.understanding | state.understanding)']
    };
  }
  if (!hasNextQuestions) {
    return {
      valid: false,
      parseMode,
      parsedJson,
      dialogueText,
      failureType: 'missing_required_fields',
      violations: ['缺少 nextQuestions 数组 (查找位置：顶层 | goalConversation.nextQuestions | state.nextQuestions)']
    };
  }

  // Delta 模式：state 缺席时整体跳过；state 存在时按字段出现校验（缺席=不变，由合并层回填 previous）
  const statePresent = parsedJson.state && typeof parsedJson.state === 'object';
  if (!options.deltaMode) {
    if (!['understanding', 'proposing', 'ready'].includes(stage)) {
      return {
        valid: false,
        parseMode,
        parsedJson,
        dialogueText,
        failureType: 'invalid_stage',
        violations: ['state.stage 必须是 understanding / proposing / ready 之一']
      };
    }

    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      return {
        valid: false,
        parseMode,
        parsedJson,
        dialogueText,
        failureType: 'missing_required_fields',
        violations: ['state.confidence 必须是合法数字']
      };
    }
  } else if (statePresent) {
    if (parsedJson.state.stage !== undefined && !['understanding', 'proposing', 'ready'].includes(parsedJson.state.stage)) {
      return {
        valid: false,
        parseMode,
        parsedJson,
        dialogueText,
        failureType: 'invalid_stage',
        violations: ['state.stage 必须是 understanding / proposing / ready 之一']
      };
    }
    if (parsedJson.state.confidence !== undefined
      && (typeof parsedJson.state.confidence !== 'number' || !Number.isFinite(parsedJson.state.confidence))) {
      return {
        valid: false,
        parseMode,
        parsedJson,
        dialogueText,
        failureType: 'missing_required_fields',
        violations: ['state.confidence 必须是合法数字']
      };
    }
  }

  return {
    valid: true,
    parseMode,
    parsedJson,
    dialogueText,
    failureType: 'none',
    violations: []
  };
}

export function hasValidStructuredPayload(content: string): boolean {
  return validateGoalConversationStructuredOutput(content).valid;
}
