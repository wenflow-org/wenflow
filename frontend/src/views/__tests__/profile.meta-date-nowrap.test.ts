/**
 * 账户页资料卡元信息行日期断行回归（2026-10-08 用户侧走查 #50）
 *
 * 现象：窄屏（手机浅色 / 深色）下「… · 注册于 2026-10-08 · 最近登录 2026-10-08」
 *   在连字符后断开，上一行结尾「2026-10-」，下一行以「08 · 最近登录…」开头。
 *   机器事实 hOver=0 且无截断记录 —— 是正常换行，不是省略号截断。
 * 成因：基础档 .profile-meta 用 nowrap + ellipsis（桌面单行），窄屏覆写成
 *   white-space: normal 后整行可任意断行，浏览器默认在连字符处断（break 机会）。
 * 修法（评审建议）：只把日期片段包进 .profile-meta__date 并 nowrap —— 行仍可在
 *   「 · 」分隔处换行（不会退回省略号截断），但「2026-10-08」内部不再断。
 *
 * 写法沿用仓库既有「源码锁」：读 SFC 源码 → 花括号配平取规则 → 断言声明/选择器。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../Profile.vue'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** 取 selector 那条规则的声明体 */
function bodyOf(text: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[\\n{};])\\s*${esc}(?![\\w-])\\s*\\{([^{}]*)\\}`).exec(text);
  expect(m, `样式里没有 ${selector} 声明块`).not.toBeNull();
  return m![1];
}

function decl(body: string, prop: string): string | null {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(body);
  return m ? m[1].trim() : null;
}

describe('账户页两处日期不可在连字符处断行（#50）', () => {
  it('注册日期片段被 nowrap 的 span 包住', () => {
    expect(
      source,
      '注册日期没有包进 .profile-meta__date，窄屏仍会在「2026-10-」处断开',
    ).toMatch(/注册于\s*<span class="profile-meta__date">\{\{ formatDateShort\(user\.createdAt\) \}\}<\/span>/);
  });

  it('最近登录日期片段被 nowrap 的 span 包住', () => {
    expect(
      source,
      '最近登录日期没有包进 .profile-meta__date，窄屏仍会在「2026-10-」处断开',
    ).toMatch(/最近登录\s*<span class="profile-meta__date">\{\{ formatDateShort\(user\.lastLoginAt\) \}\}<\/span>/);
  });

  it('.profile-meta__date 声明 white-space: nowrap', () => {
    const body = bodyOf(css, '.profile-meta__date');
    expect(decl(body, 'white-space'), '日期片段没有锁 nowrap，连字符处仍可断行').toBe('nowrap');
  });

  it('窄屏仍放行整行换行（不退回省略号截断）', () => {
    // 基础档 .profile-meta 是 nowrap + ellipsis；窄屏覆写必须是 normal，
    // 否则整行会被截成省略号，修 #50 的同时制造新问题。
    const blocks = [...css.matchAll(/\.profile-meta\s*\{([^{}]*)\}/g)].map((m) => m[1]);
    expect(
      blocks.some((b) => decl(b, 'white-space') === 'normal'),
      '窄屏没有把 .profile-meta 放成 white-space: normal，行会退回省略号截断',
    ).toBe(true);
  });
});
