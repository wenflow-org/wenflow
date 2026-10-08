/**
 * Settings 顶部状态条开关标签（走查 2026-10-08 #10）
 *
 * 开关绑的是 apiConfig.enabled（= 是否启用「自定义模型服务」），但标签只写裸「启用/禁用」，
 * 贴在标题「使用平台默认模型服务」右侧，整行读成「平台默认模型服务 禁用」，
 * 新手会以为平台默认模型被关掉了。标签须写明它真正控制的对象，且开/关状态挂在该对象上。
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

  it('开/关状态挂在「自定义模型服务」上，跟随 apiConfig.enabled', () => {
    expect(statusBar).toMatch(
      /自定义模型服务[：:]\s*\{\{\s*apiConfig\.enabled\s*\?\s*'开'\s*:\s*'关'\s*\}\}/
    );
  });

  it('不再出现裸「启用/禁用」标签（会跟左侧标题互相否定）', () => {
    expect(statusBar).not.toMatch(/apiConfig\.enabled\s*\?\s*'启用'\s*:\s*'禁用'/);
  });
});
