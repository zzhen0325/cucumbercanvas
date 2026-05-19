# Cucumber Studio Design System

## Product Feel

Cucumber Studio is a work surface for AI-assisted creative production. The UI should feel clean, stable, modular, and fast to scan. Favor professional tool ergonomics over decorative presentation.

Design decisions should support:

- Repeated canvas and chat use.
- Clear project and asset management.
- Fast model/tool selection.
- Transparent generation status and recoverable errors.
- Consistent Brand Kit handling.

## Current Stack

- Next.js App Router.
- React 19.
- Tailwind CSS 4.
- shadcn-style components with Base UI primitives where the project already uses them.
- `lucide-react` for icons.
- Shared UI boundary in `packages/ui/`.

## UI Principles

- Reuse existing components first.
- Keep spacing, radius, colors, typography, and focus states consistent with surrounding UI.
- Prefer semantic component variants over hardcoded style overrides.
- Do not change global tokens or `globals.css` without a clear reason.
- Avoid nested cards and marketing-style layouts inside product workflows.
- Use icons for common tool actions and visible labels for commands that need clarity.
- Keep controls stable in size so hover, loading, and dynamic text do not shift layout.

## Canvas And Productivity Surfaces

Canvas, chat, and generation controls should prioritize density and predictability:

- Toolbars should use compact icon buttons with accessible names/tooltips.
- Side panels should have stable widths and scroll behavior.
- Generation panels should expose model, prompt, attachment, status, and retry states clearly.
- Empty states should be useful but not oversized.
- Error states should preserve enough detail to diagnose provider, network, auth, or validation failures.

## Components

Use these areas before adding new components:

- `apps/web/src/components/ui/`: low-level UI primitives.
- `apps/web/src/components/chat/`: message, markdown, tool, thinking, and error rendering.
- `apps/web/src/components/brand-kit/`: Brand Kit sections and field patterns.
- `apps/web/src/components/canvas/`: canvas-specific media and generation panels.
- `apps/web/src/components/skeletons/`: loading states.

New reusable components should be added only when they remove meaningful duplication or define a stable product pattern.

## Color, Type, And Spacing

- Prefer existing Tailwind tokens and local class patterns.
- Avoid one-off hex values unless the surrounding file already does that.
- Do not introduce large palette shifts from isolated feature work.
- Keep text sizes proportional to the surface. Compact panels should not use hero-scale headings.
- Preserve readable contrast for text, icons, borders, disabled states, and focus rings.

## Interaction Rules

- Use buttons for commands, segmented controls/tabs for mode switching, toggles/checkboxes for binary settings, sliders/inputs for numeric values, and menus for option sets.
- Preserve keyboard and focus behavior provided by existing primitives.
- Avoid adding animation unless it clarifies state or follows an existing local convention.
- Loading states should not hide critical context. Prefer disabled controls plus visible progress.

## Review Checklist

- Does this reuse existing components and tokens?
- Does text fit across mobile and desktop sizes?
- Are error, loading, empty, and disabled states handled?
- Does the layout remain stable during streaming or generation updates?
- Is any new visual pattern documented or obviously local to one feature?
- Can a user diagnose what happened when generation or agent execution fails?
