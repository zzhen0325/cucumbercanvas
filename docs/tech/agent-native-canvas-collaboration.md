# AI-native canvas collaboration

Last updated: 2026-05-27 CST

This note defines the B-stage foundation for moving from an editable OpenPencil main path to an AI-native canvas collaboration system.

## Product boundary

B is scoped to making Agent canvas generation organized, constrained, observable, replayable, and resumable. It does not include full multiplayer collaboration, plugin marketplace, desktop integrations, or full native codegen.

## Runtime context

Every Agent run now has a structured `agent-context-v1` payload:

- `promptContext`: stable prompt layers for `user_goal`, `project_context`, `style_intent`, `layout_plan`, `execution_tasks`, and `critique_rules`.
- `styleguide`: run-scoped styleguide derived from project Brand Kit or explicitly mentioned brand assets.
- `team`: default AgentTeams roster with Planner, Designer, Critic, Coder/Exporter, and Researcher roles.
- `modelProfiles`: capability profile for the active model, including strengths, cost/speed tier, context window, tool support, vision support, and recommended roles.

The runtime injects this payload into the user message as `<agent_run_context>`, alongside existing `<canvas_state>`, attachment, mention, and generation preference blocks. The main system prompt treats this block as the collaboration protocol for complex canvas work.

## Stream events

The shared stream event union includes two B-stage events:

- `run.context`: emitted after `run.started`, carrying the prompt layers, styleguide, team plan, and model profile used by the run.
- `agent.stage`: emitted for prompt-layer preparation and around tool execution. Tool names are mapped to role/stage semantics such as planning, design, research, critique, and export.

Existing chat clients can ignore these events safely. Canvas/process views can use them to render planning traces, task graphs, critique passes, and replay timelines without scraping assistant text.

## AgentTeams

The Deep Agents runtime registers default sub-agents:

- Planner: breaks goals into layers, tasks, constraints, and spatial plans.
- Designer: creates editable canvas structure and visual hierarchy.
- Critic: checks brand fit, layout coherence, text overflow, and replayability.
- Coder/Exporter: prepares React/HTML/Vue or file outputs when requested.
- Researcher: gathers external/project facts only when factual context changes the result.

The existing video generation specialist remains available for video tasks.

## Replay path

This slice does not persist full replay snapshots yet. It creates the typed event spine required for B5:

- `run.context` records the input context.
- `agent.stage` records process milestones.
- existing `tool.started` / `tool.completed` records tool inputs, outputs, summaries, and artifacts.
- existing `canvas.sync` records canvas mutation refresh points.

The next replay slice should persist stage events and canvas diffs against `agent_runs` or an adjacent run-event table, then add resume controls for plan approval, styleguide edits, locked containers, redo requests, and critique accept/reject decisions.
