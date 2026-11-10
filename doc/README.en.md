# Design Documentation Index

> Convention: files listed here (directly under `doc/`) are the **current, in-repo documents** (tracked by git, visible on GitHub).
> Process materials — `archive/`, `history/`, `design/`, survey snapshots and historical change logs — are kept **locally only** and are not tracked by git (since 2026-09-05); they are not linked here. For anything current, rely on the root docs and the code.
> **Registry gate (since 2026-09-28)**: a new doc must be ① added to the root `.gitignore` allowlist ② registered in the table below ③ carry a status header; whenever an implementation contradicts a doc's "not-doing / TODO" claim, that doc must be updated in the same commit.

## Master Index (39 docs directly under doc/ · full coverage · 2026-11-02)

> Every doc carries a status line (`📌 type | last verified`). Chinese version: [`README.md`](./README.md).

| Doc | Type | Note |
|---|---|---|
| SKILL_PROTOCOL_V4.md | Living spec | Skill protocol SSOT (two-level compilation retired) |
| MODEL_GATEWAY_DESIGN.md | Living spec | Gateway SSOT |
| PROMPT_CACHE_OPTIMIZATION.md | Living spec | Cache optimization (64k SSOT written back) |
| PROMPT_ADJUSTMENT_GUIDE.md | Living spec | Prompt adjustment how-to |
| SKILL_DEVELOPMENT_GUIDE.md | Living spec | New / refactor Skill guide (§2 CLI-first) |
| AGENT_SKILL_MANUAL.md | Living spec | Agent / Skill the-why overview |
| PIPELINE_MAP.md | Generated | Scenario → Agent → Prompt pipeline index (`pipeline:map` generated; do not edit) |
| PIPELINE_PROMPTS.md | Generated | Full prompt corpus by scenario (same generator; do not edit) |
| KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md | Living spec | KC concept identity + graph (~95%) |
| KC_MULTIPATH_AND_LEARNER_SIGNAL_SCOPE.md | Living spec | KC multi-path + learner-signal scope (§2 still holds) |
| LEARNER_CENTER_AND_STATE_FUSION.md | Living spec | Learner center / state fusion (§3.3 wired) |
| LEARNER_MODEL_ARCHITECTURE.md (.en) | Living spec | Learner model (Phase 5 consumed; §6/§10/§11 pending) |
| LEARNER_STATE_REVIEW_DESIGN.md | Design record | ⚠️ in-doc table names differ from the current schema; anchored to `learner_projections` |
| PATH_PRODUCTION_REPLAN_CONTRACT.md (.en) | Living spec | ⚠️ known TODO: 2 issues in the 409 decisions |
| SESSION_JSON_INCREMENTAL_DESIGN.md | Design record (landed) | Incrementalization of session large-JSON columns + acceptance checklist |
| VIRTUAL_LEARNER_DESIGN.md | Living spec | VL main doc (referee separated) |
| VIRTUAL_LEARNER_CHAIN.md | Living spec | VL chain source of truth (16/17) |
| VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md | Living spec | Page side landed; system layer ③④ per body |
| VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md | Design record | ⚠️ header outdated; full revision pending |
| AGENT_IO_DESIGN_V3.md | Design record (partially archived) | §1–§4 superseded by V4 §2.6 |
| UPGRADE_DIRECTION_20Q.md | Governance ledger | Q12/Q18 misplacement fixed; stale vector/materials claims recycled |
| NON_FUNCTIONAL_GOVERNANCE_PLAN.md | Governance plan | ⚠️ status baseline 2026-07-17 |
| EDUCATIONAL_THEORY_MAP.md | Reference | Theory map (literature verified) |
| DIAGRAM_PEDAGOGY_RESEARCH.md | Reference | Teaching-diagram evidence grading (A–D) and per-diagram-type empirical ratings |
| LLM_PACK_GUIDE.md | Reference | How to hand teaching-diagram review packs to an LLM (token bloat causes and slimming) |
| ADMIN_TERMINOLOGY_AUDIT.md | Living spec | Terminology SSOT (must not be archived) |
| USER-JOURNEY-MAP-2026-11-01.md + ADMIN-JOURNEY-MAP-2026-11-01.md | Living spec (maps) | Learner/admin journey maps: entry points, actions, system behavior (revised by the 2026-11-02 audit; cross-linked) |
| ADMIN_OPERATIONS_MANUAL.md | Living spec | Admin operations manual (routes → duties, metric definitions, action names, SOP) |
| ADMIN_VISUAL_LAYER_SPEC.md | Living spec | ⛔ must not be archived (guard hard-references it) · v4 wired to the design system |
| NEWUI-PROTOTYPES.md | Living spec | newui prototype registry & "protovalue residue" rule |
| ADMIN_COLUMN_WIDTH_SPEC.md | Living spec | Column-width ratio contract, width tokens (three tiers in sync), utility alignment |
| CLASSROOM_PIPELINE.md | Living spec | Classroom + evaluation pipeline single-file account (files/functions directly comparable) |
| CLASSROOM_SKILLS.md | Living spec | Full prompt collection used by the classroom (companion to CLASSROOM_PIPELINE.md) |
| DEV_SCRIPTS.md | Living spec | Single script index (86 paths, none dead) |
| README.md / README.en.md | Index | This document |

