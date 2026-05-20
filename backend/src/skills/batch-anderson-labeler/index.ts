/**
 * BatchAndersonLabeler Skill - 批量任务画像
 * 
 * 一次 LLM 调用为所有任务补教学画像，包括：
 * - knowledgeType: 知识类型（factual/conceptual/procedural/metacognitive）
 * - cognitiveLevel: 认知层级（remember/understand/apply/analyze/evaluate/create）
 * - learningObjectives: 学习目标
 * - coreConcept: 核心概念
 * - transferable: 可迁移性
 */

import {
  SkillDefinition,
  SkillExecutionResult
} from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';

export const batchAndersonLabelerDefinition: SkillDefinition = {
  name: 'batch-anderson-labeler',
  displayName: '任务画像构建器',
  version: '1.0.0',
  category: 'analysis',
  description: '为 Path 子任务批量补知识维度、认知层次与学习目标画像',
  status: 'working',
  
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: '待标注的任务列表',
        required: true
      },
      goalType: {
        type: 'string',
        description: '目标类型（来自 goal-type-identifier）'
      },
      knowledgeDistribution: {
        type: 'object',
        description: '建议的知识分布（来自 goal-type-identifier）'
      },
      cognitiveFocus: {
        type: 'object',
        description: '建议的认知层级分布（来自 goal-type-identifier）'
      }
    }
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        description: '标注结果列表'
      },
      overallConfidence: {
        type: 'number',
        description: '整体置信度'
      }
    }
  },
  
  capabilities: ['task-profiling', 'anderson-framework', 'educational-tagging'],
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export interface TaskToLabel {
  id: string;
  title: string;
  description?: string;
  week?: number;
  order?: number;
  linkedConcept?: string | null;
}

export interface CognitiveCoreInput {
  cognitiveDomain?: string;
  coreConcepts?: Array<{
    id?: string;
    name?: string;
    role?: string;
    description?: string;
  }>;
}

export interface AndersonLabel {
  taskId: string;
  knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'metacognitive';
  cognitiveLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  learningObjectives: string[];
  coreConcept: string | null;
  resolvedConceptId?: string | null;
  resolvedConceptName?: string | null;
  conceptValidationStatus?: 'resolved' | 'missing' | 'invalid';
  transferable: boolean;
  confidence: number;
}

export interface BatchLabelerInput {
  tasks: TaskToLabel[];
  goalType?: string;
  knowledgeDistribution?: Record<string, number>;
  cognitiveFocus?: Record<string, number>;
  cognitiveCore?: CognitiveCoreInput | null;
}

export interface BatchLabelerOutput {
  labels: AndersonLabel[];
  overallConfidence: number;
}

const BATCH_ANDERSON_LABELER_MAX_TOKENS = 32000;

const BATCH_LABELER_SYSTEM_PROMPT = `你是教育标注专家，使用安德森教育目标分类框架标注学习任务。

【安德森知识类型】
- factual（事实性知识）: 具体事实、数据、术语、定义，如"Python 的基本语法规则"
- conceptual（概念性知识）: 分类、原理、理论、模型、关系，如"面向对象编程的概念"
- procedural（程序性知识）: 技能、算法、技术、方法、步骤，如"如何调试代码"
- metacognitive（元认知知识）: 学习策略、自我认知、反思方法，如"如何评估自己的学习进度"

【认知层级（布鲁姆修订版）】
- remember（记忆）: 识别、回忆事实性知识，如"记住 Python 的关键字"
- understand（理解）: 解释、举例、分类、总结，如"理解面向对象的基本原理"
- apply（应用）: 执行、实施已知方法，如"使用条件语句编写简单程序"
- analyze（分析）: 区分、组织、比较、找出关系，如"分析代码的结构和逻辑"
- evaluate（评价）: 检查、评判、做出决定，如"评估不同解决方案的优劣"
- create（创造）: 生成、规划、生产新内容，如"设计并实现一个完整的功能模块"

【可迁移性】
- transferable=true: 该能力可以迁移到其他领域或场景，如"问题分解思维"
- transferable=false: 该能力仅限于当前领域，如"特定软件的快捷键"

【概念约束】
- 不要自由发明 coreConcept
- 如果任务提供了 linkedConcept，请只围绕该概念引用做教学画像判断
- coreConcept 只是兼容展示字段，应复用已给定概念名；如果无法解析，则置空

【输出格式】
请严格按照以下 JSON 数组格式输出，不要添加任何其他内容：
[
  {
    "taskId": "任务ID",
    "knowledgeType": "知识类型",
    "cognitiveLevel": "认知层级",
    "learningObjectives": ["目标1", "目标2"],
    "transferable": true/false,
    "confidence": 0-1
  }
]

注意：
1. 每个任务必须标注
2. learningObjectives 应具体、可衡量
3. 不要输出自由概念命名；概念解析由平台根据 linkedConcept 与 cognitiveCore 完成
4. confidence 反映标注的确定性`;

