/**
 * CORS 与 CSRF 共用的来源白名单（2026-10-22 单源化，机械过滤审计 C 类）。
 *
 * 此前两处各自维护默认清单且不同步：http-app.ts 的 CORS 默认多 `http://127.0.0.1:5173`、
 * csrf.middleware 没有——同一请求会「CORS 预检通过、CSRF 写请求被拒」，排查时极易误判。
 * 两处现在都从本模块取默认值与解析逻辑；生产必须显式配 CORS_ORIGIN（http-app 有启动告警）。
 */
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

/** 解析 CORS_ORIGIN 逗号清单：去空白/去尾斜杠；未配置回退默认清单。 */
export const parseAllowedOrigins = (raw?: string): string[] =>
  (raw?.split(',') || DEFAULT_ALLOWED_ORIGINS)
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
