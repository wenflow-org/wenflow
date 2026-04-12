#!/bin/bash

# SSL 证书生成脚本（自签名，用于测试）
# 生产环境请使用 Let's Encrypt 或购买正规证书

set -e

echo "🔐 生成 SSL 证书..."

# 检查参数
DOMAIN=${1:-localhost}
EMAIL=${2:-admin@localhost}

# 创建 SSL 目录
mkdir -p nginx/ssl
cd nginx/ssl

echo "生成私钥..."
openssl genrsa -out privkey.pem 2048

echo "生成证书签名请求..."
openssl req -new -key privkey.pem -out csr.pem \
  -subj "/C=CN/ST=State/L=City/O=Organization/OU=Unit/CN=${DOMAIN}"

echo "生成自签名证书..."
openssl x509 -req -days 365 -in csr.pem -signkey privkey.pem -out fullchain.pem \
  -extfile <(echo "subjectAltName=DNS:${DOMAIN},DNS:www.${DOMAIN},IP:127.0.0.1")

echo "设置权限..."
chmod 600 privkey.pem
chmod 644 fullchain.pem

# 清理临时文件
rm -f csr.pem

echo ""
echo "✅ SSL 证书生成完成！"
echo ""
echo "证书文件:"
echo "  私钥：nginx/ssl/privkey.pem"
echo "  证书：nginx/ssl/fullchain.pem"
echo ""
echo "⚠️  注意：这是自签名证书，仅用于测试环境"
echo "生产环境请使用 Let's Encrypt 或购买正规证书"
echo ""
