/**
 * DataMappingAgent - 数据字段映射Agent
 *
 * 功能：将AI返回的各种格式JSON映射到标准的数据库字段
 *
 * 用途：
 * - Arena演练场：将Agent输出映射到数据库表字段
 * - 目标对话：将用户画像映射到LearningPath表
 * - 其他场景：统一的数据转换
 */

import aiService from '../../services/ai/ai.service';
import { logger } from '../../utils/logger';

// 映射配置接口
export interface MappingConfig {
  sourceData: any;           // 原始数据（可能包含rawContent）
  targetSchema: FieldMapping[]; // 目标字段映射配置
  fallbackToRaw?: boolean;   // 是否在映射失败时使用rawContent
}

// 字段映射配置
export interface FieldMapping {
  targetField: string;       // 目标字段名
  sourcePath?: string;       // 源数据路径（如"rawContent.name"）
  defaultValue?: any;        // 默认值
  required?: boolean;        // 是否必需
  transform?: (value: any) => any; // 值转换函数
}

// 映射结果（新格式：分离 userVisible 和 internal）
export interface MappingResult {
  success: boolean;
  /** @deprecated 使用 internal 替代 */
  data?: any;
  /** 内部结构化数据（映射后的数据） */
  internal: any;
  /** 用户可见的消息 */
  userVisible?: string;
  errors: string[];
  warnings: string[];
  mappingDetails: Record<string, { source: string; value: any }>;
}

// Persona字段映射配置（标准）
const PERSONA_FIELD_MAPPING: FieldMapping[] = [
  { targetField: 'surfaceGoal', sourcePath: 'surfaceGoal', defaultValue: '', required: true },
  { targetField: 'realProblem', sourcePath: 'realProblem', defaultValue: '', required: true },
  { targetField: 'level', sourcePath: 'level', defaultValue: '入门', required: true },
  { targetField: 'timePerDay', sourcePath: 'timePerDay', defaultValue: '1-2小时', required: true },
  { targetField: 'totalWeeks', sourcePath: 'totalWeeks', defaultValue: '8周', required: true },
  { targetField: 'motivation', sourcePath: 'motivation', defaultValue: '', required: true },
  { targetField: 'urgency', sourcePath: 'urgency', defaultValue: '中', required: true },
  { targetField: 'realScenario', sourcePath: 'realScenario', defaultValue: {}, required: false },
  { targetField: 'thinkingBlocks', sourcePath: 'thinkingBlocks', defaultValue: [], required: false },
  { targetField: 'analogyMaterials', sourcePath: 'analogyMaterials', defaultValue: { work: [], hobbies: [], priorSkills: [] }, required: false },
  { targetField: 'successPatterns', sourcePath: 'successPatterns', defaultValue: { bestLearningContext: '', motivationTriggers: [] }, required: false },
  { targetField: 'background', sourcePath: 'background', defaultValue: {}, required: false },
  { targetField: 'personality', sourcePath: 'personality', defaultValue: {}, required: false },
  { targetField: 'scenario', sourcePath: 'scenario', defaultValue: {}, required: false },
];

export class DataMappingAgent {
  private temperature = 0.3;
  private maxTokens = 2000;

  /**
   * 使用AI进行智能映射
   */
  async mapWithAI(config: MappingConfig): Promise<MappingResult> {
    const result: MappingResult = {
      success: false,
      internal: {},
      errors: [],
      warnings: [],
      mappingDetails: {}
    };

    try {
      // 第一步：尝试从rawContent中提取JSON
      let sourceData = config.sourceData;

      if (sourceData.rawContent) {
        try {
          // 解析rawContent中的JSON
          const extracted = this.extractJSONFromRaw(sourceData.rawContent);
          if (extracted) {
            sourceData = { ...sourceData, ...extracted };
            result.warnings.push('从rawContent中提取了JSON数据');
          }
        } catch (e) {
          result.errors.push(`rawContent解析失败: ${e}`);
        }
      }

      // 第二步：使用AI进行智能映射
      const mappingPrompt = this.buildMappingPrompt(sourceData, config.targetSchema);

      const response = await aiService.chat([
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: mappingPrompt }
      ], { temperature: this.temperature, maxTokens: this.maxTokens });

      // 第三步：解析AI返回的映射结果
      const mappingResult = this.parseMappingResponse(response.content);

      if (mappingResult) {
        result.internal = mappingResult;
        result.data = mappingResult; // 保持向后兼容
        result.success = true;
        result.userVisible = `数据映射完成，共映射 ${Object.keys(mappingResult).length} 个字段`;

        // 记录映射详情
        config.targetSchema.forEach(field => {
          const value = result.internal[field.targetField];
          result.mappingDetails[field.targetField] = {
            source: field.sourcePath || 'AI推断',
            value: value
          };
        });
      } else {
        result.errors.push('AI映射结果解析失败');
      }

    } catch (error: any) {
      result.errors.push(`映射失败: ${error.message}`);
      logger.error('DataMappingAgent错误', error);
    }

