# Design Documentation Index

> Convention: files listed here (under doc/) are the **current, in-repo documents** (tracked by git, visible on GitHub).
> Process materials — `archive/`, `history/`, `design/`, survey snapshots, historical change logs — are kept **locally only** and are not tracked by git (since 2026-09-05); they are not linked here. For anything current, rely on the root docs and the code.

## Protocols & Prompt System

- [`SKILL_PROTOCOL_V4.md`](./SKILL_PROTOCOL_V4.md)
  - Unified Skill Protocol v4 (rules): core.yaml / six input channels / five-block compiled prompt / three gate checks / SkillResult
  - Supreme guideline for future AI development & refactoring (v4.1-draft: §2.6 orchestration files; orchestration files are the single source for field routing)
- [`SKILL_DEVELOPMENT_GUIDE.md`](./SKILL_DEVELOPMENT_GUIDE.md)
  - Skill development guide (for developers): selection → scaffold → wiring → fields → gates → publish → tests (2026-08-12)

## Architecture & Governance

- [`NON_FUNCTIONAL_GOVERNANCE_PLAN.md`](./NON_FUNCTIONAL_GOVERNANCE_PLAN.md)
  - Security, reliability, testing, deployment, observability, performance, and data governance checklist
  - Release blockers, implementation waves, and release acceptance criteria
- [`EDUCATIONAL_THEORY_MAP.md`](./EDUCATIONAL_THEORY_MAP.md)
  - Educational theory map (ideological constitution): pedagogy/psychology/neuroscience/LLM theories × implementation index
  - All literature verified online (DOI/arXiv links); source of theoretical basis for prompt rules and metric design

## Agents & Scenarios

- [`AGENT_IO_DESIGN_V3.md`](./AGENT_IO_DESIGN_V3.md)
  - V3 field routing model: `agent-output-v1` shell contract, `internal.ext.*` namespace rules
- [`LEARNER_MODEL_ARCHITECTURE.md`](./LEARNER_MODEL_ARCHITECTURE.md) ([en](./LEARNER_MODEL_ARCHITECTURE.en.md))
  - Learner model scene design: `LearnerSnapshot`, AI intervention timing, admin observation and recompute design
- `skill:session-wrapup` (formerly `session-wrapup-agent`, kept as alias; landed)
  - Unified post-session summary and evaluation
  - Replaced the main chain's `summary-agent + session-evaluation-agent`

## Path

- [`PATH_PRODUCTION_REPLAN_CONTRACT.md`](./PATH_PRODUCTION_REPLAN_CONTRACT.md) ([en](./PATH_PRODUCTION_REPLAN_CONTRACT.en.md))
  - Path production pipeline and replan contract
- [`PATH_ANDERSON_ITERATION_NOTE.md`](./PATH_ANDERSON_ITERATION_NOTE.md) ([en](./PATH_ANDERSON_ITERATION_NOTE.en.md))
  - Path enrichment / Anderson annotation iteration notes

## Virtual Learners

- [`VIRTUAL_LEARNER_CHAIN.md`](./VIRTUAL_LEARNER_CHAIN.md)
  - Virtual learner chain source of truth: persona / stories / session simulation / referee

---

## Process materials (removed, not in repo)

Survey snapshots (`SKILL_RUNTIME_MAP_MAIN/SIM`), design process records (`ORCHESTRATOR_FIELD_FLOW_REDESIGN`, `QUICK_LEARN` design doc), `design/` folder, `CHANGES_*` change logs and `doc/CHANGELOG` were cleaned up on 2026-09-05 and are no longer kept in the repository. Prompt-lab `archive/` (v2 legacy assets) was cleaned up at the same time.
