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
}

export interface StructuredValidationResult {
  valid: boolean;
  parseMode: GoalStructuredParseMode;
  parsedJson: any | null;
  dialogueText: string;
  failureType: GoalStructuredFailureType;
  violations: string[];
}

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

function extractJsonFromJsonMarker(content: string): { parsedJson: any | null; dialogueText: string; parseError: boolean } {
  const jsonIndex = content.lastIndexOf('JSON:');
  if (jsonIndex === -1) return { parsedJson: null, dialogueText: content, parseError: false };

  const afterJson = content.substring(jsonIndex + 5).trim();
  let braceCount = 0;
  let jsonStart = -1;
  let jsonEnd = -1;

  for (let i = 0; i < afterJson.length; i += 1) {
    if (afterJson[i] === '{') {
      if (jsonStart === -1) jsonStart = i;
      braceCount += 1;
    } else if (afterJson[i] === '}') {
      braceCount -= 1;
      if (braceCount === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  if (jsonStart === -1 || jsonEnd === -1) {
    return { parsedJson: null, dialogueText: content, parseError: false };
  }

  try {
    const parsedJson = safeJsonParse(afterJson.substring(jsonStart, jsonEnd));
    return { parsedJson, dialogueText: content.substring(0, jsonIndex).trim(), parseError: false };
  } catch {
    return { parsedJson: null, dialogueText: content, parseError: true };
  }
}

function extractJsonFromCodeFence(content: string): { parsedJson: any | null; dialogueText: string; parseError: boolean } {
  const patterns = [/```json\s*([\s\S]*?)\s*```/, /```\s*([\s\S]*?\})\s*```/];
  let sawFence = false;

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) continue;
    sawFence = true;
    try {
      const parsedJson = safeJsonParse(match[1]);
      return { parsedJson, dialogueText: content.split(match[0])[0].trim(), parseError: false };
    } catch {
      continue;
    }
  }

  return { parsedJson: null, dialogueText: content, parseError: sawFence };
}

function extractRawTrailingJson(content: string): { parsedJson: any | null; dialogueText: string; parseError: boolean } {
  const rawJsonMatch = content.match(/\{[\s\S]*\}$/);
  if (!rawJsonMatch) return { parsedJson: null, dialogueText: content, parseError: false };

  try {
    const parsedJson = safeJsonParse(rawJsonMatch[0]);
    return {
      parsedJson,
      dialogueText: content.substring(0, content.length - rawJsonMatch[0].length).trim(),
      parseError: false
    };
  } catch {
    return { parsedJson: null, dialogueText: content, parseError: true };
  }
}

export function extractStructuredPayload(content: string): StructuredParseResult {
  let parsedJson: any | null = null;
  let dialogueText = content;

  ({ parsedJson, dialogueText } = extractRawTrailingJson(content));
  if (parsedJson) {
    return { parsedJson, dialogueText, parseMode: 'raw-json' };
  }

  ({ parsedJson, dialogueText } = extractJsonFromCodeFence(content));
  if (parsedJson) {
    return { parsedJson, dialogueText, parseMode: 'code-fence' };
  }

  ({ parsedJson, dialogueText } = extractJsonFromJsonMarker(content));
  if (parsedJson) {
    return { parsedJson, dialogueText, parseMode: 'json-marker' };
  }

  return { parsedJson: null, dialogueText: content, parseMode: 'none' };
}

export function validateGoalConversationStructuredOutput(content: string): StructuredValidationResult {
  const allowedTopLevelKeys = new Set(['reply', 'state', 'goalConversation', 'hints']);
  const jsonMarkerResult = extractJsonFromJsonMarker(content);
  const codeFenceResult = extractJsonFromCodeFence(content);
  const rawJsonResult = extractRawTrailingJson(content);
  const { parsedJson, dialogueText, parseMode } = extractStructuredPayload(content);

  if (!parsedJson || typeof parsedJson !== 'object') {
    const parseError = jsonMarkerResult.parseError || codeFenceResult.parseError || rawJsonResult.parseError;
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
      violations: ['新版结构化输出不应包含 hints；quickReplies 只放在 goalConversation.quickReplies']
    };
  }

  if (!hasReply || !goalConversation || typeof goalConversation !== 'object' || !parsedJson.state || typeof parsedJson.state !== 'object') {
    const missing: string[] = [];
    if (!hasReply) missing.push('reply');
    if (!parsedJson.state || typeof parsedJson.state !== 'object') missing.push('state');
    if (!goalConversation || typeof goalConversation !== 'object') missing.push('goalConversation');
    return {
      valid: false,
      parseMode,
      parsedJson,
      dialogueText,
      failureType: 'missing_required_fields',
      violations: [`缺少必要字段: ${missing.join(', ')}`]
    };
  }

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

  if (!goalConversation.understanding || typeof goalConversation.understanding !== 'object' || !Array.isArray(goalConversation.nextQuestions)) {
    return {
      valid: false,
      parseMode,
      parsedJson,
      dialogueText,
      failureType: 'invalid_goal_payload',
      violations: ['goalConversation.understanding 必须是对象，goalConversation.nextQuestions 必须是数组']
    };
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
