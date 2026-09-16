/**
 * @vitest-environment node
 *
 * 日期模拟 UI 守卫（防退化）
 *
 * 与后端 simulation-clock-wiring.audit 对应：钉住前端"模拟进度只展示服务端字段、
 * 不在前端做真实时间换算、不引用已删字段"这一约定，防止有人把模拟进度写回真实时间。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(__dirname, '..'); // admin-redesign
const API = resolve(__dirname, '../../../api/adminApi.ts');
const read = (f: string) => readFileSync(resolve(DIR, f), 'utf8');

describe('日期模拟 UI 守卫（防退化）', () => {
  it('模拟 UI 不引用已删字段 elapsedDays', () => {
    for (const f of ['DayTimeline.vue', 'SimulatedDaySettings.vue', 'SessionCockpit.vue']) {
      expect(read(f)).not.toMatch(/elapsedDays/);
    }
  });

  it('DayTimeline：进度取自服务端 dayIndex，不做前端时间换算', () => {
    const text = read('DayTimeline.vue');
    expect(text).not.toMatch(/new Date\(/);
    expect(text).not.toMatch(/Date\.now\(/);
    expect(text).toMatch(/dayIndex/);
  });

  it('SimulatedDaySettings：不做前端时间换算', () => {
    const text = read('SimulatedDaySettings.vue');
    expect(text).not.toMatch(/new Date\(/);
    expect(text).not.toMatch(/Date\.now\(/);
  });

  it('adminApi 保留日期模拟契约方法', () => {
    const text = readFileSync(API, 'utf8');
    for (const m of [
      'getVirtualSessionSimulationClock',
      'getVirtualSessionDayTimeline',
      'advanceVirtualSessionDay',
      'resetVirtualSessionClock',
      'updateSessionSimulationConfig',
    ]) {
      expect(text).toMatch(new RegExp(`${m}:`));
    }
    expect(text).toMatch(/dateSimulation/);
  });

  it('座舱通过 API 读取模拟时钟（不在前端推导）', () => {
    const text = read('SessionCockpit.vue');
    expect(text).toMatch(/getVirtualSessionSimulationClock/);
  });
});
