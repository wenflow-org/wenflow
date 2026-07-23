/** 全套重设计稿共享的故事线数据（演示用，不落库） */

export type TaskStatus = 'completed' | 'current' | 'todo' | 'locked';

export interface MockTask {
  id: string;
  title: string;
  desc?: string;
  minutes: number;
  status: TaskStatus;
  kind: string;
}

export interface MockStage {
  no: number;
  title: string;
  goal: string;
  status: 'done' | 'current' | 'todo';
  tasks: MockTask[];
}

export const mainPath = {
  id: 'lp_mock_excel',
  title: 'Excel 报表自动化',
  sub: '每天 1 小时 · 目标 1 周',
  desc: '用 Python 和 pandas 写一个脚本，自动把销售报表合并进汇总表，点一下就能跑。',
  hours: 5,
  percent: 40,
  stages: <MockStage[]>[
    {
      no: 1,
      title: 'Python 环境搭建与基础概念',
      goal: '装好 Python，理解变量和文件路径',
      status: 'done',
      tasks: [
        { id: 't11', title: '安装 Python 并跑通第一行代码', minutes: 15, status: 'completed', kind: '操作' },
        { id: 't12', title: '变量、字符串和文件路径', minutes: 15, status: 'completed', kind: '概念' },
        { id: 't13', title: '小练习：找到你的报表文件', minutes: 10, status: 'completed', kind: '练习' }
      ]
    },
    {
      no: 2,
      title: 'pandas 读取单个 Excel 文件',
      goal: '能用 read_excel 读出报表并预览数据',
      status: 'current',
      tasks: [
        { id: 't21', title: 'pandas 入门：DataFrame 是什么', minutes: 15, status: 'completed', kind: '概念' },
        { id: 't22', title: '用 pandas 读取销售报表，预览前 5 行', minutes: 25, status: 'current', kind: '练手任务' },
        { id: 't23', title: '看懂 read_excel 的 3 个常用参数', minutes: 15, status: 'todo', kind: '概念巩固' },
        { id: 't24', title: '阶段小测：读出并描述你的报表', minutes: 10, status: 'locked', kind: '检查点' }
      ]
    },
    {
      no: 3,
      title: '将数据写入 / 追加到汇总表',
      goal: '把读出的数据追加进汇总表，纯数据无需格式',
      status: 'todo',
      tasks: [
        { id: 't31', title: 'concat 合并多个 DataFrame', minutes: 20, status: 'locked', kind: '概念' },
        { id: 't32', title: 'to_excel 写出与追加模式', minutes: 20, status: 'locked', kind: '操作' },
        { id: 't33', title: '实战：合并 3 张销售报表', minutes: 30, status: 'locked', kind: '实战' }
      ]
    },
    {
      no: 4,
      title: '封装脚本并测试',
      goal: '脚本可重复运行，改路径不用改代码',
      status: 'todo',
      tasks: [
        { id: 't41', title: '把代码封装成 main() 函数', minutes: 20, status: 'locked', kind: '操作' },
        { id: 't42', title: '完整测试：一键合并今日报表', minutes: 15, status: 'locked', kind: '验收' }
      ]
    }
  ]
};

export const currentTask = mainPath.stages[1].tasks[1];

export interface MockAchievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  xp: number;
  type: '里程碑' | '连续学习' | '完成度' | '知识掌握';
  unlocked: boolean;
  current: number;
  total: number;
  earnedAt?: string;
}

export const achievements: MockAchievement[] = [
  { id: 'a1', name: '第一步', desc: '完成第一次学习', icon: 'flag', xp: 20, type: '里程碑', unlocked: true, current: 1, total: 1, earnedAt: '7月13日' },
  { id: 'a2', name: '连续 2 天', desc: '连续学习 2 天', icon: 'flame', xp: 30, type: '连续学习', unlocked: true, current: 2, total: 2, earnedAt: '7月18日' },
  { id: 'a3', name: '小步快跑', desc: '完成 3 次学习', icon: 'bolt', xp: 40, type: '完成度', unlocked: false, current: 2, total: 3 },
  { id: 'a4', name: '七日不断', desc: '连续学习 7 天', icon: 'flame', xp: 80, type: '连续学习', unlocked: false, current: 2, total: 7 },
  { id: 'a5', name: '路径开拓者', desc: '创建第一条学习路径', icon: 'map', xp: 50, type: '里程碑', unlocked: false, current: 1, total: 1 },
  { id: 'a6', name: '阶段征服者', desc: '完成一个完整阶段', icon: 'medal', xp: 60, type: '完成度', unlocked: false, current: 1, total: 2 },
  { id: 'a7', name: 'pandas 新手', desc: '掌握 5 个 pandas 知识点', icon: 'book', xp: 60, type: '知识掌握', unlocked: false, current: 3, total: 5 },
  { id: 'a8', name: '学以致用', desc: '完成一次实战任务', icon: 'target', xp: 100, type: '知识掌握', unlocked: false, current: 0, total: 1 }
];
