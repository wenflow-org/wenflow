/**
 * 认证壳右侧演示面板 · AI 头像主题切换（2026-10-08 用户侧视觉检查 #30 / #72）的源码锁：
 *
 * 演示面板里的 AI 助手头像此前写死 `<img src="/favicon.png">`，是全仓唯一不随主题
 * 切图的一处 favicon 引用（ChatMessageList.vue:78、V2Footer.vue:5、HomeNext.vue:28、
 * V2GoalConversation.vue:244 等都是 isDark ? '/favicon-dark.png' : '/favicon.png'）。
 * 暗色档头像框是深底（#202124），favicon.png 的深色笔画与底色几乎同色（≈1.03:1），
 * 头像糊成一团；亮色档同处正常。改为随主题切到 favicon-dark.png。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sfc = readFileSync(resolve(here, '../V2AuthLayout.vue'), 'utf8');

describe('认证壳演示面板头像随主题切换（走查 2026-10-08 #30 / #72）', () => {
  it('头像 img 随 isDark 切到 favicon-dark.png，与页脚/聊天头像同一口径', () => {
    expect(sfc).toMatch(
      /class="demo__avatar"><img\s+:src="isDark \? '\/favicon-dark\.png' : '\/favicon\.png'"/,
    );
  });

  it('不再残留写死浅色 favicon.png 的静态 src', () => {
    expect(sfc).not.toMatch(/<img\s+src="\/favicon\.png"/);
  });

  it('底部 logo 也保持同一主题切换口径', () => {
    expect(sfc).toMatch(/:src="isDark \? '\/logo-dark\.png' : '\/logo\.png'"/);
  });
});
