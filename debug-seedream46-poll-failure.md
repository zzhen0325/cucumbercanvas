# [OPEN] Seedream 4.6 Poll Failure

## Session
- session_id: `seedream46-poll-failure`
- created_at: `2026-05-21`
- scope: `apps/server` Seedream 4.6 image generation create/poll/failure-marking chain

## Symptom
- Seedream 4.6 image generation jobs intermittently fail during poll with `500/50500 Internal Error`.
- Worker then attempts to mark the canvas placeholder as failed and may emit a secondary `Image generation placeholder not found` error.

## Hypotheses
1. Request payload or model-specific parameters are incompatible with the Seedream 4.6 provider path.
2. Create and poll requests use inconsistent auth, region, or task identifiers.
3. Provider returns richer failure details that are currently lost in local error normalization.
4. Retry cadence or polling timing triggers provider-side transient failure behavior.
5. Canvas failure-marking emits a misleading secondary error after the upstream provider failure.

## Evidence Log
- Pending.

## Plan
1. Inspect current Seedream provider and executor code paths.
2. Add instrumentation only around create/poll/failure normalization boundaries.
3. Reproduce with a minimal request and collect runtime evidence.
4. Determine confirmed hypothesis, then implement the smallest fix.
5. Verify with post-fix evidence before cleanup.