## Protocols & Prompt System

- [`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)
  - Unified Skill Protocol v4 (rules): core.yaml / six input channels / five-block compiled prompt / three gate checks / SkillResult
  - Supreme guideline for future AI development & refactoring (v4.1: §2.6 orchestration files; orchestration files are the single source for field routing)
- [`SKILL_DEVELOPMENT_GUIDE.md`](./SKILL_DEVELOPMENT_GUIDE.md)
  - Skill development guide (for developers): selection → scaffold → wiring → fields → gates → publish → tests (2026-08-12)
- [`AGENT_SKILL_MANUAL.md`](./AGENT_SKILL_MANUAL.md)
  - Agent / Skill overview and rationale (for developers): the **why** of each top-level Agent and Skill (purpose / design intent / boundaries / five-stage data journey)
  - Complements the auto-generated `prompts/AGENTS_SELF_INTRO.md` (mechanical appendix, what only) as the "why" before the how-to; **a development doc, not a platform feature/capability description**

## Architecture & Governance

- [`NON_FUNCTIONAL_GOVERNANCE_PLAN.md`](./NON_FUNCTIONAL_GOVERNANCE_PLAN.md)
  - Unified checklist for security, reliability, testing, deployment, observability, performance and data governance
  - Release blockers, implementation waves and release-acceptance criteria
- [`UPGRADE_DIRECTION_20Q.md`](./UPGRADE_DIRECTION_20Q.md)
  - **Merged master ledger (single conclusion doc)**: item-by-item verification of the 20 questions (Q1–Q20) under the teaching-experiment / Demo positioning + grading (core / light-retain / not-doing) + upgrade directions
  - Conclusions on Track A/B, the Q16 data-governance baseline, Q18–Q20 scale-up prerequisites and virtual-validation findings are all folded in here
- [`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)
  - Educational theory map (ideological constitution): pedagogy / psychology / neuroscience / LLM theories × implementation index
  - All literature verified online (DOI/arXiv links); source of theoretical basis for prompt rules and metric design
- [`ADMIN_TERMINOLOGY_AUDIT.md`](./ADMIN_TERMINOLOGY_AUDIT.md)
  - Single source for admin console terminology governance: term families, banned phrases, and guard rules
  - Source for `frontend/src/views/admin-redesign/terms.ts`, `statusText.ts` and the terminology guard tests

## Agents & Scenarios

- [`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md)
  - V3 field routing model: `agent-output-v1` shell contract, `internal.ext.*` namespace rules
- [`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md) ([en](./LEARNER_MODEL_ARCHITECTURE.en.md))
  - Learner model scene design: `LearnerSnapshot`, AI intervention timing, admin observation and recompute design
- [`LEARNER_STATE_REVIEW_DESIGN.md`](./LEARNER_STATE_REVIEW_DESIGN.md)
  - Learner state review design (LLM diagnosis layer + configurable BKT): diagnosis layer, projection triage, zero-training temporal belief update and calibration loop
  - Hard constraint: no extra/trained models — all via prompt + LLM + existing deterministic code
- [`LEARNER_CENTER_AND_STATE_FUSION.md`](./LEARNER_CENTER_AND_STATE_FUSION.md)
  - Q6/Q7 explainer (for developers): generic vs project-specific dimensions of the learner model; how state/knowledge is aggregated → split → fused → evaluated, what is wired and what is not
- `skill:session-wrapup` (formerly `session-wrapup-agent`, kept as alias; landed)
  - Unified post-session summary and evaluation
  - Replaced the main chain's `summary-agent + session-evaluation-agent`

## Path

- [`PATH_PRODUCTION_REPLAN_CONTRACT.md`](./PATH_PRODUCTION_REPLAN_CONTRACT.md) ([en](./PATH_PRODUCTION_REPLAN_CONTRACT.en.md))
  - Path production pipeline and replan contract

## Virtual Learners

