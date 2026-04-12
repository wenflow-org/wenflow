/**
 * Skill 协议定义 - EduClaw Gateway
 * 
 * Skill 是能力单元，负责具体执行，可被多个 Agent 复用
 * 所有 Skill 必须遵循此协议
 */

// Skill 分类
export type SkillCategory = 
  | 'parsing'      // 解析类
  | 'generation'   // 生成类
  | 'analysis'     // 分析类
  | 'retrieval'    // 检索类
  | 'computation'; // 计算类

// Skill 定义
export interface SkillDefinition {
  id?: string;
  name: string;
  version: string;
  category: SkillCategory;
  description: string;
  
  // 输入 Schema
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      required?: boolean;
      default?: any;
    }>;
  };
  
  // 输出 Schema
  outputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
    }>;
  };
  
  // 能力标签
  capabilities: string[];
  
  // 依赖的其他 Skill
  dependencies?: string[];
  
  // 端点（如果是远程 Skill）
  endpoint?: string;
  
  // 统计数据
  stats: {
    callCount: number;
    successRate: number;
    avgLatency: number;
  };
}

// Skill 执行请求
export interface SkillExecutionRequest {
  skillName: string;
  input: Record<string, any>;
  options?: {
    timeout?: number;
    cache?: boolean;
    priority?: 'high' | 'normal' | 'low';
  };
}

// Skill 执行结果
export interface SkillExecutionResult<T = any> {
  success: boolean;
  output?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  duration: number; // ms
  cached?: boolean;
}

// ============ 核心 Skill 输入输出定义 ============

// PDF 解析 Skill
export interface PDFParserInput {
  fileBuffer?: Buffer;
  filePath?: string;
  fileUrl?: string;
  extractImages?: boolean;
  ocrEnabled?: boolean;
}

export interface PDFParserOutput {
  text: string;
  pages: number;
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
  };
  structure?: {
    headings: Array<{ level: number; text: string; page: number }>;
    paragraphs: Array<{ text: string; page: number }>;
    images?: Array<{ page: number; description?: string }>;
  };
}

// 文本结构分析 Skill
export interface TextStructureAnalyzerInput {
  text: string;
  detectOutline?: boolean;
  detectChapters?: boolean;
  extractKeywords?: boolean;
}

export interface TextStructureAnalyzerOutput {
  outline?: Array<{
    level: number;
    title: string;
    startIndex: number;
    endIndex: number;
  }>;
  chapters?: Array<{
    title: string;
    content: string;
    startPage?: number;
  }>;
  keywords?: string[];
  summary?: string;
  estimatedReadTime?: number; // 分钟
}

// 时间估算 Skill
export interface TimeEstimatorInput {
  content: string;
  contentType: 'reading' | 'video' | 'exercise' | 'project';
  difficulty?: 'easy' | 'medium' | 'hard';
  userLevel?: 'beginner' | 'intermediate' | 'advanced';
}

export interface TimeEstimatorOutput {
  estimatedMinutes: number;
  breakdown?: {
    reading?: number;
    practice?: number;
    review?: number;
  };
  confidence: number; // 0-1
  factors?: string[]; // 影响因素
}

// 内容生成 Skill
export interface ContentGenerationInput {
  topic: string;
  type: 'explanation' | 'tutorial' | 'exercise' | 'quiz';
  targetLevel: 'beginner' | 'intermediate' | 'advanced';
  style?: 'formal' | 'casual' | 'academic';
  length?: 'short' | 'medium' | 'long';
  context?: string; // 额外上下文
  referenceMaterial?: string; // 参考材料
}

export interface ContentGenerationOutput {
  content: string;
  sections?: Array<{
    title: string;
    content: string;
  }>;
  keyPoints?: string[];
  estimatedTime?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
}

// 测验生成 Skill
export interface QuizGenerationInput {
  topic: string;
  content: string; // 相关内容
  questionCount: number;
  questionTypes: Array<'multiple-choice' | 'short-answer' | 'coding'>;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface QuizGenerationOutput {
  questions: Array<{
    id: string;
    question: string;
    type: 'multiple-choice' | 'short-answer' | 'coding';
    options?: string[];
    correctAnswer: string;
    explanation: string;
    difficulty: 'easy' | 'medium' | 'hard';
    tags?: string[];
  }>;
  totalScore: number;
  estimatedTime: number; // 分钟
}

// 检索 Skill
export interface RetrievalInput {
  query: string;
  sources?: Array<{
    type: 'file' | 'url' | 'text';
    content: string;
    name?: string;
  }>;
  topK?: number;
  threshold?: number;
}

export interface RetrievalOutput {
  results: Array<{
    content: string;
    score: number;
    source?: string;
    metadata?: Record<string, any>;
  }>;
  totalFound: number;
  queryExpansion?: string[];
}

// 答案生成 Skill
export interface AnswerGenerationInput {
  question: string;
  context?: string;
  retrievedContent?: string[];
  userLevel: 'beginner' | 'intermediate' | 'advanced';
  style?: 'socratic' | 'direct' | 'guided';
  maxTokens?: number;
}

export interface AnswerGenerationOutput {
  answer: string;
  confidence: number;
  followUpQuestions?: string[];
  relatedTopics?: string[];
  sources?: string[];
}
