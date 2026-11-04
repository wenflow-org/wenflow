/**
 * Settings 顶部状态条开关标签（走查 2026-10-08 #10；2026-11-04 去重）
 *
 * 开关绑的是 apiConfig.enabled（= 是否启用「自定义模型服务」），但标签只写裸「启用/禁用」，
 * 贴在标题「使用内置模型服务」右侧，整行读成「内置模型服务 禁用」，
 * 新手会以为内置模型被关掉了。标签须写明它真正控制的对象。
 *
 * 2026-11-04 走查：标签此前写成「自定义模型服务：开/关」，与标题「…已启用」同屏复述同一状态；
 * 改为只留对象名，开合交给开关轨道本身，状态句由标题唯一承载。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../Settings.vue'), 'utf8');
const template = source.slice(0, source.indexOf('<style'));

// 只取状态条这一段（含左侧标题与右侧开关标签）
const statusBar = template.slice(
  template.indexOf('settings-status'),
  template.indexOf('loadError')
);

describe('Settings 顶部状态条开关标签（走查 2026-10-08 #10）', () => {
  it('开关标签指明它真正控制的对象：自定义模型服务', () => {
    expect(statusBar).toContain('uc-switch__label');
    expect(statusBar).toContain('自定义模型服务');
  });

  it('开关标签只写控制对象，不复述状态（状态由标题唯一承载，2026-11-04）', () => {
    expect(statusBar).toMatch(/uc-switch__label">自定义模型服务</);
    expect(statusBar).not.toMatch(/自定义模型服务[：:]/);
  });

  it('不再出现裸「启用/禁用」标签（会跟左侧标题互相否定）', () => {
    expect(statusBar).not.toMatch(/apiConfig\.enabled\s*\?\s*'启用'\s*:\s*'禁用'/);
  });
});
