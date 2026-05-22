-- Canonicalize canvases.content to the Cucumber Canvas document model.
-- Legacy Excalidraw payloads are intentionally reset instead of migrated.

alter table public.canvases
  alter column content set default '{
    "schemaVersion": "cucumber-canvas-v1",
    "nodes": {},
    "rootNodeIds": [],
    "assets": {},
    "viewport": {
      "x": 0,
      "y": 0,
      "zoom": 1,
      "backgroundColor": "#ffffff"
    },
    "selection": []
  }'::jsonb;

update public.canvases
set content = '{
  "schemaVersion": "cucumber-canvas-v1",
  "nodes": {},
  "rootNodeIds": [],
  "assets": {},
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1,
    "backgroundColor": "#ffffff"
  },
  "selection": []
}'::jsonb
where content->>'schemaVersion' is distinct from 'cucumber-canvas-v1';

comment on column public.canvases.content is
  'Cucumber canvas document: { schemaVersion, nodes, rootNodeIds, assets, viewport, selection }. Legacy Excalidraw payloads are no longer supported.';
