/**
 * #9 回归：协议页表单「装载 → 回写」往返必须保持字段逐项不变。
 *
 * 病根：`toFormField` / `toCoreFieldPayload` 此前只映射 name/type/desc/turn，
 * 丢掉嵌套 `properties` 与 `enumValues`；于是「无编辑保存」时后端语义等价守卫
 * （coreFileSemanticallyEqual）判不等，走到全量序列化把嵌套子字段 schema 静默删掉。
 * 本用例钉住这两个投影函数对嵌套结构的保真（kc-mapper / concept-load-estimator 即此形态）。
 */
import { describe, expect, it } from 'vitest';
import { toFormField, toCoreFieldPayload, type CoreFormField } from '../skill-design/sdp-shared';

/** 从 CoreFile 字段数组出发，走「装载 → 回写」一次，返回回写结果 */
function roundTrip(coreFields: unknown[]) {
  const form: CoreFormField[] = coreFields.map(toFormField);
  return form.map(toCoreFieldPayload);
}

describe('core 字段装载/回写往返（#9）', () => {
  it('嵌套 properties（含再一层 properties）原样保留', () => {
    const coreFields = [
      {
        name: 'gapCoverage',
        type: 'object',
        desc: '缺口覆盖',
        turn: false,
        properties: [
          { name: 'covered', type: 'string[]', desc: '已覆盖', turn: false },
          {
            name: 'uncovered',
            type: 'object[]',
            desc: '未覆盖',
            turn: false,
            properties: [{ name: 'concept', type: 'string', desc: '概念', turn: false }]
          }
        ]
      }
    ];
    expect(roundTrip(coreFields)).toEqual(coreFields);
  });

  it('enumValues 原样保留', () => {
    const coreFields = [
      { name: 'status', type: 'enum', desc: '状态', turn: false, enumValues: ['a', 'b'] }
    ];
    expect(roundTrip(coreFields)).toEqual(coreFields);
  });

  it('扁平字段不受影响，? 后缀往返一致', () => {
    const coreFields = [
      { name: 'note', type: 'string?', desc: '备注', turn: true }
    ];
    expect(roundTrip(coreFields)).toEqual(coreFields);
  });

  it('空 enumValues / properties 数组不落键（与后端 normalize 口径一致）', () => {
    const coreFields = [{ name: 'x', type: 'string', desc: 'd', turn: false, enumValues: [], properties: [] }];
    const out = roundTrip(coreFields) as Array<Record<string, unknown>>;
    expect(out[0]).not.toHaveProperty('enumValues');
    expect(out[0]).not.toHaveProperty('properties');
  });
});
