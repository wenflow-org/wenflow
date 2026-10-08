/**
 * 个人中心分段器在深页的选中态（走查 2026-10-08 用户侧，发现 #52）
 *
 * 病根：CapabilityShell 页头的三分段器（账户 / 成就 / 学习历史）里 isActive 只匹配
 *   三个能力页自身路径（CapabilityShell.vue:53-59），而 /user/settings（设置）与
 *   /user/agent-logs（调用日志）是「账户」分区的下一层：走进这两页，三段全无选中胶囊，
 *   与账户页「账户」段的白底胶囊表现不一致，用户看不出自己此刻属于哪个分区。
 *
 * 修法：给每个 tab 补 owns = 该段名下的深页，isActive 合并 match + owns；
 *   父段在深页给 aria-current="true"（所属分区，不是当前页）；深页仍保留可见 h1
 *   （uc__deeptitle 的判定只看 match，不能跟着 owns 一起放大，否则设置/调用日志的
 *   可见页名会被收成 sr-only）。
 *
 * 沿用仓库既有的「源码锁」写法（读 SFC 源码、断言声明与模板条件），
 * 另加一条带假 router 的挂载用例，直接验证分段器的选中类与 aria-current。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../CapabilityShell.vue'), 'utf8');
// 模板注释里复述了旧写法，去掉后再断言，避免误命中
const template = source
  .slice(0, source.indexOf('<script'))
  .replace(/<!--[\s\S]*?-->/g, '');
const script = source.slice(source.indexOf('<script'), source.indexOf('<style'));

let currentPath = '/user/account';
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: currentPath })
}));

import CapabilityShell from '../CapabilityShell.vue';

const stubs = {
  V2Nav: true,
  V2Footer: true,
  'router-link': { props: ['to'], template: '<a :href="to"><slot /></a>' }
};

function mountShell(path: string) {
  currentPath = path;
  return mount(CapabilityShell, {
    props: { title: path === '/user/settings' ? '设置' : '调用日志' },
    global: { stubs }
  });
}

function segButtons(w: ReturnType<typeof mountShell>) {
  return w.findAll('.uc__seg__btn');
}

/** 取「账户」那一段（三段中的第一段） */
function accountSeg(w: ReturnType<typeof mountShell>) {
  return segButtons(w)[0];
}

describe('CapabilityShell 深页分段器选中态（走查 2026-10-08 #52）', () => {
  beforeEach(() => {
    currentPath = '/user/account';
  });

  it('「账户」段的 match 只认自身路径，深页另记在 owns 上', () => {
    const accountTab = /const tabs = \[([\s\S]*?)\n\]/.exec(script)?.[1] ?? '';
    expect(accountTab, '找不到 tabs 定义').toContain("to: '/user/account'");
    // 「账户」段自身 match 仍是 /user/account，不与深页前缀混在一起
    expect(accountTab).toMatch(/to:\s*'\/user\/account',\s*label:\s*'账户',\s*match:\s*\['\/user\/account'\]/);
    // 深页（设置 / 调用日志）落在「账户」段的 owns 里
    expect(accountTab, '「账户」段没把 /user/settings 记为名下深页').toContain("'/user/settings'");
    expect(accountTab, '「账户」段没把 /user/agent-logs 记为名下深页').toContain("'/user/agent-logs'");
  });

  it('isActive 合并 match 与 owns（深页也能点亮父段）', () => {
    const body = /function isActive\(([\s\S]*?)\n\}/.exec(script)?.[0] ?? '';
    expect(body, '找不到 isActive').not.toBe('');
    expect(body).toContain('t.owns');
    expect(body).toContain('t.match');
  });

  it('深页可见 h1 的判定（onCapabilityTab）只看 match，不跟着 owns 放大', () => {
    const decl = /const onCapabilityTab = [\s\S]*?\)\)/.exec(script)?.[0] ?? '';
    expect(decl, '找不到 onCapabilityTab 声明').not.toBe('');
    expect(decl).toContain('t.match');
    expect(decl, 'onCapabilityTab 若吃进 owns，设置/调用日志的可见页名会被收成 sr-only').not.toContain('owns');
    // 深页标题区仍是「非能力页」分支
    expect(template).toContain('v-if="!onCapabilityTab"');
    expect(template).toContain('uc__deeptitle');
  });

  it('账户页：第一段是选中胶囊，aria-current=page', () => {
    const w = mountShell('/user/account');
    expect(accountSeg(w).classes()).toContain('uc__seg__btn--on');
    expect(accountSeg(w).attributes('aria-current')).toBe('page');
    expect(w.find('.uc__deeptitle').exists()).toBe(false);
  });

  it.each(['/user/settings', '/user/agent-logs'])('深页 %s：「账户」段保持选中胶囊，且只是所属分区', (path) => {
    const w = mountShell(path);
    const account = accountSeg(w);

    expect(account.classes(), `${path} 三段全无选中`).toContain('uc__seg__btn--on');
    expect(account.attributes('aria-current'), '深页的当前页是页内 h1，父段只能是「所属分区」').toBe('true');

    // 其余两段不得被点亮
    expect(segButtons(w)[1].classes()).not.toContain('uc__seg__btn--on');
    expect(segButtons(w)[2].classes()).not.toContain('uc__seg__btn--on');
    expect(segButtons(w)[1].attributes('aria-current')).toBeUndefined();

    // 深页仍保留可见页名（不是 sr-only）
    expect(w.find('.uc__deeptitle h1').exists()).toBe(true);
  });

  it('成就 / 学习历史两段：只有自己那页选中', () => {
    const achievements = mountShell('/user/achievements');
    expect(segButtons(achievements)[1].classes()).toContain('uc__seg__btn--on');
    expect(accountSeg(achievements).classes()).not.toContain('uc__seg__btn--on');
    expect(segButtons(achievements)[1].attributes('aria-current')).toBe('page');

    const history = mountShell('/user/learning-history');
    expect(segButtons(history)[2].classes()).toContain('uc__seg__btn--on');
    expect(accountSeg(history).classes()).not.toContain('uc__seg__btn--on');
    expect(segButtons(history)[2].attributes('aria-current')).toBe('page');
  });
});