    return result;
  }

  /**
   * 从rawContent中提取JSON
   */
  private extractJSONFromRaw(rawContent: string): any {
    let content = rawContent.trim();

    // 清理markdown代码块
    if (content.includes('```')) {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match && match[1]) {
        content = match[1].trim();
      }
    }

    return JSON.parse(content);
  }

  /**
   * 构建映射Prompt
   */
  private buildMappingPrompt(sourceData: any, targetSchema: FieldMapping[]): string {
    const schemaDescription = targetSchema.map(field => {
      return `- ${field.targetField}${field.required ? ' (必需)' : ''}: ${field.defaultValue !== undefined ? `默认值: ${JSON.stringify(field.defaultValue)}` : '从源数据推断'}`;
    }).join('\n');

    return `
请将以下数据映射到指定的字段格式。

【源数据】
\`\`\`json
${JSON.stringify(sourceData, null, 2)}
\`\`\`

【目标字段格式】
${schemaDescription}

【映射规则】
1. 优先从源数据的直接字段中提取
2. 如果源数据中没有，尝试从上下文推断
3. 使用提供的默认值作为最后手段
4. 保持数据的原始类型（字符串、数组、对象等）
5. 必需字段不能为空

【输出格式】
返回一个JSON对象，包含所有目标字段。
`;
  }

  /**
   * System Prompt
   */
  private getSystemPrompt(): string {
    return `你是数据映射专家。你的任务是将AI生成的各种格式数据映射到标准化的数据库字段。

【核心能力】
- 识别并提取源数据中的关键信息
- 将不同格式的数据转换为统一的结构
- 智能推断缺失的字段值
- 保持数据的完整性和准确性

【工作原则】
1. 准确性优先：确保映射结果准确反映原始数据
2. 完整性：必需字段必须填写
3. 一致性：使用统一的数据格式
4. 智能推断：当数据缺失时，基于上下文合理推断

【输出要求】
- 只返回JSON格式
- 包含所有要求的字段
- 不要添加额外的解释或注释`;
  }

  /**
   * 解析AI映射响应
   */
  private parseMappingResponse(content: string): any {
    try {
      let cleanedContent = content.trim();

      // 清理markdown代码块
      if (cleanedContent.includes('```')) {
        const match = cleanedContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match && match[1]) {
          cleanedContent = match[1].trim();
        }
      }

      return JSON.parse(cleanedContent);
    } catch (e) {
      logger.error('映射响应解析失败', { content: content.substring(0, 500) });
      return null;
    }
  }

  /**
   * 快速映射Persona数据（使用AI）
   */
  async mapPersona(sourceData: any): Promise<MappingResult> {
    return this.mapWithAI({
      sourceData,
      targetSchema: PERSONA_FIELD_MAPPING,
      fallbackToRaw: true
    });
  }

  /**
   * 快速映射Extraction数据（使用AI）
   */
  async mapExtraction(sourceData: any): Promise<MappingResult> {
    const extractionSchema: FieldMapping[] = [
      { targetField: 'surfaceGoal', sourcePath: 'surfaceGoal', defaultValue: '', required: true },
      { targetField: 'realProblem', sourcePath: 'realProblem', defaultValue: '', required: true },
      { targetField: 'level', sourcePath: 'level', defaultValue: '入门', required: true },
      { targetField: 'timePerDay', sourcePath: 'timePerDay', defaultValue: '1-2小时', required: true },
      { targetField: 'totalWeeks', sourcePath: 'totalWeeks', defaultValue: '8周', required: true },
      { targetField: 'motivation', sourcePath: 'motivation', defaultValue: '', required: true },
      { targetField: 'urgency', sourcePath: 'urgency', defaultValue: '中', required: true },
      { targetField: 'completenessScore', sourcePath: 'completenessScore', defaultValue: 0, required: false },
      { targetField: 'missingFields', sourcePath: 'missingFields', defaultValue: [], required: false },
      { targetField: 'followUpQuestions', sourcePath: 'followUpQuestions', defaultValue: [], required: false },
      { targetField: 'realScenario', sourcePath: 'realScenario', defaultValue: {}, required: false },
      { targetField: 'thinkingBlocks', sourcePath: 'thinkingBlocks', defaultValue: [], required: false },
      { targetField: 'analogyMaterials', sourcePath: 'analogyMaterials', defaultValue: { work: [], hobbies: [], priorSkills: [] }, required: false },
      { targetField: 'successPatterns', sourcePath: 'successPatterns', defaultValue: { bestLearningContext: '', motivationTriggers: [] }, required: false },
      { targetField: 'thinkingInspiredMetrics', sourcePath: 'thinkingInspiredMetrics', defaultValue: { scenarioSpecificity: 0, analogyRichness: 0, thinkingBlockClarity: 0, overallThinkingScore: 0 }, required: false },
    ];

    return this.mapWithAI({
      sourceData,
      targetSchema: extractionSchema,
      fallbackToRaw: true
    });
  }
}

export default new DataMappingAgent();