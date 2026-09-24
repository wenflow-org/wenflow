#!/usr/bin/env bash
# ZCode 联网助手（走 Tavily 公益中转）
# 用法:
#   scripts/zweb.sh search "查询词" [max_results]
#   scripts/zweb.sh extract "https://url1" ["https://url2" ...]
# 说明: 中文查询必须用 --data-binary 传 UTF-8 体，否则中转返回 400。
set -euo pipefail
KEY="${TAVILY_RELAY_KEY:-th-dHld-j5zbHA7QGti5RbrWtC3Pdbw1}"
BASE="https://tavily.fuhuagoogle.top/api/tavily"
cmd="${1:-}"; shift || true

case "$cmd" in
  search)
    q="${1:-}"; n="${2:-5}"
    python - "$q" "$n" > /tmp/zweb_body.json <<'PY'
import json, sys
q, n = sys.argv[1], int(sys.argv[2])
print(json.dumps({"query": q, "max_results": n, "include_answer": False}, ensure_ascii=False))
PY
    curl -s -m 40 -X POST "$BASE/search" \
      -H "Content-Type: application/json; charset=utf-8" \
      -H "Authorization: Bearer $KEY" \
      --data-binary @/tmp/zweb_body.json
    ;;
  extract)
    python - "$@" > /tmp/zweb_body.json <<'PY'
import json, sys
print(json.dumps({"urls": sys.argv[1:]}, ensure_ascii=False))
PY
    curl -s -m 60 -X POST "$BASE/extract" \
      -H "Content-Type: application/json; charset=utf-8" \
      -H "Authorization: Bearer $KEY" \
      --data-binary @/tmp/zweb_body.json
    ;;
  *)
    echo "usage: $0 search \"query\" [n] | extract url [url...]" >&2; exit 2;;
esac
