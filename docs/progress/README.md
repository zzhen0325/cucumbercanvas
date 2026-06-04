# Progress Archives

Root `progress.md` is the current handoff window. It should stay short enough to read at session start.

Policy:

- Active threshold: 300 lines.
- When `progress.md` reaches the threshold, run `pnpm progress:rotate` from the repository root.
- The rotation script archives the full previous `progress.md` snapshot into this directory before resetting the root file.
- Treat archive files as immutable historical snapshots. Add new handoff notes to root `progress.md`, not to an old archive.

