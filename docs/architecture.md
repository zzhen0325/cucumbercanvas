# Cucumber Studio Architecture

## Purpose

Cucumber Studio is an AI-native creative workspace for design teams. The core product loop is:

1. A user opens a project workspace.
2. The user edits or prompts from the canvas/chat surface.
3. The backend agent runtime plans and calls typed tools.
4. Jobs, providers, skills, and persistence services produce artifacts.
5. The frontend renders durable canvas/project state and streams execution feedback.

This document is the high-level map for future agents and maintainers. Keep detailed implementation notes near the code or under `docs/tech/`.

## Monorepo Layout

- `apps/web/`: Next.js App Router frontend. Owns routes, canvas UI, chat UI, settings, Brand Kit, skills UI, and client API wrappers.
- `apps/server/`: Fastify backend. Owns HTTP routes, WebSocket streaming, agent runtime, Supabase services, generation jobs, workers, and provider integrations.
- `packages/shared/`: shared TypeScript contracts for events, jobs, artifacts, HTTP, brand kits, and errors.
- `packages/ui/`: shared UI package boundary. Keep reusable primitives here only when they are genuinely cross-app.
- `packages/config/`: shared TypeScript config package.
- `skills/`: workspace skills discovered by the backend agent runtime.
- `supabase/`: local Supabase config and migrations. Treat production migrations as protected.
- `scripts/`: setup, debug, and verification entry points.

## Frontend Architecture

The frontend is organized around route-level surfaces and reusable components:

- `apps/web/src/app/`: route layouts and pages.
- `apps/web/src/components/canvas*` and `components/canvas/`: canvas editor, generation panels, files, layers, toolbar, and video/image element UI.
- `apps/web/src/components/chat/`: message rendering, tool/thinking blocks, markdown, errors, and attachments.
- `apps/web/src/components/brand-kit/`: Brand Kit editing workflow.
- `apps/web/src/hooks/`: data and interaction hooks. Prefer keeping network state and polling concerns here rather than inside view components.
- `apps/web/src/lib/`: API clients, environment parsing, normalization, auth context, and domain helpers.

UI code should keep the productivity surface stable and dense. Reuse existing components and local patterns before adding new abstractions.

## Backend Architecture

The backend is split into route, service, agent, generation, and worker layers:

- `apps/server/src/http/`: HTTP route registration. Routes should validate inputs and call services.
- `apps/server/src/features/`: domain services for projects, chat, canvas, jobs, brand kits, skills, uploads, settings, and agent runs.
- `apps/server/src/agent/`: Deep Agents/LangChain runtime, persistence, prompts, sub-agents, tools, and skill discovery.
- `apps/server/src/generation/`: provider registry and Seedream image/video generation implementation.
- `apps/server/src/ws/`: WebSocket connection, buffering, logging, and handler logic.
- `apps/server/src/worker.ts`: background job worker entry point.

Keep cross-layer contracts typed through `packages/shared`. Do not duplicate event or job shapes in app-local files unless they are private implementation details.

## Agent Runtime

Agent work flows through:

1. Chat/session state enters the server through HTTP or WebSocket paths.
2. Runtime code under `apps/server/src/agent/` builds the agent, prompt, persistence, backend mode, tools, and skills.
3. Tools under `apps/server/src/agent/tools/` perform bounded operations such as canvas inspection, manipulation, generation requests, asset persistence, project search, and Brand Kit reads.
4. Streaming adapters translate agent/tool progress into user-visible events.
5. Persistence stores thread, run, project, canvas, and artifact state through Supabase-backed services.

Detailed workflow and tool inventory:

- `docs/tech/agent-runtime-workflow.md`: current agent execution flow, output types, tool inventory, sub-agents, and skill exposure model.

When editing agent code:

- Preserve tool input/output contracts.
- Log key identifiers such as session, project, run, job, provider, and worker IDs when available.
- Keep framework-level orchestration changes documented.
- Consult LangChain/LangGraph/Deep Agents docs before changing orchestration, checkpointer, store, or tool protocol behavior.

## Data And Artifact Flow

Canvas/product state is durable and should be treated as the source of truth after successful persistence. Generated media flows through provider jobs, worker execution, upload/persistence services, and then back into canvas/chat UI.

Preferred flow:

1. Frontend sends an intent.
2. Server validates and records enough context to debug.
3. Agent/tool or route service creates a typed job or state mutation.
4. Worker/provider produces the artifact.
5. Upload/persistence service stores the artifact.
6. Frontend receives a durable URL/state update.

Avoid UI-only state for anything the user expects to survive refresh, navigation, or another session.

## Observability

Logs should answer these questions without reading code:

- Which user/session/project/canvas/job/run was involved?
- Which provider/tool/worker handled it?
- What input mode or model was selected?
- Was the failure validation, provider, persistence, network, timeout, or user cancellation?

Use TODO comments only for real follow-up work with enough context for the next maintainer.

## Protected Boundaries

Do not modify the following without explicit user approval:

- `.env` and `.env.local`.
- `pnpm-lock.yaml` unless dependencies change.
- Production database migrations.
- Auth, payment, or deployment logic.
- Global design tokens and app-wide styles.
