#!/usr/bin/env bash
# 留出集 R2 配对 A/B：同一人设在同一账号上生成第二条路径（post-R2），
# 与 pre-R2 首条路径逐人设对比。用法：bash holdout-ab-rerun.sh（需先确认 driver2 波已结束）
set -u
cd "$(dirname "$0")"
PERSONAS=(rw-school-04 rw-school-08 rw-school-16 rw-career-02 rw-career-06 rw-exam-12 rw-exam-15 rw-life-09 rw-acad-02)
LOG=results/holdout-ab-rerun.log
: > "$LOG"
echo "[$(date +%H:%M:%S)] holdout A/B rerun start: ${#PERSONAS[@]} personas" >> "$LOG"
# 两条并行链，避免 RPM 18 打满
for i in "${!PERSONAS[@]}"; do
  id="${PERSONAS[$i]}"
  if (( i % 2 == 0 )); then
    ( node multi-path-smoke.mjs --user="pe-$id" --script="$id" >> "$LOG" 2>&1 ) &
  else
    ( node multi-path-smoke.mjs --user="pe-$id" --script="$id" >> "$LOG" 2>&1 ) &
  fi
  # 每条之间错开 60s，降低瞬时并发
  sleep 60
done
wait
echo "[$(date +%H:%M:%S)] holdout A/B rerun done" >> "$LOG"
