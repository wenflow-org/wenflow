/**
 * 教学图视觉语言（2026-10-19）：把「颜色/字阶/圆角/线宽/阴影」从渲染器里抽出来变成令牌。
 *
 * 为什么要有这一层：89 张离线图审计显示，颜色只有 18 种、白底出现 658 次、13px 字号出现
 * 409 次、描边几乎全是 1.1/1.2px —— 每张图同一套骨架，所以「看起来很单调」。
 *
 * 三条约束（来自多媒体学习研究，避免为了好看而加料）：
 *   ① **信号优先于装饰**：变化放在「谁更重要」上（字阶、色阶、焦点强调、结构形状），
 *      不加插画/纹理/背景音乐这类会分散注意的 seductive details（Mayer）。
 *   ② **形状要承载语义**：容器=所属、天平=权衡、阶梯=层级，不是给方框换颜色。
 *   ③ **同 spec 同图**：主题只影响观感，不改变任何数值与布局判据。
 */

export type FigurePalette = 'indigo' | 'earth' | 'tech' | 'warm' | 'violet' | 'mono';

export interface FigureTheme {
  id: string;
  /** 正文主色 */
  ink: string;
  /** 次级文字 */
  muted: string;
  /** 三级文字 / 脚注 */
  faint: string;
  /** 描边 */
  line: string;
  lineStrong: string;
  /** 画布 / 卡片 */
  surface: string;
  /** 面板底（弱） */
  soft: string;
  /** 语义强调色（焦点、主关系） */
  accent: string;
  accentSoft: string;
  /** 压在 accentSoft 上的文字 */
  accentInk: string;
  warn: string;
  warnSoft: string;
  ok: string;
  okSoft: string;
  /** 结构：圆角、线宽 */
  radius: number;
  stroke: number;
  strokeStrong: number;
  /** 字阶（px） */
  fontHero: number;
  fontTitle: number;
  fontKey: number;
  fontBody: number;
  fontSmall: number;
  fontMicro: number;
  /** 是否有极轻投影（只给焦点/卡片，制造层次，不是装饰） */
  shadow: boolean;
}

/** 基础字阶与结构：在所有调色板上共用，保证「换色不换骨」。 */
const BASE = {
  radius: 10,
  stroke: 1.15,
  strokeStrong: 1.7,
  fontHero: 30,
  fontTitle: 17,
  fontKey: 14.5,
  fontBody: 13.5,
  fontSmall: 12,
  fontMicro: 11,
  shadow: true,
};

