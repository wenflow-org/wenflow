import {
  resolvePathRawGoalFromSession,
  resolveStorySessionDemand,
} from '../story-demand';

describe('story-demand (故事需求经 Goal 传递，不改 Path)', () => {
  const story = {
    storyId: 'story_1',
    visibleOpening: '我交稿总是拖到最后一天，想改掉这个习惯',
    triggerEvent: '客户投诉质量不行',
    outline: '专栏合作拖稿',
    goalSeed: {
      surfaceGoal: '学会时间管理',
      realProblem: '截止日前逃避写作',
    },
  };

  it('优先 visibleOpening 作为当次诉求', () => {
    const r = resolveStorySessionDemand({
      story,
      profileLearningGoal: '画像上的长期倾向',
    });
    expect(r.text).toBe(story.visibleOpening);
    expect(r.source).toBe('story.visibleOpening');
    expect(r.storyId).toBe('story_1');
  });

  it('无 visibleOpening 时用 goalSeed.surfaceGoal', () => {
    const r = resolveStorySessionDemand({
      story: { ...story, visibleOpening: '' },
      profileLearningGoal: '画像倾向',
    });
    expect(r.text).toBe('学会时间管理');
    expect(r.source).toBe('story.goalSeed.surfaceGoal');
  });

  it('故事缺诉求时才兜底画像 learningGoal', () => {
    const r = resolveStorySessionDemand({
      story: { storyId: 's2', title: '空故事' },
      profileLearningGoal: '长期想补职场工具',
    });
    expect(r.text).toBe('长期想补职场工具');
    expect(r.source).toBe('profile.learningGoal');
  });

  it('Path rawGoal 优先 Goal conversation.description（正式传递）', () => {
    const r = resolvePathRawGoalFromSession({
      goalConversationDescription: '开场已写入 Goal 的诉求',
    });
    expect(r.rawGoal).toBe('开场已写入 Goal 的诉求');
    expect(r.source).toBe('goal.conversation.description');
  });

  it('Goal 无 description 时拒绝生成 Path，不能旁路读取故事', () => {
    const r = resolvePathRawGoalFromSession({
      goalConversationDescription: '',
    });
    expect(r.rawGoal).toBe('');
    expect(r.source).toBe('none');
  });

  it('无故事无画像时返回空，由调用方拒绝推进', () => {
    const demand = resolveStorySessionDemand({});
    expect(demand.text).toBe('');
    expect(demand.source).toBe('none');
    const path = resolvePathRawGoalFromSession({});
    expect(path.rawGoal).toBe('');
    expect(path.source).toBe('none');
  });
});
