/**
 * 未登记常量只读报告（`constants:report`）的纯函数回归：
 * - 只认**顶格**的模块级数字常量（含 export / as const），函数体内缩进常量不算；
 * - 登记判定按"名字在登记表源码中出现"；
 * - 报告按文件分组、给出 file:line、统计 scanned/registered/unregistered。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  findNumericModuleConstants,
  isRegisteredConstantName,
  buildUnregisteredReport,
} from '../../services/prompt-manifest/report-unregistered-constants';

describe('findNumericModuleConstants', () => {
  it('抓顶格 const 与 export const（含 as const）', () => {
    const source = [
      'export const A = 1;',
      "export const B = 0.85;",
      'const C = 42 as const;',
      'export const D = 90;',
    ].join('\n');
    const findings = findNumericModuleConstants(source, 'x.ts');
    expect(findings.map((f) => f.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(findings[0]).toMatchObject({ value: 1, file: 'x.ts', line: 1 });
    expect(findings[1].value).toBe(0.85);
    expect(findings[2].value).toBe(42);
  });

  it('忽略函数体内的缩进常量（局部量不是模块级常量）', () => {
    const source = [
      'function f() {',
      '  const local = 3;',
      '  return local;',
      '}',
      'export const top = 4;',
    ].join('\n');
    const findings = findNumericModuleConstants(source, 'x.ts');
    expect(findings.map((f) => f.name)).toEqual(['top']);
  });

  it('忽略非数字初始化与字符串常量', () => {
    const source = [
      "export const NAME = 'x';",
      'export const OBJ = { a: 1 };',
      'export const NUM = 7;',
    ].join('\n');
    expect(findNumericModuleConstants(source, 'x.ts').map((f) => f.name)).toEqual(['NUM']);
  });
});

describe('isRegisteredConstantName', () => {
  it('名字在登记表源码中出现 → 视为已登记（词边界匹配）', () => {
    const registry = "resolve: () => AGGREGATION_ACTIVE_WINDOW_DAYS,";
    expect(isRegisteredConstantName('AGGREGATION_ACTIVE_WINDOW_DAYS', registry)).toBe(true);
    // 词边界：前缀同名不算
    expect(isRegisteredConstantName('AGGREGATION_ACTIVE', registry)).toBe(false);
  });
});

describe('buildUnregisteredReport', () => {
  it('按文件分组列出未登记常量，并给出 scanned/registered/unregistered 汇总', () => {
    const registrySource = 'resolve: () => A;';
    const report = buildUnregisteredReport({
      files: [
        { file: 'a.ts', source: 'export const A = 1;\nexport const B = 2;' },
        { file: 'b.ts', source: 'const C = 3;' },
      ],
      registrySource,
    });
    expect(report.scanned).toBe(3);
    expect(report.registered).toBe(1);
    expect(report.unregistered).toBe(2);
    expect(report.byFile).toHaveLength(2);
    expect(report.byFile[0]).toMatchObject({ file: 'a.ts' });
    expect(report.byFile[0].items.map((i) => i.name)).toEqual(['B']);
    expect(report.byFile[1].items[0]).toMatchObject({ name: 'C', file: 'b.ts', line: 1 });
  });

  it('全部登记 → 无分组、unregistered=0', () => {
    const report = buildUnregisteredReport({
      files: [{ file: 'a.ts', source: 'export const A = 1;' }],
      registrySource: 'resolve: () => A;',
    });
    expect(report.byFile).toEqual([]);
    expect(report.unregistered).toBe(0);
    expect(report.registered).toBe(1);
  });

  it('真实登记表：已覆盖本仓部分状态回路常量（冒烟）', () => {
    // 用真实登记表源码判断几个确定已登记的名字
    const registrySource = fs.readFileSync(
      path.resolve(__dirname, '..', 'constants-provenance.ts'),
      'utf8',
    );
    for (const name of ['AGGREGATION_ACTIVE_WINDOW_DAYS', 'DEFAULT_DAILY_LOAD_LIMIT', 'MAX_SINGLE_LOAD']) {
      expect(isRegisteredConstantName(name, registrySource)).toBe(true);
    }
  });
});
