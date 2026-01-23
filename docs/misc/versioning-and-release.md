# Versioning & Release Process

This repository uses **Semantic Versioning** and **semantic-release** to automate publishing.
Releases are split into **staging** and **production** channels based on branch:

- `dev` → **staging** dist-tag (prerelease versions, e.g. `1.2.0-dev.3`)
- `main` → **latest** dist-tag (stable versions, e.g. `1.2.0`)

## Goals

- Zero manual version bumps
- Minimal developer overhead
- Safe staging channel for QA
- Consistent release notes and tags

## Branches & Release Channels

| Branch | npm dist-tag | Version format | Audience |
|--------|---------------|----------------|----------|
| `dev`  | `staging`     | `X.Y.Z-dev.N`  | QA / internal |
| `main` | `latest`      | `X.Y.Z`        | production |

## Commit Convention (required)

We rely on **Conventional Commits** to determine release type:

| Commit type | Release | Example |
|-------------|---------|---------|
| `feat:`     | minor   | `feat: add config cache` |
| `fix:`      | patch   | `fix: handle empty instructionContent` |
| `perf:`     | patch   | `perf: reduce startup verification` |
| `refactor:` | none*   | `refactor: cleanup registry loader` |
| `chore:`    | none*   | `chore: update deps` |
| `docs:`     | none*   | `docs: update release doc` |

\* no release unless it includes **BREAKING CHANGE**

**Breaking changes**
- Use `!` in the type (e.g. `feat!: change schema contract`)  
- Or add footer: `BREAKING CHANGE: ...`

## What Happens on Push / Merge

### Push or merge to `dev`
- semantic-release computes next prerelease version
- Publishes to npm with dist-tag **staging**
- Example output: `1.2.0-dev.3`

### Push or merge to `main`
- semantic-release computes next stable version
- Publishes to npm with dist-tag **latest**
- Example output: `1.2.0`

## Merge Strategy (dev → main)

Do **not** squash merge the release PR.

- ✅ **Merge commit** (recommended)
- ✅ **Rebase and merge** (only if GitHub allows it; no merge commits)
- ❌ **Squash and merge** (loses Conventional Commits → release may be skipped)

## How to Install

- **Staging** (QA/internal):
  ```bash
  npm i @testany/agent-chatter-core@staging
  ```

- **Production**:
  ```bash
  npm i @testany/agent-chatter-core@latest
  ```

## Hotfix Flow

Hotfixes are just normal `fix:` commits merged into `main`.
semantic-release will publish a patch version (e.g. `1.2.1`).

If hotfixes must be validated first, merge to `dev` → verify → merge to `main`.

## Version Ownership

Do **not** manually bump `package.json` version.
semantic-release controls the published version based on commit history and tags.

## CI Requirements

For release jobs to publish:

- `NPM_TOKEN` secret must be set
- CI must run on `dev` and `main`
- Tests + typecheck + lint + coverage must pass
- `npm run release` runs only on **Node 22** in the workflow matrix

## semantic-release Preset Notes

We use a custom adapter to load Conventional Commits config:

- Config file: `scripts/conventionalcommits.cjs`
- Dependency: `conventional-changelog-conventionalcommits`

This is required by both:
`@semantic-release/commit-analyzer` and `@semantic-release/release-notes-generator`.

## Git Tags

semantic-release creates Git tags on publish:

- Staging: `vX.Y.Z-dev.N`
- Production: `vX.Y.Z`

The workflow requires `contents: write` permissions to push these tags.

## Local Sync Automation

We provide git hooks to keep local branches fresh and block stale pushes.

Install once:

```bash
./scripts/install-githooks.sh
```

Behavior:

- **post-merge**: auto syncs **dev/main** (fast-forward only).
- **pre-push**: blocks push if current branch is behind its base.

Default base branch is `dev`. Override per branch:

```bash
git config branch.<your-branch>.base main
```

Manual sync command:

```bash
./scripts/sync-local.sh
```

## Operational Notes

- `dev` releases are safe to publish frequently
- `main` releases should be treated as production
- If no `feat:`/`fix:`/`perf:` commits since last release, **no publish** occurs
