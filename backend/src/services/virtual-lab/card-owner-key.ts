/**
 * 卡归属键（2026-10-29 用户拍板：卡库不是账号，只是档案）。
 *
 * 模板卡没有账号，随卡资料按档案 id 落到独立目录 `card-<profileId>`；派生实例 / 预置实例
 * 仍按账号 userId 存。material-store 的 userDirectory 会清洗非法字符，card-<uuid> 安全，
 * 且与真实 userId 不会混淆。抽成独立小模块供卡导入、导出、级联删除、数据迁移共用，
 * 避免为了一个字符串函数把整条卡服务依赖拖进清理链路。
 */
export function cardOwnerKey(profileId: string): string {
  return `card-${profileId}`;
}
