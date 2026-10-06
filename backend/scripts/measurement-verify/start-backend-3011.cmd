@echo off
rem 3011 verify backend launcher (measurement-verify, 2026-10-05). ASCII-only on purpose:
rem cmd.exe parses .cmd files in GBK codepage on this machine; UTF-8 comments get misparsed.
rem - Shares backend/prisma/dev.db (WAL multi-process safe); NEVER touches 3001 (PID 14948, ts-node-dev)
rem - PORT=3011 process env overrides backend/.env PORT=3001 (dotenv does not override
rem   already-set process env; bootstrap/env.ts:16)
rem - CORS_ORIGIN = backend/.env whitelist + 5174 entries (this round's frontend dev port;
rem   5173 is occupied by the pre-existing vite). csrf.middleware.ts:30 validates Origin
rem   on cookie-bearing write requests, so the new frontend origin must be allowed.
rem - Log appends to out/backend-3011.log
cd /d D:\wenflow\wenflow\backend
set PORT=3011
set CORS_ORIGIN=http://localhost:5173,http://localhost:3000,http://172.26.208.1:5173,http://172.26.208.1:3000,http://192.168.31.26:5173,http://192.168.31.26:3000,http://192.168.31.24:5173,http://192.168.31.24:3000,http://192.168.66.24:5173,http://192.168.66.24:3000,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174
call npx ts-node --transpile-only src/index.ts >> "D:\wenflow\wenflow\backend\scripts\measurement-verify\out\backend-3011.log" 2>&1
