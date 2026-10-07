/**
 * 自然语言确认探测单测（2026-09-27 绕圈缺陷修复）。
 *
 * 真实缺陷复现样本放最前：proposing 阶段 AI 连续 5 轮"请在下面点一下确认"，
 * 用户回「就按这个来，确认」（快捷选项文本）推不动——修复后必须命中。
 * 精度优先：误确认 = 生成用户没要的路径，所以改需求/否决/疑问尾缀一律不认。
 */
import { isProposalConfirmationText, isExplicitRefusalText } from '../goal-conversation.confirm-text';

describe('isProposalConfirmationText（自然语言确认探测）', () => {
  it('真实缺陷样本：快捷选项文本「就按这个来，确认」命中', () => {
    expect(isProposalConfirmationText('就按这个来，确认')).toBe(true);
  });

  it('金料人设的真实确认话术命中（drive followUps 末句）', () => {
    expect(isProposalConfirmationText('两个月后孩子拿一道应用题给我，我能讲清思路。可以，生成吧。')).toBe(true);
    expect(isProposalConfirmationText('目标期末语法正确率 80%。可以，出方案吧。'.replace('出方案', '生成'))).toBe(true);
  });

  it('常见确认短语命中', () => {
    expect(isProposalConfirmationText('确认')).toBe(true);
    expect(isProposalConfirmationText('没问题')).toBe(true);
    expect(isProposalConfirmationText('好的')).toBe(true);
    expect(isProposalConfirmationText('行')).toBe(true);
    expect(isProposalConfirmationText('可以，生成吧')).toBe(true);
    expect(isProposalConfirmationText('就按这个来。谢谢！')).toBe(true);
    expect(isProposalConfirmationText('就这样，谢谢')).toBe(true);
    expect(isProposalConfirmationText('OK')).toBe(true);
    expect(isProposalConfirmationText('嗯嗯')).toBe(true);
    expect(isProposalConfirmationText('帮我生成学习路径吧')).toBe(true);
  });

  it('改需求/补充说明尾缀不确认（防止按旧数据生成）', () => {
    expect(isProposalConfirmationText('好，但预算改成每天 1 小时')).toBe(false);
    expect(isProposalConfirmationText('可以，不过我想把时长改成 3 个月')).toBe(false);
    expect(isProposalConfirmationText('没问题。对了，我只有晚上有空')).toBe(false);
  });

  it('否决/犹豫/疑问不确认', () => {
    expect(isProposalConfirmationText('先不确认')).toBe(false);
    expect(isProposalConfirmationText('再想想')).toBe(false);
    expect(isProposalConfirmationText('可以吗')).toBe(false);
    expect(isProposalConfirmationText('还没想好')).toBe(false);
    expect(isProposalConfirmationText('不生成')).toBe(false);
    expect(isProposalConfirmationText('行不行啊')).toBe(false);
    expect(isProposalConfirmationText('确认一下我理解得对不对')).toBe(false);
  });

  it('点确认按钮之外的长文本/普通追问不误伤', () => {
    expect(isProposalConfirmationText('我想再调整一下阶段安排')).toBe(false);
    expect(isProposalConfirmationText('重新生成方案')).toBe(false);
    expect(isProposalConfirmationText('这个阶段为什么要学语法？')).toBe(false);
    expect(isProposalConfirmationText('')).toBe(false);
    expect(isProposalConfirmationText(null)).toBe(false);
  });
});

describe('isExplicitRefusalText（显式拒绝探测，2026-10-08 真人面守门）', () => {
  it('C 轨探针样本：犹豫/拒绝命中（压过 confirmProposal flag）', () => {
    expect(isExplicitRefusalText('再想想吧')).toBe(true);
    expect(isExplicitRefusalText('先不用了')).toBe(true);
    expect(isExplicitRefusalText('我还没想好')).toBe(true);
    expect(isExplicitRefusalText('等等，有点犹豫')).toBe(true);
    expect(isExplicitRefusalText('换个方向吧')).toBe(true);
    expect(isExplicitRefusalText('取消')).toBe(true);
  });

  it('确认文本不误判为拒绝（守门不拦正常确认）', () => {
    expect(isExplicitRefusalText('就按这个来，确认')).toBe(false);
    expect(isExplicitRefusalText('确认生成学习路径')).toBe(false);
    expect(isExplicitRefusalText('好的')).toBe(false);
    expect(isExplicitRefusalText('没问题，生成吧')).toBe(false);
    expect(isExplicitRefusalText('')).toBe(false);
    expect(isExplicitRefusalText(null)).toBe(false);
  });

  it('改需求尾缀不算拒绝（走普通回合，模型接住调整诉求）', () => {
    expect(isExplicitRefusalText('时间改成每周 3 天')).toBe(false);
    expect(isExplicitRefusalText('想先看看大纲')).toBe(false);
  });
});
