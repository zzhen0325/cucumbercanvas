# Cucumber Studio

Cucumber Studio is an AI creative workspace for design teams. The app centers on an infinite canvas with chat-driven creation, project assets, Brand Kit, workspace skills, and Seedream image/video generation.

## Current Scope

- UI name: Cucumber Studio
- Package scope: `@cucumber/`
- Environment variable prefix: `CUCUMBER_` (`NEXT_PUBLIC_CUCUMBER_*` for browser-exposed values)
- Image/video generation provider: Seedream / Volcengine only
- Skill marketplace/import: enabled
- Brand Kit: enabled

## Workspace

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

If a previous dev server leaves `3000` or `CUCUMBER_SERVER_PORT` occupied, run:

```bash
pnpm dev:clean
pnpm dev:restart
```

Seedream requires:

```bash
CUCUMBER_VOLCENGINE_ACCESS_KEY_ID=
CUCUMBER_VOLCENGINE_SECRET_ACCESS_KEY=
CUCUMBER_SEEDREAM_REQ_KEY=jimeng_seedream46_cvtob
```

For video generation, set `CUCUMBER_SEEDREAM_VIDEO_REQ_KEY` when a separate Seedream video req_key is available.
