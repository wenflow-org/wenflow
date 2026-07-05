interface PromptLabManifestLike {
  skillId: string;
  agentId: string;
  name: string;
  archetype: string;
  description: string;
}

interface SourceSection {
  title: string;
  content: string;
  root: 'DEFINITIONS' | 'EXECUTION' | null;
}

export interface PromptLabCompileResult {
  prompt: string;
  stats: {
    lines: number;
    chars: number;
  };
  diagnostics: {
    warnings: string[];
  };
}

function normalizeNewlines(value: string) {
  return value.replace(/\r\n/g, '\n');
}

function parseSections(source: string): SourceSection[] {
  const lines = normalizeNewlines(source).split('\n');
  const sections: SourceSection[] = [];
  let currentRoot: SourceSection['root'] = null;
  let currentTitle: string | null = null;
  let contentLines: string[] = [];

  const flush = () => {
    if (!currentTitle) return;
    sections.push({
      title: currentTitle,
      content: contentLines.join('\n').trim(),
      root: currentRoot
    });
    currentTitle = null;
    contentLines = [];
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      flush();
      const rootTitle = h1[1].trim().toUpperCase();
      currentRoot = rootTitle === 'DEFINITIONS' || rootTitle === 'EXECUTION'
        ? rootTitle as SourceSection['root']
        : null;
      continue;
    }

    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flush();
      currentTitle = h2[1].trim();
      continue;
    }

    if (currentTitle) {
      contentLines.push(line);
    }
  }

  flush();
  return sections;
}

function findSection(sections: SourceSection[], title: string) {
  const lower = title.toLowerCase();
  return sections.find((section) => section.title.toLowerCase() === lower)?.content.trim() || '';
}

function cleanQuotedJsonLike(value: string) {
  return value
    .replace(/\\json/g, '```json')
    .replace(/\\/g, '```')
    .replace(/""/g, '"');
}

function extractJsonBlock(value: string) {
  const cleaned = cleanQuotedJsonLike(value);
  const fenced = cleaned.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  return '';
}

function tryParseJson(value: string) {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function inferPrimitiveFromType(typeValue: string) {
  const normalized = typeValue.trim().toLowerCase();
  if (normalized.includes('array') || normalized.endsWith('[]')) return [];
  if (normalized.includes('string')) return 'string';
  if (normalized.includes('number') || normalized.includes('int') || normalized.includes('float')) return 0;
  if (normalized.includes('boolean') || normalized === 'bool') return false;
  if (normalized.includes('object')) return {};
  return 'string';
}

function parseMarkdownTable(content: string) {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const tableLines = lines.filter((line) => line.startsWith('|') && line.endsWith('|'));
  if (tableLines.length < 2) return [] as Array<Record<string, string>>;

  const headers = tableLines[0].split('|').slice(1, -1).map((cell) => cell.trim());
  const bodyLines = tableLines.slice(2);
  return bodyLines.map((line) => {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = cells[index] || '';
      return record;
    }, {});
  });
}

function buildInputSkeleton(inputContent: string) {
  const rows = parseMarkdownTable(inputContent);
  const result: Record<string, any> = {};
  for (const row of rows) {
    const field = row.field || row.Field || row.name || '';
    const type = row.type || row.Type || 'string';
    if (!field) continue;
    result[field] = inferPrimitiveFromType(type);
  }
  return result;
}

function buildOutputSkeleton(outputContent: string) {
  const lines = outputContent.split('\n');
  const result: Record<string, any> = {};
  let hasTopLevelHeadings = false;

  for (const line of lines) {
    const heading = line.match(/^###\s+([^·]+)·\s*(.+)$/);
    if (!heading) continue;
    hasTopLevelHeadings = true;
    const field = heading[1].trim();
    const type = heading[2].trim();
    result[field] = inferPrimitiveFromType(type);
  }

  if (hasTopLevelHeadings) {
    return result;
  }

  const extracted = extractJsonBlock(outputContent);
  const parsed = tryParseJson(extracted);
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }

  return result;
}

