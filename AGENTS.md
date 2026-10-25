# Pocket Flight repository navigation

This is the current `pocket-flight-site` checkout. The sibling `pocket-flight` repository contains an older game; inspect the working directory and branch before testing or editing.

## Start here

- Read [README.md](README.md#find-the-code) for feature ownership and task-to-file pointers.
- Inspect `git status --short` before changes. Preserve existing dirty work, including source, calibration JSON, lab code and aircraft assets.
- For an old source path, consult the [relocation map](docs/REPOSITORY_NAVIGATION.html#relocations).
- Use Bun. Keep strict TypeScript types and direct imports to the owning module.

## Placement

- Put menus and app lifecycle in `src/app/`; instruments and touch controls in `src/hud/`.
- Put simulation, contacts and missions in `src/flight/`; aircraft models, systems and mechanisms in `src/aircraft/`.
- Each aircraft owns its specific definitions and parts under `src/aircraft/finch/`, `aurelia/`, `peregrine/`, or `stormbird/`. Keep shared assembly, mass calculations, materials, displays, and jet helpers at the aircraft root. Add aircraft definition files to `scripts/aircraft-source.ts` when offline report fingerprints need to cover them.
- Use `src/world/`, `src/audio/`, `src/replay/`, and `src/studio/` for their respective features.
- Put standalone HTML-page implementations and their CSS in `src/viewers/`.
- Keep the private wind tunnel in `lab/`. It shares flight/aircraft code but has its own build and workers.
- Keep existing test paths under `tests/` and authoring/check commands under `scripts/`.
- Co-locate feature-specific helpers and styles with their owner. Introduce a shared module only when actual callers need it.

## Check a change

1. For non-trivial work, run `code-review-graph status`; build a missing graph or update a stale one. Verify graph findings against source.
2. Run `bun run repo:check` after moving a file or changing an import or navigation link.
3. Run focused tests, then the active suite with `bun run test` when the change affects multiple features. Unscoped discovery can include historical nested projects.
4. Run `bun run build` for runtime edits, and `bun run lab:build` for lab edits or changes to shared flight/aircraft dependencies.
5. Preserve gameplay, visuals, asset URLs, browser storage keys, and existing saved-project compatibility during restructuring. Verify older project backups when touching serialization.
6. Refresh the graph after structural edits. Report baseline failures separately from regressions and state which verification was actually performed.

For repository-navigation work, verify offline. Open the game only when the user requests browser verification.

The navigation redesign is not authorization to delete ignored working data, regenerate aircraft assets, publish the site, or change flight tuning.