const PALETTES: Record<FigurePalette, Omit<FigureTheme, keyof typeof BASE | 'id'>> = {
  /* 默认：靛蓝（现有的产品主色，向后兼容） */
  indigo: {
    ink: '#1f2430',
    muted: '#5b6474',
    faint: '#8b93a3',
    line: '#c3c9d4',
    lineStrong: '#7d8798',
    surface: '#ffffff',
    soft: '#f5f6f9',
    accent: '#4f46e5',
    accentSoft: '#eceafe',
    accentInk: '#3730a3',
    warn: '#b45309',
    warnSoft: '#fdf3e6',
    ok: '#0f766e',
    okSoft: '#e6f4f1',
  },
  /* 地理 / 人文：土与水的暖棕 + 墨绿，避开「后台仪表盘」的冷灰 */
  earth: {
    ink: '#2b241c',
    muted: '#6b5f52',
    faint: '#94897c',
    line: '#d8cdbe',
    lineStrong: '#9a8c76',
    surface: '#fffdf9',
    soft: '#f7f1e7',
    accent: '#1f6f5c',
    accentSoft: '#e3f0ea',
    accentInk: '#155546',
    warn: '#a35a1a',
    warnSoft: '#fbeee0',
    ok: '#3f6f2a',
    okSoft: '#ecf3e4',
  },
  /* 计算机 / 系统：石板蓝 + 青，接近终端但可读 */
  tech: {
    ink: '#16202b',
    muted: '#52616f',
    faint: '#82919f',
    line: '#c8d2dc',
    lineStrong: '#7d8f9f',
    surface: '#ffffff',
    soft: '#f2f6f9',
    accent: '#0e7490',
    accentSoft: '#e0f2f7',
    accentInk: '#0b5b70',
    warn: '#b45309',
    warnSoft: '#fdf3e6',
    ok: '#13702f',
    okSoft: '#e8f5ec',
  },
  /* 棋类 / 语言：纸与朱砂 */
  warm: {
    ink: '#2a2320',
    muted: '#6d5f58',
    faint: '#9a8c84',
    line: '#ddcfc6',
    lineStrong: '#a08a7e',
    surface: '#fffdfa',
    soft: '#f8f1ec',
    accent: '#a8322a',
    accentSoft: '#f8e6e3',
    accentInk: '#82241e',
    warn: '#8a5a12',
    warnSoft: '#fbf0dc',
    ok: '#3f6f4f',
    okSoft: '#e9f2ec',
  },
  /* 心理 / 教育理论：紫 + 琥珀 */
  violet: {
    ink: '#231f2e',
    muted: '#5f5770',
    faint: '#8d86a0',
    line: '#d3cddf',
    lineStrong: '#948cab',
    surface: '#ffffff',
    soft: '#f6f4fa',
    accent: '#6d3fc4',
    accentSoft: '#efe9fb',
    accentInk: '#532f96',
    warn: '#a16207',
    warnSoft: '#fdf5e3',
    ok: '#0f766e',
    okSoft: '#e6f4f1',
  },
  /* 单色：只靠字阶与线宽制造层次（打印/暗色底/需要压色时用） */
  mono: {
    ink: '#17181c',
    muted: '#575b63',
    faint: '#8b9099',
    line: '#c9ccd2',
    lineStrong: '#777c86',
    surface: '#ffffff',
    soft: '#f4f5f7',
    accent: '#17181c',
    accentSoft: '#e9eaee',
    accentInk: '#17181c',
    warn: '#3f3f46',
    warnSoft: '#eef0f2',
    ok: '#3f3f46',
    okSoft: '#eef0f2',
  },
};

/** 学科 → 调色板。判据取「讲的是什么」，不取界面语言。 */
const SUBJECT_PALETTES: Array<{ test: RegExp; palette: FigurePalette }> = [
  { test: /地理|区位|气候|地形|水文|人口迁移|城市|农业|工业区/, palette: 'earth' },
  { test: /心理|教育|动机|信度|效度|学习理论|认知|发展/, palette: 'violet' },
  { test: /象棋|围棋|棋盘|古文|诗词|写作|语言|幼儿园|五大领域/, palette: 'warm' },
  { test: /代码|程序|算法|数据库|共识|分布式|日志|系统|网络|前端|后端|并发|张量|模型/, palette: 'tech' },
];

export function paletteOfSubject(subject?: string | null): FigurePalette {
  const text = String(subject ?? '');
  for (const entry of SUBJECT_PALETTES) {
    if (entry.test.test(text)) return entry.palette;
  }
  return 'indigo';
}

export function resolveTheme(palette: FigurePalette | undefined, id?: string): FigureTheme {
  const key = palette && PALETTES[palette] ? palette : 'indigo';
  return { id: id || key, ...BASE, ...PALETTES[key] };
}

/**
 * 调色板 → 画布材质。人文学科给纸纹（暖、像教具），工程/系统类保持净白（像文档），
 * 默认靛蓝不加材质——先让「换学科才有变化」，避免全站突然铺满纹理。
 */
export function materialForPalette(palette: FigurePalette | undefined): 'none' | 'paper' | 'grid' {
  if (palette === 'earth' || palette === 'warm' || palette === 'violet') return 'paper';
  return 'none';
}

export const FIGURE_PALETTE_KEYS = Object.keys(PALETTES) as FigurePalette[];
