#!/usr/bin/env bash
# 逐学段续跑 learn（失败自动 restart-learning 重试），直到四门课全部完成。
cd /d/wenflow/wenflow
BANDS="P1 J1 S1 C1"
declare -A BANDKEY=([P1]=primary [J1]=junior [S1]=senior [C1]=college)
for run in $BANDS; do
  b=${BANDKEY[$run]}
  echo "===== $b ($run) learn START $(date '+%H:%M:%S') ====="
  for attempt in 1 2 3; do
    node scripts/school-demo/run-band.mjs --band=$b --phase=learn 2>&1 | tail -6
    # 检查是否跑完
    done=$(node -e "
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('backend/prisma/dev.db');
const st=JSON.parse(require('fs').readFileSync('data/newfeatures-test-2026-09-22/${run}-state.json','utf8'));
const pid=db.prepare(\"select learningPathId from virtual_sessions where id='\${st.sessionId}'\").get()?.learningPathId;
if(!pid){console.log('0 0');process.exit(0);}
const total=db.prepare(\"select count(*) c from subtasks s join milestones m on s.milestoneId=m.id where m.learningPathId='\"+pid+\"'\").get().c;
const d=db.prepare(\"select count(*) c from subtasks s join milestones m on s.milestoneId=m.id where m.learningPathId='\"+pid+\"' and s.status='completed'\").get().c;
console.log(d+' '+total);
" 2>/dev/null)
    echo "  [$b] attempt $attempt: $done"
    set -- $done
    if [ "$1" = "$2" ] && [ "$2" != "0" ]; then echo "  [$b] ✅ 完成"; break; fi
    # 未完成：restart-learning 续跑
    node -e "
const fs=require('fs');const env=fs.readFileSync('backend/.env','utf8');
const g=(k)=>{const m=env.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():''};
const B='http://127.0.0.1:3010';const sid=JSON.parse(fs.readFileSync('data/newfeatures-test-2026-09-22/${run}-state.json','utf8')).sessionId;
(async()=>{
  const lr=await fetch(B+'/api/admin-auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173'},body:JSON.stringify({name:g('INIT_ADMIN_NAME'),password:g('INIT_ADMIN_PASSWORD'),remember:true})});
  const ck=(lr.headers.get('set-cookie')||'').match(/wenflow_admin_token=[^;]+/)[0];
  const H={'Content-Type':'application/json',Cookie:ck,Origin:'http://localhost:5173'};
  const r=await fetch(B+'/api/admin/virtual-learners/sessions/'+sid+'/restart-learning',{method:'POST',headers:H,body:'{}'});
  console.log('  restart-learning:',r.status);
})();
" 2>&1 | tail -1
  done
  echo "===== $b ($run) learn END $(date '+%H:%M:%S') ====="
done
