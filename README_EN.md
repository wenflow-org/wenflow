# WenFlow

![WenFlow Banner](docs/logo/品牌横幅.png)

> ⚠️ **Current Main Development**: [develop](https://github.com/wenflow-org/wenflow/tree/develop) branch | main is stable

**An AI learning-path prototype that starts from real problems**

> WenFlow: don't start by finding courses; start by clarifying the real problem.

English Version | [中文版](README.md)

🌐 **Demo Site**: https://wenflow.org

> Demo only, not for production use.
> ⚠️ **Notice**: All accounts and data on the demo site are periodically purged. Do not store important information.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.17.0-green.svg)](https://nodejs.org)
[![Vue](https://img.shields.io/badge/vue-3.x-brightgreen.svg)](https://vuejs.org)

---

## Why WenFlow?

Learning often gets stuck not because you are not trying hard enough, but because the goal is too broad, the resources are overwhelming, and the first step is unclear.

Many learning products start by giving you content: courses, materials, exercises, and predefined paths.  
WenFlow starts somewhere else: helping you clarify what you are really trying to solve.

It turns a vague goal into an actionable learning path: clarify the problem, generate a route, then keep adjusting through dialogue, output, and feedback.

As AI gets better at producing answers, the more valuable capabilities are no longer just remembering content, but:

- defining problems
- seeing structure
- making judgments
- collaborating with AI
- continuously adjusting through feedback

**Answers will keep getting cheaper. Problems will matter more.**

---

## Core Features

### Product Flow Preview

These five screenshots show WenFlow's core experience, from a real problem to a complete learning loop.

| Start from a Real Problem |
|:---:|
| ![Start from a Real Problem](docs/images/home-start-from-problem.png) |

| Clarify the Real Goal | Generate a Learning Path |
|:---:|:---:|
| ![Clarify the Real Goal](docs/images/goal-clarification.png) | ![Generate a Learning Path](docs/images/learning-path.png) |

| Enter Round-based Learning | Learning Loop Overview |
|:---:|:---:|
| ![Enter Round-based Learning](docs/images/round-based-learning.png) | ![Learning Loop Overview](docs/images/learning-loop-overview.png) |

### From Problem to Path
- **Problem Clarification**: use 5-8 rounds of natural dialogue to surface context, prior knowledge, time, and constraints
- **Path Generation**: turn a vague goal into phases, tasks, and a first step you can start today
- **Round-based Learning**: AI asks, the user responds, feedback is immediate, and the path keeps adjusting with understanding

### Learning State Tracking
Inspired by load-and-recovery ideas from sports science, WenFlow tracks learning state rather than only whether a task was completed:

| Metric | Meaning | Usage |
|------|------|------|
| LSS | Learning Stress Score | Based on task difficulty, duration, cognitive load, EWMA-smoothed |
| KTL | Knowledge Training Load | Long-term accumulation, 42-day decay factor 0.95 |
| LF | Learning Fatigue | Short-term accumulation, 7-day decay factor 0.70 |
| LSB | Learning State Balance | KTL - LF, warns against over-learning |

### Platform Agent Architecture (Simplified)

```mermaid
flowchart TD
    U[User] --> G1[Goal Conversation Skill\nClarify Learning Goals]
    G1 --> P1[Path Planning Skill\nGenerate Phases and Tasks]
    P1 --> T0[AI Teaching Orchestrator\n6-phase State Machine]

    T0 --> T1[Learning Turn Skill\nExplain, Ask, Diagnose Each Round]
    T1 --> K1[Knowledge State Update\nTopic Progress]
    T1 --> S1[Learning State Update\nLSS, KTL, LF, LSB]
    T1 --> C1[Checkpoint Quiz\nSubmit and Judge]

    T1 --> D{Need Reinforcement?}
    D -- Yes --> PEER[Peer Learning Skill\nDiscussion-based Reinforcement]
    D -- No --> NEXT[Continue Teaching]

    NEXT --> END{Lesson Complete?}
    C1 --> NEXT
    PEER --> END

    END -- Complete --> W1[Post-session Skill\nSummary, Evaluation + Knowledge Enrichment]
    W1 --> R1[Replan Suggestion\nAdjust Path?]
    R1 --> P1
```

- Top-level agents are orchestration-oriented; the Skills hold prompts and call the LLM directly.
- First clarify goals, then break them into executable learning paths
- Teaching progresses in rounds, continuously assessing understanding (opening → teaching → intervention → checkpoint → wrapup)
- Trigger peer reinforcement when student struggles, never abandon current task
- Automatically generate summary and evaluation after each session, with replan suggestions (auto-adjustment is off by default; suggestions only)

### Virtual Learner Lab

Virtual learner accounts exercise the **real production chain** to validate the platform:

- **Black-box simulation**: drives goal → path → learn through the normal user API, with referee and actor-auditor checks
- **Quick Learn**: picks a virtual account's task, auto-completes a lesson, and produces a Propagation Report with persisted state

### Admin Console

`/admin` provides 16+ pages: platform overview, users/learner center, teaching sessions, goal conversations, virtual learners, Skill catalog and Prompt design workbench, Agent topology, orchestrator structure, execution logs, trace waterfall, model & API config, core-file sync workbench, etc.

### Prompt Engineering (Prompt Lab v4, File-as-Truth)

- **Source of truth**: `prompts/core/*.yaml` (the only manual edit entry, committed to git)
- **Compiled artifacts**: `prompts/skill.*.md` (generated deterministically, the only text models read)
- **Publish chain**: edit core.yaml → compile (gate checks) → publish (write md + DB ACTIVE) → rollback
- **Database**: `agent_prompts` is only a runtime mirror; files are the truth, DB is the mirror

---

## Tech Stack

| Layer | Technology |
|------|------|
| **Frontend** | Vue 3 + TypeScript + Vite 6 + Element Plus + Pinia |
| **Backend** | Node.js + Express + TypeScript + Prisma |
| **Database** | SQLite (main DB with 36 tables + system DB with 16 tables, dual-database architecture) |
| **AI Integration** | OpenAI-compatible model gateway (default: DeepSeek deepseek-v4-flash / v4-pro / r1), SSE streaming, retry budget, thinking-mode control |
| **Agent Coordination** | EduClaw Gateway + 7 official Agents / Skill orchestration + Coordinators + Event Bus (outbox durable events) |
| **Model Config Layers** | Env vars → platform defaults → Agent/Skill level → user-defined API / model overrides |
| **Virtual Experiment** | Virtual Learner Lab (black-box simulation + Quick Learn) |
| **Observability** | Agent/Skill call logs, trace waterfall, LLM execution details |
| **Security** | JWT + CSRF + login rate limiting + Secret AES-256-GCM encryption + sensitive-storage permission audits |
| **Deployment** | PowerShell scripts + optional Nginx (test deployment) + Docker (Linux/macOS) |

---

## Project Status

WenFlow is still in an **early development stage**, serving as an experimental prototype for validating a different learning approach.

Instead of simply accelerating old learning workflows, it explores another path: what if learning starts from a real problem, and AI helps clarify goals, shape the path, and organize feedback along the way?

The project is meant to keep exploring how to cultivate five capabilities that matter in the AI era: **problem definition, systems thinking, judgment, AI collaboration, and creativity**.

---

## Quick Start

### Requirements
- Node.js >= 20.17.0

### Recommended Order (First Run)

See [`SECURITY.md`](./SECURITY.md) for credential and backup handling. Run `npm run security:scan` before publishing changes.

Runtime status: `/health` and `/livez` report process liveness; `/readyz` verifies both databases and the core runtime state.

```bash
# 1) Initialize backend/.env (JWT_SECRET, AI config, initial admin)
npm run env:setup

# 2) Choose a startup mode as needed
./start-dev.ps1
```

Note: For first-time use, it is recommended to finish environment setup before choosing a startup script. If `backend/.env` is missing or `JWT_SECRET` is invalid, the startup scripts will also launch the setup flow automatically.
When the backend starts, it automatically syncs core prompts (File-as-Truth: `prompts/core/*.yaml` are the source of truth; the compiled `prompts/skill.*.md` artifacts sync to database ACTIVE versions). This keeps a fresh GitHub checkout aligned with the repository's prompt source of truth.

### Local Development

```bash
# PowerShell
./start-dev.ps1
```

Note: The script checks dependencies, generates both Prisma clients, runs `prisma migrate deploy` independently for the main and System databases, guides environment setup if needed, and runs one core prompt sync before startup.
To skip Prisma initialization: `./start-dev.ps1 -SkipPrisma`  
Important: this flag also skips the startup prompt sync, so it should only be used when both the database schema and prompt records are already ready.

### LAN Development Mode

```bash
# Auto-detect LAN IP and start
./start-lan.ps1

# Or use npm script
npm run dev:lan

# Manually specify IP
./start-lan.ps1 -LanIP 192.168.31.26
```

Note: This mode automatically adds the LAN IP to `CORS_ORIGIN`, which is useful for multi-device frontend testing. It does not change the `ADMIN_ACCESS_MODE` restriction on admin login.

### Test Deployment with Nginx (HTTP)

```bash
# Requires nginx installed and in PATH
./start-dev.ps1 -UseNginx

# Or via npm script
npm run dev:nginx

# Specify domain (defaults to localhost)
./start-dev.ps1 -UseNginx -Domain test.example.com

# If nginx not in PATH, specify executable path
./start-dev.ps1 -UseNginx -NginxExePath "C:\nginx\nginx.exe"
```

Note: `-UseNginx` mode runs `npm run build` (frontend) and generates runtime config to `runtime/nginx/wenflow.nginx.conf`; it validates port 80 availability first, and the system nginx (or any other process holding port 80) must be stopped manually.

### Docker Deployment (Linux/macOS)

```bash
# One-shot start (interactively fills backend/.env; env vars can also be passed non-interactively)
./docker-start.sh

# Database backup (one-off operations service, read-only volume mount)
docker compose -f docker-compose.operations.yml run --rm backup
```

Note: `docker-compose.yml` provides three services (migrate / backend / nginx) and publishes only Nginx (80) by default, never the backend port `3001`; the backend enforces `ADMIN_ACCESS_MODE=private`. See [DEPLOYMENT.md](DEPLOYMENT.md) for details.

### Quality Check (same as CI)

```bash
# Runs: secret scan → Prisma schema validation → clean-replay migrations → backend typecheck → backend tests → backend + frontend builds
npm run check
```

Note: GitHub Actions (`.github/workflows/quality-check.yml`) runs the same checks on push to main/master and on PRs (plus a git-history secret scan).

### First-time Environment Setup (Recommended)

```bash
# Interactive initialization of backend/.env
npm run env:setup

# Or quickly open backend/.env for manual editing
npm run env:edit
```

Note: `env:setup` no longer asks for a domain separately. In Nginx mode, the domain is inferred from `-Domain` first, then from `FRONTEND_URL` in `backend/.env`.

### Prompt Bootstrap and Maintenance (File-as-Truth)

Core prompts use a two-level model: **the source of truth** is `prompts/core/*.yaml` (the only manual edit entry, committed to git), **compiled artifacts** are `prompts/skill.*.md` (the only text models read), and the `agent_prompts` table is just a runtime mirror. The edit → compile → publish chain (with gate checks and rollback) lives in the admin "Prompt Design" workbench; see [`doc/SKILL_PROTOCOL_V4.md`](doc/SKILL_PROTOCOL_V4.md) for the mechanism.

```bash
# Deterministically compile all prompts/core/*.yaml, regenerating prompts/skill.*.md (no DB writes)
cd backend
npm run prompts:compile-all

# Sync compiled artifacts into database ACTIVE versions (also runs automatically at startup)
npm run prompts:sync-core

# Backfill newly introduced prompt nodes without overriding existing ACTIVE prompts
npm run prompts:backfill-core

# Lint and parity checks
npm run prompts:lint
npm run prompts:core:check
```

Note: `prompts:sync-core` treats the compiled repository artifacts as the source of truth for core prompts and syncs database ACTIVE versions to match. If repo and DB differ, it creates a new version, activates it, and archives the old one. `prompts:backfill-core` only fills missing nodes and does not overwrite existing ACTIVE prompts. If you run `npm run dev` directly inside `backend/`, the server also performs the same core prompt sync during startup. See [`prompts/_README.md`](prompts/_README.md) for more.

### Local SQLite Path Rule

- For local SQLite development, use: `DATABASE_URL=file:./dev.db`
- For the System database, use: `SYSTEM_DATABASE_URL=file:../system.db`
- Do not use the old `file:./prisma/*.db` values. Relative SQLite URLs are resolved from each schema directory.
- Before upgrading an existing environment, identify and back up the authoritative database files, then run `npm run prisma:baseline:audit` in read-only mode.

### Frontend API Environment Variables

- By default, the frontend calls the backend through the relative `/api` path, forwarded by Vite proxy or Nginx.
- The admin panel primarily reads `VITE_API_BASE_URL` from `frontend/.env`.
- The main user-facing app also supports `VITE_API_URL` outside development mode; if you do not have a custom deployment need, keeping `/api` is the safest default.

For more fine-grained deployment steps or non-script startup, see [DEPLOYMENT.md](DEPLOYMENT.md).

Architecture design, Skill protocol, prompt management, and virtual-learner-chain docs are indexed in [`doc/README.md`](doc/README.md).

### Access URLs

**Demo Site**: https://wenflow.org

**Local Development**
- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- Admin Panel: http://localhost:5173/admin

Note: Admin login defaults to `ADMIN_ACCESS_MODE=private` (localhost + LAN only), and can be set to `loopback` (localhost only) or `any` (no source restriction), with `ADMIN_ALLOWED_IPS` for precise IP allowlisting (exposing admin login directly to the public internet is not recommended).

---

## Admin Account

On first startup, the system reads these fields from `backend/.env` to auto-create initial admin:

```env
INIT_ADMIN_NAME=admin
INIT_ADMIN_PASSWORD=YourStrongPassword123
```

If admin already exists in database, creation is skipped.

Recommendation: Change password immediately after first login. Use strong passwords for externally accessible deployments.

Important: Admin login defaults to `ADMIN_ACCESS_MODE=private`, allowing only localhost and LAN (RFC1918) sources. Set `loopback` for localhost-only or `any` to remove the source restriction, and use `ADMIN_ALLOWED_IPS` to allowlist specific client IPs. The policy can be applied at runtime from the admin "Models & Access" page; the env var is only the default. For public remote administration, use a VPN or precise IP allowlist, and take responsibility for the added security risk. See [ADMIN_LOGIN_GUIDE.md](ADMIN_LOGIN_GUIDE.md) for details.

See [ADMIN_SETUP.md](ADMIN_SETUP.md) for details.

### Reverse Proxy Common Issues

- Don't add trailing `/` to `CORS_ORIGIN` (use `https://demo.example.com`, not `https://demo.example.com/`)
- Set `TRUST_PROXY` to the IP/CIDR of the proxy that directly connects to the backend; production rejects `true`
- Do not publish a backend port that bypasses the trusted proxy. Docker Compose exposes only Nginx to the host
- If "origin not allowed" error occurs, check browser `Origin` matches `CORS_ORIGIN`

---

## Educational Theory Foundation

Based on 6 major educational theories:

1. **Cognitive Load Theory** - Avoid information overload
2. **Self-directed Learning** - User autonomy
3. **Dreyfus Five-stage Model** - Dynamic stage assessment
4. **Zone of Proximal Development + Scaffolding** - Slightly above current level
5. **Formative Assessment** - Immediate feedback
6. **Deliberate Practice** - Targeted weakness improvement

---

## License

This project uses [MIT License](LICENSE).

Copyright (c) 2026 wenflow-org

---

## Acknowledgments

Thanks to all [Linux.do](https://linux.do/) members for their sharing.

---

*When AI can answer all standard questions, those who ask good questions will define the future.*
