/**
 * 世代分界登记（era boundaries）——TS 侧读取入口。
 *
 * 权威源：backend/config/era-boundaries.json（File-as-Truth，先例 llm-providers.json）。
 * 约定（2026-10-08 建立，背景见 JSON 内 _readme）：
 * - 任何「现状判断」的读数/审计/复验，必须先按边界过滤或显式声明不过滤的理由；
 * - eraOf(ts) 给出时间戳所属的最新世代 id；脚本输出里应打印它，
 *   让读者一眼看到「这条结论位于哪个世代」。
 */
import raw from '../../config/era-boundaries.json';

export interface EraBoundary {
  id: string;
  epochMs: number;
  at: string;
  commit: string;
  what: string;
  affects: string[];
  source: string;
}

export const ERA_BOUNDARIES: EraBoundary[] = [...raw.boundaries].sort((a, b) => a.epochMs - b.epochMs);

export function getEraBoundary(id: string): EraBoundary {
  const hit = ERA_BOUNDARIES.find((item) => item.id === id);
  if (!hit) throw new Error(`未知世代边界：${id}（登记见 backend/config/era-boundaries.json）`);
  return hit;
}

/** 时间戳（epoch ms）所属的最新世代——早于第一个边界返回 'pre-r1' */
export function eraOf(epochMs: number): string {
  let current = 'pre-r1';
  for (const boundary of ERA_BOUNDARIES) {
    if (epochMs >= boundary.epochMs) current = boundary.id;
    else break;
  }
  return current;
}

/** 时间戳是否在指定边界之后（含边界时刻） */
export function isAfterEra(id: string, epochMs: number): boolean {
  return epochMs >= getEraBoundary(id).epochMs;
}
