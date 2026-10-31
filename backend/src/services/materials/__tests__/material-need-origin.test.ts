import { inferMaterialOrigin, partitionMaterialNeeds } from '../material-need-origin';
import type { MaterialNeed } from '../../../skills/material-collector/types';

describe('material-need-origin', () => {
  it('显式 origin 优先于文本启发式', () => {
    expect(inferMaterialOrigin({ title: '内部自研手册', origin: 'public' })).toBe('public');
    expect(inferMaterialOrigin({ title: '国家法规原文', origin: 'private' })).toBe('private');
  });

  it('私有/内部信号判 private', () => {
    const cases: Array<Partial<MaterialNeed>> = [
      { kind: '手册', title: '内部自研 DSL 规则引擎算子语义手册' },
      { kind: '内部规范性文件', title: '2026 技术序列晋升举证红皮书' },
      { kind: '字典', title: '旧库 40 张核心表无外键隐式关联字典说明' },
      { kind: '实验室内控手册', title: '本实验室钙钛矿旋涂与退火内控手册' },
      { kind: '私有协议', title: 'HX-900 工业机械臂 RS485 私有二进制协议表' },
    ];
    for (const need of cases) {
      expect(inferMaterialOrigin(need as MaterialNeed)).toBe('private');
    }
  });

  it('公开权威资料判 public', () => {
    const cases: Array<Partial<MaterialNeed>> = [
      { kind: '标准', title: 'CY/T 124-2015 学术出版规范 一般要求' },
      { kind: '规范', title: 'Model Context Protocol Specification 2026-07-28' },
      { kind: '法规', title: '中华人民共和国公司法（2023 修订）' },
      { kind: '指南', title: 'KDIGO 2024 CKD Guideline' },
    ];
    for (const need of cases) {
      expect(inferMaterialOrigin(need as MaterialNeed)).toBe('public');
    }
  });

  it('无信号时默认 public（保留现有检索行为，不因漏标少采）', () => {
    expect(inferMaterialOrigin({ title: 'React 19 Actions' })).toBe('public');
    expect(inferMaterialOrigin({ title: '' })).toBe('public');
  });

  it('partition 按来源域拆分且不丢项', () => {
    const needs: MaterialNeed[] = [
      { title: '内部自研 DSL 手册' },
      { title: '中华人民共和国公司法' },
      { title: '本公司无外键字典' },
      { title: 'CY/T 124-2015 学术出版规范' },
    ];
    const { publicNeeds, privateNeeds } = partitionMaterialNeeds(needs);
    expect(privateNeeds.map((n) => n.title)).toEqual(['内部自研 DSL 手册', '本公司无外键字典']);
    expect(publicNeeds.map((n) => n.title)).toEqual(['中华人民共和国公司法', 'CY/T 124-2015 学术出版规范']);
  });
});
