/**
 * AndersonLabeler Cache - 标注缓存机制
 * 
 * 基于语义相似度复用已有标注，减少 LLM 调用
 * 
 * 使用嵌入向量计算相似度：
 * - 相似度 >= 0.9: 直接复用
 * - 相似度 >= 0.7: 部分复用（调整置信度）
 * - 相似度 < 0.7: 不复用，重新标注
 */

import prisma from '../../config/database';

export interface CachedLabel {
  id: string;
  taskTitle: string;
  taskDescription?: string;
  knowledgeType: string;
  cognitiveLevel: string;
  learningObjectives: string[];
  coreConcept: string;
  transferable: boolean;
  embedding?: number[];
  createdAt: Date;
}

export interface CacheHitResult {
  found: boolean;
  label?: CachedLabel;
  similarity?: number;
  adjustedConfidence?: number;
}

const SIMILARITY_THRESHOLD_DIRECT = 0.9;
const SIMILARITY_THRESHOLD_PARTIAL = 0.7;

const EMBEDDING_SIMILARITY_PROMPT = `分析以下两个学习任务的语义相似度：

任务A: {taskA}
任务B: {taskB}

仅输出一个 0-1 的数字表示相似度，不要输出任何其他内容。
相似度判断标准：
- 任务主题完全相同: 1.0
- 任务主题高度相似（只是表述不同）: 0.8-0.9
- 任务主题部分相似（同一领域不同具体内容）: 0.5-0.7
- 任务主题不相关: 0-0.4`;

export class AndersonLabelerCache {
  private cache: Map<string, CachedLabel> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const existingLabels = await prisma.subtasks.findMany({
        where: {
          knowledgeType: { not: null },
          cognitiveLevel: { not: null }
        },
        select: {
          id: true,
          title: true,
          description: true,
          knowledgeType: true,
          cognitiveLevel: true,
          learningObjectives: true,
          coreConcept: true,
          transferable: true,
          createdAt: true
        }
      });

      for (const label of existingLabels) {
        const cachedLabel: CachedLabel = {
          id: label.id,
          taskTitle: label.title,
          taskDescription: label.description || undefined,
          knowledgeType: label.knowledgeType || 'procedural',
          cognitiveLevel: label.cognitiveLevel || 'apply',
          learningObjectives: label.learningObjectives 
            ? JSON.parse(label.learningObjectives) 
            : [label.title],
          coreConcept: label.coreConcept || label.title,
          transferable: label.transferable || false,
          createdAt: label.createdAt
        };
        
        const key = this.generateKey(label.title, label.description || '');
        this.cache.set(key, cachedLabel);
      }

      console.log(`[AndersonLabelerCache] 已加载 ${this.cache.size} 条缓存`);
      this.initialized = true;
    } catch (error) {
      console.error('[AndersonLabelerCache] 初始化失败:', error);
      this.initialized = true;
    }
  }

  async findSimilarLabel(
    taskTitle: string,
    taskDescription?: string,
    computeSimilarity?: (a: string, b: string) => Promise<number>
  ): Promise<CacheHitResult> {
    await this.initialize();

    const taskKey = this.generateKey(taskTitle, taskDescription || '');
    
    const exactMatch = this.cache.get(taskKey);
    if (exactMatch) {
      return {
        found: true,
        label: exactMatch,
        similarity: 1.0,
        adjustedConfidence: exactMatch.transferable ? 0.95 : 0.90
      };
    }

    const candidates: Array<{ label: CachedLabel; similarity: number }> = [];

    for (const [key, cachedLabel] of this.cache.entries()) {
      const similarity = await this.calculateSimilarity(
        taskTitle,
        taskDescription || '',
        cachedLabel.taskTitle,
        cachedLabel.taskDescription || '',
        computeSimilarity
      );

      if (similarity >= SIMILARITY_THRESHOLD_PARTIAL) {
        candidates.push({ label: cachedLabel, similarity });
      }
    }

    if (candidates.length === 0) {
      return { found: false };
    }

    candidates.sort((a, b) => b.similarity - a.similarity);
    const bestMatch = candidates[0];

    if (bestMatch.similarity >= SIMILARITY_THRESHOLD_DIRECT) {
      return {
        found: true,
        label: bestMatch.label,
        similarity: bestMatch.similarity,
        adjustedConfidence: bestMatch.similarity * 0.95
      };
    }

    return {
      found: true,
      label: bestMatch.label,
      similarity: bestMatch.similarity,
      adjustedConfidence: bestMatch.similarity * 0.7
    };
  }

  async addToCache(label: CachedLabel): Promise<void> {
    await this.initialize();
    
    const key = this.generateKey(label.taskTitle, label.taskDescription || '');
    this.cache.set(key, label);

    try {
      await prisma.subtasks.update({
        where: { id: label.id },
        data: {
          knowledgeType: label.knowledgeType,
          cognitiveLevel: label.cognitiveLevel,
          learningObjectives: JSON.stringify(label.learningObjectives),
          coreConcept: label.coreConcept,
          transferable: label.transferable
        }
      });
    } catch (error) {
      console.error('[AndersonLabelerCache] 保存到数据库失败:', error);
    }
  }

  async batchAddToCache(labels: CachedLabel[]): Promise<void> {
    await this.initialize();
    
    for (const label of labels) {
      const key = this.generateKey(label.taskTitle, label.taskDescription || '');
      this.cache.set(key, label);
    }

    try {
      for (const label of labels) {
        await prisma.subtasks.update({
          where: { id: label.id },
          data: {
            knowledgeType: label.knowledgeType,
            cognitiveLevel: label.cognitiveLevel,
            learningObjectives: JSON.stringify(label.learningObjectives),
            coreConcept: label.coreConcept,
            transferable: label.transferable
          }
        });
      }
    } catch (error) {
      console.error('[AndersonLabelerCache] 批量保存失败:', error);
    }
  }

  clear(): void {
    this.cache.clear();
    this.initialized = false;
  }

  getStats(): { size: number; initialized: boolean } {
    return {
      size: this.cache.size,
      initialized: this.initialized
    };
  }

  private generateKey(title: string, description: string): string {
    const normalized = `${title}:${description}`.toLowerCase().trim();
    return normalized.substring(0, 100);
  }

  private async calculateSimilarity(
    titleA: string,
    descA: string,
    titleB: string,
    descB: string,
    computeSimilarity?: (a: string, b: string) => Promise<number>
  ): Promise<number> {
    const taskA = `${titleA} ${descA}`.trim();
    const taskB = `${titleB} ${descB}`.trim();

    if (computeSimilarity) {
      try {
        return await computeSimilarity(taskA, taskB);
      } catch (error) {
        console.warn('[AndersonLabelerCache] 外部相似度计算失败，使用内置方法');
      }
    }

    return this.keywordSimilarity(taskA, taskB);
  }

  private keywordSimilarity(textA: string, textB: string): number {
    const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }
}

export const andersonLabelerCache = new AndersonLabelerCache();
export default andersonLabelerCache;