/**
 * 个人中心分段器的激活判定（走查 2026-11-01 P20，推翻 2026-10-08 #52 对深页的口径）
 *
 * 病根：CapabilityShell 页头的分段器此前用 startsWith 前缀匹配 + owns 归属
 *   （#52 的修法：深页点亮父段、父段给 aria-current="true"）。设置升为一级分段后
 *   owns 把 /user/agent-logs（调用日志）归属到「设置」段——走进调用日志，
 *   高亮错停在「设置」上（P20：eval 读 nav class=uc__seg__btn--on 落在「设置」）。
 *
 * 修法：激活判定与当前路由精确对应，每个 tab 只对准自己的路径段（route.path === t.to）；
 *   深页四段全不选中，可见页名由 uc__deeptitle 的 h1 承担（onCapabilityTab 仍只认
 *   自身路径，不能跟着放大，否则调用日志的可见页名会被收成 sr-only）。
 *
 * 沿用仓库既有的「源码锁」写法（读 SFC 源码、断言声明与模板条件），
 * 另加带假 router 的挂载用例，直接验证分段器的选中类与 aria-current。
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

/** 取「账户」那一段（四段中的第一段） */
function accountSeg(w: ReturnType<typeof mountShell>) {
  return segButtons(w)[0];
}

/** 全部分段中带选中胶囊的那些（深页应为空集） */
function activeSegs(w: ReturnType<typeof mountShell>) {
  return segButtons(w).filter((b) => b.classes().includes('uc__seg__btn--on'));
}

describe('CapabilityShell 分段器激活判定（走查 2026-11-01 P20）', () => {
  beforeEach(() => {
    currentPath = '/user/account';
  });

  it('tabs 无 owns 归属：每段只记自己的路径（深页不再点亮父段）', () => {
    const body = /const tabs = \[[\s\S]*?\n\]/.exec(script)?.[0] ?? '';
    expect(body, '找不到 tabs 定义').not.toBe('');
    expect(body, 'owns 归属是 P20 的病根，不该再出现').not.toContain('owns');
    for (const p of ['/user/account', '/user/achievements', '/user/learning-history', '/user/settings']) {
      expect(body, `tabs 里缺 ${p}`).toContain(`to: '${p}'`);
    }
  });

  it('isActive / ariaCurrent / onCapabilityTab 都是精确等值匹配（不再是 startsWith 前缀）', () => {
    // 注释里会复述旧病根（「startsWith 前缀匹配」），先剥注释再看代码
    const code = script.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code, '激活判定还在用 startsWith 前缀匹配（P20 病根）').not.toContain('startsWith');
    const isActiveBody = /function isActive\([\s\S]*?\n\}/.exec(script)?.[0] ?? '';
    expect(isActiveBody).toContain("route.path === t.to");
    const onCapabilityTab = /const onCapabilityTab = [\s\S]*?\)\)/.exec(script)?.[0] ?? '';
    expect(onCapabilityTab, '找不到 onCapabilityTab 声明').not.toBe('');
    expect(onCapabilityTab).toContain('route.path === t.to');
    // ariaCurrent 只剩 'page' 一档：父段「所属分区」的 'true' 随 owns 一并退役
    expect(code).not.toContain("'true'");
  });

  it('深页可见 h1 的判定（onCapabilityTab）只认自身路径，不随深页放大', () => {
    // 深页标题区仍是「非能力页」分支
    expect(template).toContain('v-if="!onCapabilityTab"');
    expect(template).toContain('uc__deeptitle');
  });

  it('账户页：第一段是选中胶囊，aria-current=page', () => {
    const w = mountShell('/user/account');
    expect(accountSeg(w).classes()).toContain('uc__seg__btn--on');
    expect(accountSeg(w).attributes('aria-current')).toBe('page');
    expect(activeSegs(w)).toHaveLength(1);
    expect(w.find('.uc__deeptitle').exists()).toBe(false);
  });

  it('/user/settings：第四段「设置」是当前页，其余段不点亮', () => {
    const w = mountShell('/user/settings');
    const settings = segButtons(w)[3];

    expect(settings.classes(), '/user/settings 没有选中「设置」段').toContain('uc__seg__btn--on');
    expect(settings.attributes('aria-current')).toBe('page');
    expect(accountSeg(w).classes()).not.toContain('uc__seg__btn--on');
    expect(activeSegs(w)).toHaveLength(1);

    // 设置是一级分段，页名由选中的分段承载，不再重复可见 h1
    expect(w.find('.uc__deeptitle').exists()).toBe(false);
  });

  it('/user/agent-logs：深页不点亮任何段（P20：高亮不再错停「设置」），可见页名保留', () => {
    const w = mountShell('/user/agent-logs');
    expect(activeSegs(w), '深页不该有任何选中段（此前错停「设置」）').toHaveLength(0);
    expect(segButtons(w)[3].classes()).not.toContain('uc__seg__btn--on');
    for (const seg of segButtons(w)) {
      expect(seg.attributes('aria-current'), '深页不该有 aria-current').toBeUndefined();
    }

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
