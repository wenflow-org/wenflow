/**
 * 路径名称交付口径（path-naming.ts）单测。
 *
 * 背景：路径名做成"主题 + 水平词"后，全库 76% 名称含水平词（「入门」独占 170 条），
 * 且 name/title/subject 三列同值 ⇒ 用户第一眼读到"入门"（描述起点，被读成终点）。
 * 本模块负责把水平词从**用户可见名称**里确定剔除，同时保护主题词（系统/基础在中部）。
 */
import { DELIVERY_LEVEL_WORDS, stripDeliveryLevelWords } from '../path-naming';

describe('stripDeliveryLevelWords', () => {
  it('剔除末尾水平词', () => {
    expect(stripDeliveryLevelWords('几何证明条件推方向入门')).toEqual({
      title: '几何证明条件推方向',
      stripped: ['入门'],
    });
    expect(stripDeliveryLevelWords('数据分析实战').title).toBe('数据分析');
    expect(stripDeliveryLevelWords('理工英语语法零基础').title).toBe('理工英语语法');
  });

  it('连续剔除末尾水平词', () => {
    const r = stripDeliveryLevelWords('Excel 报表基础入门');
    expect(r.title).toBe('Excel 报表');
    expect(r.stripped).toEqual(['入门', '基础']);
  });

  it('剔除开头水平前缀', () => {
    expect(stripDeliveryLevelWords('从零开始学 Excel 合并').title).toBe('学 Excel 合并');
    expect(stripDeliveryLevelWords('零基础 Python 自动化').title).toBe('Python 自动化');
  });

  it('保护主题词：中部的「基础/系统」不动', () => {
    expect(stripDeliveryLevelWords('基础理财规划').stripped).toEqual([]);
    expect(stripDeliveryLevelWords('知识管理系统搭建').stripped).toEqual([]);
    expect(stripDeliveryLevelWords('会计系统操作入门').title).toBe('会计系统操作');
  });

  it('整名就是水平词 → 保持原样（不产出空标题）', () => {
    expect(stripDeliveryLevelWords('入门')).toEqual({ title: '入门', stripped: [] });
    expect(stripDeliveryLevelWords('零基础')).toEqual({ title: '零基础', stripped: [] });
  });

  it('未命中时零改动', () => {
    expect(stripDeliveryLevelWords('客服接电话前触发动作训练')).toEqual({
      title: '客服接电话前触发动作训练',
      stripped: [],
    });
  });

  it('幂等', () => {
    const once = stripDeliveryLevelWords('限时卡题断手翻页训练入门').title;
    expect(stripDeliveryLevelWords(once).title).toBe(once);
  });

  it('空/非字符串安全', () => {
    expect(stripDeliveryLevelWords('').title).toBe('');
    expect(stripDeliveryLevelWords(undefined as unknown as string).title).toBe('');
  });

  it('词表本身不含「系统」（防误伤主题词）', () => {
    expect((DELIVERY_LEVEL_WORDS as readonly string[]).includes('系统')).toBe(false);
  });
});
