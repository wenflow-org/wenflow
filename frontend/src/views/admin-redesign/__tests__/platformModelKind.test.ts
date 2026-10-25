import { describe, expect, it } from 'vitest';
import { MODEL_KIND_LABEL, modelKindOf, modelTargetOf } from '../platformModelKind';

describe('平台模型用途分类（2026-10-24）', () => {
  it('向量 / 重排按命名识别，bge-reranker 不会被当成向量', () => {
    expect(modelKindOf('BAAI/bge-large-zh-v1.5')).toBe('embedding');
    expect(modelKindOf('Qwen3-Embedding-8B')).toBe('embedding');
    expect(modelKindOf('BAAI/bge-reranker-v2-m3')).toBe('rerank');
    expect(modelKindOf('Qwen3-Reranker-0.6B')).toBe('rerank');
  });

  it('生图 / 视频 / 音频 / 决策不混进对话候选', () => {
    expect(modelKindOf('agnes-image-2.5-flash')).toBe('image');
    expect(modelKindOf('step-image-edit-2')).toBe('image');
    expect(modelKindOf('agnes-video-2.5')).toBe('video');
    expect(modelKindOf('stepaudio-2.5-asr')).toBe('audio');
    expect(modelKindOf('jev-latest')).toBe('decision');
    expect(modelKindOf('startlux-decision-27b-autothink')).toBe('decision');
  });

  it('对话模型保持 chat；路由类归其他', () => {
    expect(modelKindOf('deepseek-v4.1-flash')).toBe('chat');
    expect(modelKindOf('agnes-3.0-flash')).toBe('chat');
    expect(modelKindOf('step-5-preview')).toBe('chat');
    expect(modelKindOf('mimo-v2.6-flash')).toBe('chat');
    expect(modelKindOf('step-router-v1')).toBe('other');
    expect(modelKindOf('')).toBe('chat');
  });

  it('每类都有中文名，非对话模型各有去向', () => {
    expect(MODEL_KIND_LABEL.embedding).toBe('向量');
    expect(modelTargetOf('embedding')).toBe('infra');
    expect(modelTargetOf('rerank')).toBe('infra');
    expect(modelTargetOf('image')).toBe('plugins');
    expect(modelTargetOf('decision')).toBe('plugins');
    expect(modelTargetOf('video')).toBeNull();
    expect(modelTargetOf('chat')).toBeNull();
  });
});
