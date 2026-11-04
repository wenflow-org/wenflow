/**
 * #228 残余：路径完成态文案的单一分档——GET 快照与「已完成会话 /reply 早退」必须同口径。
 *
 * 权威信号是活动 run 推导的 lifecycle（ready / core_processing / stage_design_processing /
 * stage_design_failed / failed），不是 `learning_paths.status`：status 在 stage design 窗口
 * 恒为 active，只看它会在 25-50 秒窗口里谎称「学习路径已生成」，并且让同一响应体内部
 * （userVisible 说已生成 × learningPath.status='generating'）自相矛盾。
 *
 * 这里直接驱动两个纯构造函数（不落 DB），逐态断言「两接口说同一档」，并把「正在生成」
 * 钉死在 /reply 同源常量上。
 */
import {
  buildCompletedConversationResult,
  resolveConversationUserVisible,
  PATH_COMPLETED_USER_VISIBLE,
  PATH_GENERATING_USER_VISIBLE,
} from '../goal-conversation.exit';

const READY_TEXT = '学习路径已生成：手冲咖啡入门';
const FAILED_TEXT = '学习路径生成失败，可前往“学习路径”重试。';

type Tone = 'ready' | 'generating' | 'failed';

/** 从文案反推口径：用来断言「两接口同档」，而不依赖各自的句式 */
function toneOf(text: string): Tone {
  if (text.includes('生成失败')) return 'failed';
  if (text.includes('正在生成')) return 'generating';
  // GET 用「已生成：<名字>」、/reply 沿用「已经生成，可以去查看啦！」：同档、句式各异
  if (text.includes('已经生成') || text.includes('已生成')) return 'ready';
  throw new Error(`未识别的完成态文案：${text}`);
}

const CASES: Array<{ lifecycle: string; tone: Tone }> = [
  { lifecycle: 'ready', tone: 'ready' },
  { lifecycle: 'core_processing', tone: 'generating' },
  { lifecycle: 'stage_design_processing', tone: 'generating' },
  { lifecycle: 'stage_design_failed', tone: 'failed' },
  { lifecycle: 'core_failed', tone: 'failed' },
];

const COLLECTED = JSON.stringify({ messages: [], understanding: {}, collected: {} });

function getSnapshotText(lifecycle: string | null, status: string) {
  return resolveConversationUserVisible({
    conversationId: 'gc-1',
    status: 'completed',
    collectedData: COLLECTED,
    learningPathId: 'lp-1',
    learningPath: { id: 'lp-1', name: '手冲咖啡入门', status, lifecycle },
    messages: [],
  });
}

async function replyEarlyExitText(lifecycle: string | null, status: string) {
  const result = await buildCompletedConversationResult({
    conversationId: 'gc-1',
    collectedData: COLLECTED,
    learningPathId: 'lp-1',
    findPath: async () => ({ id: 'lp-1', status, lifecycle }),
  });
  return result.userVisible as string;
}

describe('#228 路径完成态文案：GET 快照与 /reply 早退同口径', () => {
  for (const { lifecycle, tone } of CASES) {
    it(`lifecycle=${lifecycle}：两个接口给同一档文案，且不说反话`, async () => {
      // status 故意取 stage design 窗口里的真实值 'active'（core 落库即写 active）
      const getText = getSnapshotText(lifecycle, 'active');
      const replyText = await replyEarlyExitText(lifecycle, 'active');

      expect(toneOf(getText as string)).toBe(tone);
      expect(toneOf(replyText)).toBe(tone);

      if (tone === 'generating') {
        // 生成中逐字同源（复用 /reply 常量，不再两处各写一套）
        expect(getText).toBe(PATH_GENERATING_USER_VISIBLE);
        expect(replyText).toBe(PATH_GENERATING_USER_VISIBLE);
      }
      if (tone === 'failed') {
        expect(getText).toBe(FAILED_TEXT);
        expect(replyText).toBe(FAILED_TEXT);
      }
      if (tone !== 'ready') {
        expect(getText).not.toContain('已生成');
        expect(getText).not.toContain('已经生成');
        expect(replyText).not.toContain('已生成');
        expect(replyText).not.toContain('已经生成');
      }
    });
  }

  it('ready 档：GET 给「已生成：<名字>」，/reply 沿用既有句；两者都只说已生成', () => {
    expect(getSnapshotText('ready', 'active')).toBe(READY_TEXT);
    return expect(replyEarlyExitText('ready', 'active')).resolves.toBe(PATH_COMPLETED_USER_VISIBLE);
  });

  it('lifecycle 缺失（投影失败）时退回 status 判定：active 仍按就绪文案，不误报生成中', async () => {
    expect(getSnapshotText(null, 'active')).toBe(READY_TEXT);
    await expect(replyEarlyExitText(null, 'active')).resolves.toBe(PATH_COMPLETED_USER_VISIBLE);
  });

  it('lifecycle 缺失但 status=generating：如实说正在生成（/reply 早退不再写死「已生成」）', async () => {
    expect(getSnapshotText(null, 'generating')).toBe(PATH_GENERATING_USER_VISIBLE);
    await expect(replyEarlyExitText(null, 'generating')).resolves.toBe(PATH_GENERATING_USER_VISIBLE);
  });

  it('lifecycle 缺失但 status=failed：如实报失败', async () => {
    expect(getSnapshotText(null, 'failed')).toBe(FAILED_TEXT);
    await expect(replyEarlyExitText(null, 'failed')).resolves.toBe(FAILED_TEXT);
  });

  it('/reply 早退在未绑路径时保持旧句（不在本次缺陷范围内，行为不变）', async () => {
    const result = await buildCompletedConversationResult({
      conversationId: 'gc-1',
      collectedData: COLLECTED,
      learningPathId: null,
      findPath: async () => null,
    });
    expect(result.userVisible).toBe(PATH_COMPLETED_USER_VISIBLE);
  });
});
