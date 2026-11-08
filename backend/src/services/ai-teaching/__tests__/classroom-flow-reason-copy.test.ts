/**
 * 前台课堂事件文案不得裸露算法公式（2026-11-08 走查）
 *
 * 学习台右侧「单日学习详情」抽屉的课堂事件里出现过：
 *   「17:15 知识状态低于任务难度（θ−d），进入干预」
 * ——那是 `decideStage` 的 reason 直接进了 classroomEventHistory，学生可见。
 * θ−d 是内部回合级知识追踪信号的注释用语，不应出现在给用户看的事件文本里。
 * 这里锁住：reason 里不许再出现希腊字母公式，且换成自然语言口径。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const source = fs.readFileSync(path.join(__dirname, '..', 'teaching-classroom-flow.ts'), 'utf-8');

/** 只看真正返回给学生的 reason 字面量，注释里解释 θ−d 信号是允许的 */
function reasonLiterals(): string[] {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return body.match(/reason:\s*(?:'|")[^'"]*(?:'|")/g) ?? [];
}

describe('intervention reason 面向学生的文案', () => {
  it('不再出现 θ−d 之类的裸露公式', () => {
    const reasons = reasonLiterals();
    expect(reasons.length).toBeGreaterThan(2); // 一条都没解析到会形同虚设
    for (const r of reasons) {
      expect(r).not.toMatch(/[θτ]|[−-]d/);
    }
  });

  it('掌握度不足的干预改为自然语言（任务略超掌握度 + 针对性辅导）', () => {
    expect(source).toContain('当前任务略超掌握度，已切入针对性辅导');
    expect(source).not.toContain('知识状态低于任务难度');
  });
});
