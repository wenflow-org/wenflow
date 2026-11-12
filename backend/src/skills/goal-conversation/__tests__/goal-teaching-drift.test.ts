/**
 * goal 对话讲课漂移检测（2026-11-12 实证 gc_1794449336845）：
 * 用户说「你给我讲」，导师切讲课模式成段授课，阶段停在 understanding、
 * 确认面板永不出現——goal 对话漂移成没有出口的教学回合。
 */
import { assessGoalTeachingDrift } from '../index';

/** 2026-11-12 实测的讲课形态（节选改写）：小标题成段 + 长文 */
const LECTURE = [
  '行，那就不绕路径，直接把这件事从头讲一遍。',
  '**先翻最底下那块：大模型本体只会干一件事——接龙。**它每次被调用，看到的只有一段文本，然后一个字一个字往外吐下一段文本。它不记得你上一句说了什么。',
  '**Agent，就是给这张嘴配上体外的器官。**一个 Agent = 大模型 + 一个反复转的循环 + 一双手（工具）+ 一块随时往里塞东西的记事板。',
  '**循环每一圈都在做同一件事：看板、想、动手、把结果写回板。**看板就是读上下文，想就是模型生成下一步，动手就是把工具指令交给外面那层程序去执行，执行完的结果再以文本形式写回记事板，供下一圈读。',
  '**为什么它会一本正经地调一个不存在的工具？**因为工具清单也是文本——模型只见过清单里那几行字，它吐出的工具名是「像清单里那样」的猜测，外面那层程序一对照清单发现没有，就报错回填。',
  '**为什么它常常绕圈停不下来？**每一圈它读到的都是「目标 + 已经做过的事」，没有一行告诉它「这步办过了」，于是它按同样的逻辑再发一次同样的指令，直到外面那层程序按最大步数把它喊停。',
  '**为什么聊到后面它忘了你开头说的限定？**记事板容量有限，最早写进去的那句「只处理北京」被中间几十轮工具结果挤了出去，它当轮根本看不到那句话，自然就开始处理别的城市。',
].join('\n');

describe('assessGoalTeachingDrift（讲课漂移检测）', () => {
  it('2026-11-12 实测形态：≥2 个粗体小标题 + ≥400 字 → 命中', () => {
    const result = assessGoalTeachingDrift(LECTURE, 'understanding');
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('GOAL_TEACHING_DRIFT');
    expect(result.violations?.[0]).toContain('讲课形态');
  });

  it('正常的理解期回复（短、无小标题）→ 不命中', () => {
    expect(assessGoalTeachingDrift('那就从头到尾拉通一条线——拿「模型每次只看得到一段文本」当主线，三块全挂在这条线上讲。这样排可以吗？', 'understanding').valid).toBe(true);
  });

  it('最简定位式答疑（≤3 句概念锚点 + 转回方案）→ 不命中', () => {
    const ok = '一句话锚点：Agent＝大模型＋循环＋工具＋记事板，展开讲正是这条路径的主线。从头讲透它就是第一段的核心——方案定下来，第一课就从最底下那块讲起。';
    expect(assessGoalTeachingDrift(ok, 'understanding').valid).toBe(true);
  });

  it('proposing 阶段的方案轮廓（无小标题、中等长度）→ 不命中', () => {
    const proposal = '方向定了：第一段先立主线，搞清楚记忆和规划落在哪（过关口：能解释一个产品为什么忘了你上一轮说的话）；第二段把一次任务的循环拆开走一遍；第三段拿几个没见过的 Agent 行为当场预判。单次大概坐 25 分钟，先看方案？';
    expect(assessGoalTeachingDrift(proposal, 'proposing').valid).toBe(true);
  });

  it('超长回复（≥800 字）即使无小标题也命中（成段预演同样是越界）', () => {
    const long = '机制讲解。'.repeat(200);
    expect(assessGoalTeachingDrift(long, 'understanding').valid).toBe(false);
  });

  it('空 reply 安全通过', () => {
    expect(assessGoalTeachingDrift('', 'understanding').valid).toBe(true);
  });
});