function stringifyJsonBlock(value: any) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function splitParagraphs(value: string) {
  return value
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function joinNonEmpty(parts: string[]) {
  return parts.filter(Boolean).join('\n\n').trim();
}

function collectTopLevelOutputFields(outputContent: string) {
  return outputContent
    .split('\n')
    .map((line) => line.match(/^###\s+([^·]+)·\s*(.+)$/))
    .filter(Boolean)
    .map((match) => (match as RegExpMatchArray)[1].trim());
}

function diagnoseGoalConversationOutput(outputContent: string) {
  const warnings: string[] = [];
  const topLevelFields = new Set(collectTopLevelOutputFields(outputContent));
  const mustHave = ['reply', 'state', 'understanding', 'nextQuestions', 'quickReplies', 'confirmedProposal', 'confidenceScores'];

  for (const field of mustHave) {
    if (!topLevelFields.has(field)) {
      warnings.push(`goal 阶段缺少关键顶层字段：${field}`);
    }
  }

  if (/###\s+hints\b/i.test(outputContent) || /\bhints\s*[·:：]/.test(outputContent)) {
    warnings.push('goal 阶段不应继续使用 hints 包装；quickReplies 应直接放在顶层');
  }

  if (/goalConversation\./.test(outputContent) || /goalConversation\s*[:：]/.test(outputContent)) {
    warnings.push('goal 阶段不应将 goalConversation 作为主输出包装层');
  }

  if (/\buserVisible\b/.test(outputContent) || /\bcore\./.test(outputContent)) {
    warnings.push('goal 阶段输出规格不应暴露后端内部 envelope 字段（如 userVisible / core.*）');
  }

  if (/completed/.test(outputContent)) {
    warnings.push('goal 阶段 raw 输出的 state.stage 不应面向 LLM 暴露 completed');
  }

  return warnings;
}

function buildRulesSection(contextHandling: string, stageLogic: string, outputGuidance: string) {
  const parts: string[] = [];

  if (contextHandling) {
    parts.push('### 上下文处理');
    parts.push(contextHandling);
  }

  const stageLogicParagraphs = splitParagraphs(stageLogic);
  if (stageLogicParagraphs.length > 0) {
    parts.push('### 阶段逻辑');
    parts.push(stageLogicParagraphs.join('\n\n'));
  }

  const guidanceParagraphs = splitParagraphs(outputGuidance);
  if (guidanceParagraphs.length > 0) {
    parts.push('### 字段填充');
    parts.push(guidanceParagraphs.join('\n\n'));
  }

  return joinNonEmpty(parts);
}

function buildStateMachineSection(stages: string, stageLogic: string) {
  const parts: string[] = [];
  if (stages) {
    parts.push('### 阶段定义');
    parts.push(stages);
  }
  if (stageLogic) {
    parts.push('### 推进逻辑');
    parts.push(stageLogic);
  }
  return joinNonEmpty(parts);
}

function buildOutputSection(outputSchema: string, outputGuidance: string, format: string) {
  const parts: string[] = [];

  if (format) {
    parts.push('### 格式约束');
    parts.push(format);
  }

  const outputSkeleton = buildOutputSkeleton(outputSchema);
  parts.push('### 输出 JSON 结构');
  parts.push(stringifyJsonBlock(outputSkeleton));

  if (outputSchema.trim()) {
    parts.push('### 字段说明');
    parts.push(outputSchema);
  }

  if (outputGuidance) {
    parts.push('### 填充指导');
    parts.push(outputGuidance);
  }

  return joinNonEmpty(parts);
}

export function compilePromptLabSourceDeterministic(
  source: string,
  manifest: PromptLabManifestLike
): PromptLabCompileResult {
  const sections = parseSections(source);
  const identity = findSection(sections, 'Identity');
  const input = findSection(sections, 'Input');
  const outputSchema = findSection(sections, 'Output Schema');
  const stages = findSection(sections, 'Stages');
  const format = findSection(sections, 'Format');
  const contextHandling = findSection(sections, 'Context Handling');
  const stageLogic = findSection(sections, 'Stage Logic');
  const outputGuidance = findSection(sections, 'Output Guidance');
  const constraints = findSection(sections, 'Constraints');
  const qualityControl = findSection(sections, 'Quality Control');
  const examples = findSection(sections, 'Examples');

  const inputSkeleton = buildInputSkeleton(input);

  const compiled = joinNonEmpty([
    '## 身份定义',
    identity || `你是 ${manifest.description || manifest.name}。`,
    '## 输入说明',
    joinNonEmpty([
      input ? '输入为一个 JSON 对象，包含以下字段：' : '',
      stringifyJsonBlock(inputSkeleton),
      input
    ]),
    '## 执行规则',
    buildRulesSection(contextHandling, stageLogic, outputGuidance),
    stages || manifest.archetype === 'conversational'
      ? joinNonEmpty(['## 状态机', buildStateMachineSection(stages, stageLogic)])
      : '',
    '## 输出规格',
    buildOutputSection(outputSchema, outputGuidance, format),
    '## 边界约束',
    constraints || '无额外边界约束。',
    qualityControl ? joinNonEmpty(['## 质量控制', qualityControl]) : '',
    examples ? joinNonEmpty(['## 示例', examples]) : ''
  ]);

  const finalPrompt = compiled + '\n';
  const displayPrompt = compiled.trimEnd();
  const lines = displayPrompt ? displayPrompt.split('\n').length : 0;
  const chars = displayPrompt.length;
  const warnings: string[] = [];

  if (manifest.skillId === 'goal-conversation' || manifest.agentId === 'skill:goal-conversation') {
    warnings.push(...diagnoseGoalConversationOutput(outputSchema));
  }

  return {
    prompt: finalPrompt,
    stats: { lines, chars },
    diagnostics: { warnings }
  };
}
