# Design Documentation Index

> Directory convention: root = current effective docs; `archive/` = superseded versions; `history/` = point-in-time artifacts by month (notes/reports); `design/` = topic-specific design drafts.
> Chinese versions prevail; this index mirrors [README.md](./README.md).

## Protocols & Prompt System

- `SKILL_PROTOCOL_V4.md`
  - Unified Skill Protocol v4 (rules): core.yaml / six input channels / five-block compiled prompt / three gate checks / SkillResult
  - Supreme guideline for future AI development & refactoring (v4.1-draft: §2.6 orchestration files; orchestration files are the single source for field routing)
- `PROMPT_AUTHORING_PROTOCOL.md` → archived (2026-08-09, see `archive/PROMPT_AUTHORING_PROTOCOL_v2.md`; LLM parts superseded by v4, code-only constraints merged into v4.1)
- `PROMPT_PROTOCOL_V4_PREWORK_SURVEY.md`
  - v4 pre-transformation survey: prompt inventory, runtime chain, channel fit, infra landing points (M0 input completed 2026-07-27, reference only)
- `PROMPT_MANAGEMENT_GUIDE.md` → archived (2026-08-09, v2 compile model, mutually exclusive with v4 version model)
- `PROMPT_COMPILE_GLOSSARY.md` → archived (2026-08-09, legacy prompt-compiler terms)
- `PROMPT_RECOVERY_MATRIX.md` — prompt recovery sources matrix

## Architecture & Governance

- `ARCHITECTURE_BASELINE_2026-07.md` — current architecture baseline (frontend/backend, AI skills, data, events, deployment)
- `ARCHITECTURE_ALIGNMENT_AND_REMEDIATION_PLAN.md` — drift/misalignment fixes, P0/P1/P2 order
- `NON_FUNCTIONAL_GOVERNANCE_PLAN.md` — security, reliability, testing, deployment, observability, performance, data governance

## Agents & Scenarios

- `AGENT_IO_DESIGN_V3.md` — V3 field routing model, `agent-output-v1` shell, `internal.ext.*` namespace
- `STAGE_MIGRATION_GUIDE.md` → archived (2026-08-09; field routing single-sourced, orchestration files are the only source)
- `LEARNER_MODEL_ARCHITECTURE.md` (Chinese) / `LEARNER_MODEL_ARCHITECTURE.en.md` — learner model design

## Path

- `PATH_PRODUCTION_REPLAN_CONTRACT.md` / `.en.md` — path production pipeline & replan contract
- `PATH_ANDERSON_ITERATION_NOTE.md` / `.en.md` — enrichment / Anderson annotation iteration notes

## Virtual Learners

- `VIRTUAL_LEARNER_CHAIN.md` — virtual learner chain (source of truth)
- `VIRTUAL_LEARNER_QUICK_LEARN_DESIGN_2026-07-21_091152.md` — quick-learn mode design (referenced from backend code)

## Archive & History

- `archive/` — superseded protocols & designs (UNIFIED_SKILL_PROTOCOL v1/v2, PROMPT_PROTOCOL_V4_DESIGN, PROMPT_AUTHORING_PROTOCOL v1.2/v2, PROMPT_MANAGEMENT_GUIDE, PROMPT_COMPILE_GLOSSARY, STAGE_MIGRATION_GUIDE (all archived 2026-08-09), etc.)
- `history/notes/YYYY-MM/` — point-in-time notes
- `history/reports/YYYY-MM/` — point-in-time reports
- `design/` — topic-specific design drafts
