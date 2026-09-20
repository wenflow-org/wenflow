import { REAL_USER_WHERE as REAL_USER_WHERE_UTILS } from '../../utils/test-account';

/**
 * 生产统计用户过滤：排除虚拟学习者与测试/审计账号（合成流量），避免污染真实指标。
 * 单点定义见 utils/test-account.ts（前缀清单随 dev.db 实测账号分布扩展），此处仅补 deletedAt。
 */
export const REAL_USER_WHERE = {
  ...REAL_USER_WHERE_UTILS,
  deletedAt: null,
};