export async function batchAndersonLabeler(
  input: BatchLabelerInput
): Promise<SkillExecutionResult<BatchLabelerOutput>> {
  const startTime = Date.now();
  
  try {
    const { tasks, goalType, knowledgeDistribution, cognitiveFocus, cognitiveCore } = input;
    
    if (!tasks || tasks.length === 0) {
      return {
        success: false,
        error: {
          code: 'EMPTY_TASKS',
          message: '任务列表为空'
        },
        duration: Date.now() - startTime
      };
    }
    
    const tasksJson = JSON.stringify(tasks, null, 2);
    
    const contextPrompt = `
【目标类型】${goalType || '未指定'}
【建议知识分布】${knowledgeDistribution ? JSON.stringify(knowledgeDistribution) : '未指定'}
【建议认知层级分布】${cognitiveFocus ? JSON.stringify(cognitiveFocus) : '未指定'}

【概念图谱】
${cognitiveCore ? JSON.stringify(cognitiveCore, null, 2) : '未提供'}

【待标注任务列表】（共 ${tasks.length} 个）
${tasksJson}

请为每个任务标注安德森框架属性。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: BATCH_LABELER_SYSTEM_PROMPT },
      { role: 'user', content: contextPrompt }
    ];
    
    const gateway = getAPIGateway();
    const caller: CallerInfo = { skillId: 'batch-anderson-labeler' };
    const response = await gateway.execute({
      messages,
      max_tokens: BATCH_ANDERSON_LABELER_MAX_TOKENS
    }, caller, {});
    
    console.log('[BatchAndersonLabeler] 响应结构:', JSON.stringify({
      id: response.id,
      model: response.model,
      hasChoices: !!response.choices,
      choicesLength: response.choices?.length,
      firstChoice: response.choices?.[0] ? {
        index: response.choices[0].index,
        hasMessage: !!response.choices[0].message,
        messageRole: response.choices[0].message?.role,
        contentLength: response.choices[0].message?.content?.length
      } : null
    }, null, 2));
    
    if (!response.choices || response.choices.length === 0) {
      console.error('[BatchAndersonLabeler] 响应无 choices:', JSON.stringify(response, null, 2));
      throw new Error('API 返回无 choices');
    }
    
    const content = response.choices[0].message.content || '';
    console.log('[BatchAndersonLabeler] 内容长度:', content.length);
    
    const labels = parseLabels(content, tasks, cognitiveCore);
    const overallConfidence = calculateOverallConfidence(labels);
    
    return {
      success: true,
      output: {
        labels,
        overallConfidence
      },
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    console.error('[BatchAndersonLabeler] 标注失败:', error.message);
    return {
      success: false,
      error: {
        code: 'LABEL_ERROR',
        message: error.message
      },
      duration: Date.now() - startTime
    };
  }
}

function buildConceptMap(cognitiveCore?: CognitiveCoreInput | null): Map<string, { id: string; name: string }> {
  const map = new Map<string, { id: string; name: string }>();
  const concepts = Array.isArray(cognitiveCore?.coreConcepts) ? cognitiveCore!.coreConcepts! : [];
  for (const concept of concepts) {
    const id = typeof concept?.id === 'string' ? concept.id.trim() : '';
    const name = typeof concept?.name === 'string' ? concept.name.trim() : '';
    if (!id || !name) continue;
    map.set(id, { id, name });
  }
  return map;
}

function resolveConceptForTask(
  task: TaskToLabel,
  conceptMap: Map<string, { id: string; name: string }>
): Pick<AndersonLabel, 'coreConcept' | 'resolvedConceptId' | 'resolvedConceptName' | 'conceptValidationStatus'> {
  const linkedConceptId = typeof task.linkedConcept === 'string' ? task.linkedConcept.trim() : '';
  if (!linkedConceptId) {
    return {
      coreConcept: null,
      resolvedConceptId: null,
      resolvedConceptName: null,
      conceptValidationStatus: 'missing'
    };
  }

  const concept = conceptMap.get(linkedConceptId);
  if (!concept) {
    return {
      coreConcept: null,
      resolvedConceptId: linkedConceptId,
      resolvedConceptName: null,
      conceptValidationStatus: 'invalid'
    };
  }

  return {
    coreConcept: concept.name,
    resolvedConceptId: concept.id,
    resolvedConceptName: concept.name,
    conceptValidationStatus: 'resolved'
  };
}

function parseLabels(content: string, tasks: TaskToLabel[], cognitiveCore?: CognitiveCoreInput | null): AndersonLabel[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('未找到 JSON 数组输出');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    const validKnowledgeTypes = ['factual', 'conceptual', 'procedural', 'metacognitive'];
    const validCognitiveLevels = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
    const conceptMap = buildConceptMap(cognitiveCore);
    
    const labels: AndersonLabel[] = [];
    
    for (const item of parsed) {
      if (!item.taskId) continue;
      
      const task = tasks.find(t => t.id === item.taskId);
      if (!task) continue;
      
      labels.push({
        taskId: item.taskId,
        knowledgeType: validKnowledgeTypes.includes(item.knowledgeType) 
          ? item.knowledgeType 
          : inferKnowledgeType(task),
        cognitiveLevel: validCognitiveLevels.includes(item.cognitiveLevel) 
          ? item.cognitiveLevel 
          : inferCognitiveLevel(task),
        learningObjectives: Array.isArray(item.learningObjectives) 
          ? item.learningObjectives 
          : [task.title],
        ...resolveConceptForTask(task, conceptMap),
        transferable: Boolean(item.transferable),
        confidence: Math.min(1, Math.max(0, item.confidence || 0.7))
      });
    }
    
    for (const task of tasks) {
      if (!labels.find(l => l.taskId === task.id)) {
        labels.push({
          taskId: task.id,
          knowledgeType: inferKnowledgeType(task),
          cognitiveLevel: inferCognitiveLevel(task),
          learningObjectives: [task.title],
          ...resolveConceptForTask(task, conceptMap),
          transferable: false,
          confidence: 0.5
        });
      }
    }
    
    return labels;
  } catch (parseError) {
    console.warn('[BatchAndersonLabeler] 解析失败，使用推断值:', parseError);
    const conceptMap = buildConceptMap(cognitiveCore);
    
    return tasks.map(task => ({
      taskId: task.id,
      knowledgeType: inferKnowledgeType(task),
      cognitiveLevel: inferCognitiveLevel(task),
      learningObjectives: [task.title],
      ...resolveConceptForTask(task, conceptMap),
      transferable: false,
      confidence: 0.5
    }));
  }
}

function inferKnowledgeType(task: TaskToLabel): 'factual' | 'conceptual' | 'procedural' | 'metacognitive' {
  const title = task.title.toLowerCase();
  const desc = (task.description || '').toLowerCase();
  const combined = `${title} ${desc}`;
  
  if (combined.includes('如何') || combined.includes('步骤') || combined.includes('实践') || combined.includes('练习')) {
    return 'procedural';
  }
  if (combined.includes('理解') || combined.includes('概念') || combined.includes('原理') || combined.includes('分析')) {
    return 'conceptual';
  }
  if (combined.includes('反思') || combined.includes('评估') || combined.includes('策略')) {
    return 'metacognitive';
  }
  return 'procedural';
}

function inferCognitiveLevel(task: TaskToLabel): 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create' {
  const title = task.title.toLowerCase();
  const desc = (task.description || '').toLowerCase();
  const combined = `${title} ${desc}`;
  
  if (combined.includes('创建') || combined.includes('设计') || combined.includes('构建') || combined.includes('开发')) {
    return 'create';
  }
  if (combined.includes('评估') || combined.includes('判断') || combined.includes('比较')) {
    return 'evaluate';
  }
  if (combined.includes('分析') || combined.includes('区分') || combined.includes('组织')) {
    return 'analyze';
  }
  if (combined.includes('应用') || combined.includes('使用') || combined.includes('实践') || combined.includes('练习')) {
    return 'apply';
  }
  if (combined.includes('理解') || combined.includes('解释') || combined.includes('了解')) {
    return 'understand';
  }
  return 'apply';
}

function calculateOverallConfidence(labels: AndersonLabel[]): number {
  if (labels.length === 0) return 0;
  
  const avgConfidence = labels.reduce((sum, l) => sum + l.confidence, 0) / labels.length;
  const coverageRatio = labels.length > 0 ? 1 : 0;
  
  return avgConfidence * coverageRatio;
}

export default batchAndersonLabeler;