- [`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)
  - Virtual learner chain source of truth: persona / stories / session simulation / referee
- [`VIRTUAL_LEARNER_DESIGN.md`](./VIRTUAL_LEARNER_DESIGN.md)
  - VL main document: persona/story specs, role-play mechanics, memory, generation pipeline, batch entry points
- [`VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md`](./VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md)
  - Simulated-day / study-load design: multi-day semantics, system-layer contract, page touchpoints, TODO list
- [`VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md`](./VIRTUAL_LEARNER_SIMULATED_DAY_CONTRACT.md)
  - Simulated-day interface freeze list: system-layer ↔ page-layer split and data contract

## KC & Concept Graph

- [`KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md`](./KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md)
  - Concept identity registry (L1) → edge table (L2) → regulation wiring (L3): identity first, graph second
- [`KC_MULTIPATH_AND_LEARNER_SIGNAL_SCOPE.md`](./KC_MULTIPATH_AND_LEARNER_SIGNAL_SCOPE.md)
  - Single-user multi-path × cross-day empirical run; classification of learner-signal scope (path / user)

## Admin Console

- [`ADMIN_OPERATIONS_MANUAL.md`](./ADMIN_OPERATIONS_MANUAL.md)
  - Admin operations SOP: `/admin/*` route → duty, metric definitions, action names, SOP + YAML quick reference
- [`ADMIN_VISUAL_LAYER_SPEC.md`](./ADMIN_VISUAL_LAYER_SPEC.md)
  - Admin visual layer v4 (Warm-Flat): hard rules, component vocabulary, guard ratchet, registered deviations
- [`NEWUI-PROTOTYPES.md`](./NEWUI-PROTOTYPES.md)
  - newui prototype registry and the "protovalue residue" rule (precedence: tokens.css / spec v4 > prototype > historical docs)
- [`ADMIN_COLUMN_WIDTH_SPEC.md`](./ADMIN_COLUMN_WIDTH_SPEC.md)
  - `.mk-table--fixed` column-width ratio contract, width tokens (three tiers in sync), utility alignment

## Developer Tooling

- [`DEV_SCRIPTS.md`](./DEV_SCRIPTS.md)
  - Developer scripts handbook: layout & naming conventions across the three script folders, the virtual-learner batch chain, a reusable tool index (gates / audits / probes / backfills / ops / evals), and how to spot and archive one-off scripts

---

## Process materials (not in the repo)

Survey snapshots (`SKILL_RUNTIME_MAP_MAIN/SIM`), design process records (`ORCHESTRATOR_FIELD_FLOW_REDESIGN`, the `QUICK_LEARN` design doc), the `design/` folder, `CHANGES_*` change logs and `doc/CHANGELOG` were cleaned up on 2026-09-05 and are no longer kept in the repository. Prompt-lab `archive/` (v2 legacy assets) was cleaned up at the same time.

Local process materials (design drafts, research surveys, dated snapshots, screenshots, etc.) live under `doc/local/` (gitignored, not tracked); the `doc/` root keeps only current, in-repo documents tracked by git.

**2026-10-16 tidy**: three untracked files were moved from the `doc/` root into `doc/local/` — `ADMIN-OPERATIONS-MANUAL.md` (a parallel draft of the ops manual spelled with hyphens; the canonical copy is `ADMIN_OPERATIONS_MANUAL.md`), `USER_SIDE_QA_REPORT.md` (2026-09-18 user-side walkthrough) and `agent-usage-audit-2026-09-22.md` (Agent usage investigation). In the same batch, 11 tracked-but-unlisted docs were added to the `.gitignore` allowlist and `NEWUI-PROTOTYPES.md` was registered.

**2026-11-02 tidy — reports/audits moved out of the repo**: under the scope rule that `doc/` keeps only design-principle / architecture / theory docs, 21 historical records were removed from `doc/`: the teaching-figure visual/pipeline reports (`VERSION_REPORT_V1–V8.md`, `TEACHING_PIPELINE_REPORT.md`, `TEACHING_PIPELINE_REPORT_2026-10-26.md`, `BOARD_MODE_REPORT.md`) and the audits/snapshots/archived design records (`ADMIN_PAGE_TEMPLATES.md`, `ADMIN_TABS_BUSINESS_AUDIT.md`, `ADMIN_MODULE_BENCHMARK.md`, `CONTEXT_MECHANISM_AUDIT.md`, `LEARNING_SCIENCE_AUDIT.md`, `ADMIN_COPY_SEMANTIC_AUDIT.md`, `FLOW-ARCH-AUDIT-REMEDIATION-2026-10-22.md`, `PATH_ANDERSON_ITERATION_NOTE.md` + `.en`, `VIRTUAL_LEARNER_PRESET_DESIGN.md`). Index count: 54 → 39. In the same-day local cleanup these 21 files were deleted from this machine along with the discarded/CI/old-run/recomputable artefacts under `doc/local/` (316MB → 42MB); they survive only in git history, and the remaining name-only citations (e.g. `ADMIN_PAGE_TEMPLATES.md (moved out of the repo; see git history)`) refer to those historical versions.
