/**
 * 路径页三件套（2026-11-18 方向三/五）：
 * ① 渐进式课表：未来阶段只有骨架 → 阶段体显示「课表待解锁」，进度显示「待解锁」；
 * ② KC 胶囊：每节课标题下透出 path-kc-mapping 算出的能力单元；
 * ③ 极速模式 + 终局交付物卡：flexible 课可隐藏，成果锚点常驻。
 *
 * 这里锁的是模板入口与数据字段名——字段由 path-views.queries 注入（kcs/adjustability/firstDeliverable/pathTopology），
 * 改名不锁会静默退化成「空胶囊」。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPathDetail.vue'), 'utf8');

describe('V2LearningPathDetail 渐进式课表与 KC 胶囊', () => {
  it('空任务的未来阶段显示「课表待解锁」，不渲染成空壳', () => {
    expect(source).toContain('v-if="!stageTasks(stage).length"');
    expect(source).toContain('课表待解锁');
    expect(source).toContain(": '待解锁'");
  });

  it('任务行渲染 KC 胶囊（kcs[].name）', () => {
    expect(source).toContain('class="task__kcs"');
    expect(source).toContain('v-for="kc in task.kcs"');
    expect(source).toContain('{{ kc.name }}');
  });

  it('课程安排展示全部阶段与任务（不设隐藏选修的假筛选开关）', () => {
    expect(source).not.toContain('v-model="coreOnly"');
    expect(source).toContain('v-for="task in stageTasks(stage)"');
    expect(source).toContain('课程安排');
  });

  it('终局交付物卡与拓扑徽标使用后端字段', () => {
    expect(source).toContain('class="hero__deliverable"');
    expect(source).toContain('finalDeliverable');
    expect(source).toContain('走完会拿到');
    expect(source).toContain('TOPOLOGY_LABELS');
    expect(source).toContain('topologyLabel');
  });
});
