-- 语义清理：user_mcp_configs.servers → providers
--
-- 原因：servers 存的是「外挂服务/LLM 供应商」连接配置，与 MCP server 语义混淆
-- （平台侧 config/mcp.json 已同步把 servers 改名为 providers）。
--
-- 注意：加密上下文（AES-GCM 的 AAD）仍冻结为 'main.user_mcp_configs.servers'，
-- 不随列名改变——否则已加密的 apiKey 将无法解密。
ALTER TABLE "user_mcp_configs" RENAME COLUMN "servers" TO "providers";
