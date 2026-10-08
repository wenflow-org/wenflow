/**
 * 调用日志统计条空态（走查 2026-10-08 #51）
 *
 * 本页一条日志都没有时，成功率/平均耗时原样渲染 computed 的 0 → 界面出现
 * 「总调用 0」与「成功率（本页）0%」「平均耗时（本页）0ms」并排：把「无样本」
 * 显示成 0 分，会被读成「全部失败 / 零耗时」。无样本时须给「—」，只在有日志
 * （hasPageSamples）时才输出百分比与耗时。
 *
 * 沿用仓库既有的「源码锁」写法：读 SFC 源码、断言模板条件与脚本声明。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../AgentLogs.vue'), 'utf8');
// 模板注释里可能引用旧写法，去掉后再断言，避免误命中
const template = source
  .slice(0, source.indexOf('<script'))
  .replace(/<!--[\s\S]*?-->/g, '');
const script = source.slice(source.indexOf('<script'), source.indexOf('<style'));

/** 取某个统计标签（如「成功率（本页）」）之后的统计卡片段 */
function statCard(label: string): string {
  const start = template.indexOf(label);
  expect(start, `模板里找不到统计标签「${label}」`).toBeGreaterThan(-1);
  return template.slice(start, template.indexOf('</div>', start));
}

describe('调用日志统计条空态（走查 2026-10-08 #51）', () => {
  it('脚本用 displayLogs 判本页是否有样本', () => {
    expect(script).toMatch(
      /const\s+hasPageSamples\s*=\s*computed\(\s*\(\)\s*=>\s*displayLogs\.value\.length\s*>\s*0\s*\)/
    );
  });

  it('成功率无样本时显示「—」，而不是 0%', () => {
    const card = statCard('成功率（本页）');
    expect(card).toContain('hasPageSamples');
    expect(card).toContain('—');
    expect(card).toContain('successRate');
  });

  it('平均耗时无样本时显示「—」，而不是 0ms', () => {
    const card = statCard('平均耗时（本页）');
    expect(card).toContain('hasPageSamples');
    expect(card).toContain('—');
    expect(card).toContain('avgDuration');
  });

  it('模板不再直接输出裸的 0% / 0ms', () => {
    expect(template).not.toContain('{{ successRate }}%');
    expect(template).not.toContain('{{ avgDuration }}ms');
  });
});
