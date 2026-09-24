/** 只读：核对前端走查用户的目标会话落库（A2 动机字段 / A4 分诊） */
import 'dotenv/config';
import prisma from '../src/config/database';

async function main() {
  const user = await prisma.users.findFirst({ where: { name: { startsWith: 'uicheck' } }, select: { id: true, name: true }, orderBy: { createdAt: 'desc' } });
  if (!user) throw new Error('找不到 uicheck 用户');
  const conv = await prisma.goal_conversations.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { id: true, stage: true, status: true, collectedData: true } });
  const data = conv?.collectedData ? JSON.parse(conv.collectedData) : {};
  console.log('user =', user.name, '| conversation =', conv?.id, '| stage =', conv?.stage, '| status =', conv?.status);
  console.log('responseTriage =', JSON.stringify(data.responseTriage ?? null));
  console.log('motivationSignal =', JSON.stringify(data.motivationSignal ?? data.motivation_signal ?? null));
  console.log('miFrames 帧 =', data.miFrames ? Object.keys(data.miFrames).join(', ') : (data.mi_frames ? Object.keys(data.mi_frames).join(', ') : '(无)'));
  console.log('understanding.prerequisiteCheckResults =', JSON.stringify(data.understanding?.prerequisiteCheckResults ?? null));
  console.log('confirmedProposal.prerequisiteDiagnostics =', JSON.stringify(data.confirmedProposal?.prerequisiteDiagnostics ?? null));
  console.log('messages 条数 =', Array.isArray(data.messages) ? data.messages.length : '(无)');
  const lastAi = Array.isArray(data.messages) ? [...data.messages].reverse().find((m: any) => m.role === 'ai' || m.role === 'assistant') : null;
  console.log('最后一条 AI 消息含「系统判断」 =', lastAi ? String(lastAi.content).includes('系统判断') : '(无消息)');
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
