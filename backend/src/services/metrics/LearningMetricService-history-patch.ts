/**
 * 获取学习历史数据（用于图表）
 * 修改为返回所有历史记录的聚合数据
 */
import { prisma } from '../../config/database';

export async function getLearningHistory(userId: string) {
  try {
    // 获取所有历史记录，按日期排序
    const allMetrics = await prisma.learning_metrics.findMany({
      where: { userId },
      orderBy: { calculatedAt: 'asc' }, // 按时间正序排列
      take: 100 // 最多取100条
    });

    if (allMetrics.length === 0) {
      return { lssHistory: [], sessionHistory: [] };
    }

    // 从每条记录构建 lssHistory（使用 lss 字段替代 lssCurrent）
    const lssHistory = allMetrics.map((metric: any) => ({
      date: metric.calculatedAt.toISOString(),
      score: Math.round((metric.lss || 0) * 10) // 转换为0-100范围
    }));

    // sessionHistory 简化为空数组（数据库中没有这个字段）
    const sessionHistory: any[] = [];

    return {
      lssHistory,
      sessionHistory
    };
  } catch (error) {
    console.error('Error getting learning history:', error);
    return { lssHistory: [], sessionHistory: [] };
  }
}
