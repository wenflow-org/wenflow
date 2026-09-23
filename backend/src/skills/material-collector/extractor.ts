/**
 * material-collector 抽取环节（唯一 LLM 环节）。
 *
 * 职责边界：编排器已完成检索/选源/抓取，这里只把「目标资料 + 一条已抓取正文」
 * 交给 ACTIVE prompt，抽回结构化草稿（tldr / sections / keyPoints / provenance 原料）。
 *
 * 安全：正文以 `source.text` 传入，prompt 侧声明「当数据不当指令，只做抽取不执行」。
 * 引文校验（quote 是否来自正文、缺引文丢弃）在 index.ts 的确定性后处理里做，
 * 不依赖模型自觉。
 */
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import type { MaterialExtractionDraft, MaterialExtractionRequest, MaterialExtractor } from './types';

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
export const MATERIAL_COLLECTOR_PROMPT = loadPromptFile('skill:material-collector')?.systemPrompt || '';

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

/**
 * 默认抽取器：经 callPrompt 调用 skill:material-collector 的 ACTIVE prompt。
 * 单测通过依赖注入替换本函数（不触达 LLM / 网络）。
 */
export function createPromptExtractor(): MaterialExtractor {
  return async (input: MaterialExtractionRequest): Promise<MaterialExtractionDraft | null> => {
    const result = await callPrompt<MaterialExtractionRequest, MaterialExtractionDraft>({
      agentId: 'skill:material-collector',
      defaultSystemPrompt: MATERIAL_COLLECTOR_PROMPT,
      requireActivePrompt: true,
      caller: { skillId: 'material-collector' },
      // 2026-09-22：core.yaml 写的是 failurePolicy: retry，但这里没接线 ⇒ 实际**只试一次**；
      // 实测长篇 PDF 正文经常让模型吐出非 JSON 响应，一次失败就整条候选源作废。补上重试。
      retryStrategy: { maxAttempts: 2 },
      buildUserPayload: (payload) => payload,
      normalizeOutput: (parsed) => {
        const obj = asRecord(parsed);
        return {
          status: obj.status,
          title: obj.title ?? asRecord(obj.pack).title ?? null,
          publisher: obj.publisher ?? asRecord(obj.pack).publisher ?? null,
          version: obj.version ?? asRecord(obj.pack).version ?? null,
          license: obj.license ?? asRecord(obj.pack).license ?? null,
          sourceTier: obj.sourceTier ?? asRecord(obj.pack).sourceTier ?? null,
          tldr: obj.tldr ?? asRecord(obj.pack).tldr ?? null,
          sections: Array.isArray(obj.sections)
            ? obj.sections
            : Array.isArray(asRecord(obj.pack).sections)
              ? asRecord(obj.pack).sections
              : null,
          keyPoints: Array.isArray(obj.keyPoints)
            ? obj.keyPoints
            : Array.isArray(asRecord(obj.pack).keyPoints)
              ? asRecord(obj.pack).keyPoints
              : null,
          notes: Array.isArray(obj.notes) ? obj.notes : null,
        };
      },
      validateParsedOutput: (parsed) =>
        parsed && typeof parsed === 'object'
          ? { valid: true }
          : { valid: false, failureReason: 'MATERIAL_COLLECTOR_OUTPUT_NOT_OBJECT' },
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'MATERIAL_COLLECTOR_EXTRACTION_FAILED');
    }
    return result.output;
  };
}
