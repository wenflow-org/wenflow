@echo off
rem Frontend dev pointing at 3011 verify instance (measurement-verify, 2026-10-05)
rem - vite.config.ts:34 proxy target reads env var VITE_DEV_API_TARGET (default http://localhost:3001),
rem   so NO config file change is needed; frontend base URL defaults to /api
rem   (frontend/src/utils/http.ts:14 falls back to /api when no .env), all requests go through vite proxy to 3011
rem - Port 5173 is taken by the pre-existing vite (PID 3024, pointing at 3001, untouched); this run uses 5174 strictPort
rem - CORS: start-backend-3011.cmd already appended http://localhost:5174 / http://127.0.0.1:5174
rem   into CORS_ORIGIN (csrf.middleware.ts:30 checks Origin on cookie-bearing writes)
rem NOTE: keep this file ASCII-only; cmd.exe parses .cmd in GBK codepage on this machine and
rem UTF-8 Chinese comments get misparsed as commands.
rem NOTE: call the local vite binary directly; `npx vite` on this machine ignores local 6.4.3
rem and tries to install vite@8 from the registry (hangs on prompt).
cd /d D:\wenflow\wenflow\frontend
set VITE_DEV_API_TARGET=http://127.0.0.1:3011
call node node_modules\vite\bin\vite.js --port 5174 --strictPort >> "D:\wenflow\wenflow\backend\scripts\measurement-verify\out\frontend-dev.log" 2>&1
