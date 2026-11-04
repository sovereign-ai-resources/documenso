# About this fork

This fork runs the Documenso community edition with a small set of generic,
opt-in engine changes. It is public. Anything confidential (configuration,
deployment, secrets, templates, customer data, company names, domains, tenant
or site identifiers) lives in private systems and never enters this repo.

## Before your first push: install the pre-push hook

```sh
scripts/soar/install-hooks.sh
```

Run it once per clone and once per extra worktree, again after every
`npm install`, and again whenever `scripts/soar/` changes. It needs [gitleaks](https://github.com/gitleaks/gitleaks/releases)
on `PATH`; without it the hook refuses every push.

The hook runs gitleaks and the denylist on exactly the commits being pushed,
and the denylist on the names of the refs being pushed and on annotated tag
messages, and refuses the push on any finding. gitleaks uses the
`.gitleaks.toml` committed in what is being pushed, not your working copy. CI
runs the commit checks too, but CI only sees a leak after it is already public,
so the hook is the real gate. Agents working in this repo install it before
their first push too.

Never bypass the hook. Each of these skips it and publishes unscanned commits:

- `git push --no-verify`
- `HUSKY=0` in the environment, or a `~/.config/husky/init.sh` that sets it or
  exits, once `npm install` has pointed `core.hooksPath` back at husky (see
  below). The installer warns when it sees either.

How it coexists with husky: `npm install` runs husky, which sets
`core.hooksPath=.husky/_` and regenerates that directory each time. Husky's
stubs run `.husky/<hook>` when it exists, but skip every hook when `HUSKY=0`.
The installer therefore writes:

- `<git common dir>/soar-hooks/`: a copy of the guard scripts and denylist, so
  the hook works whichever branch is checked out
- `<git common dir>/soar-hooks/hooks/`: set as `core.hooksPath`. Its `pre-push`
  runs the guard directly, so `HUSKY=0` cannot skip it; every other hook hands
  off to husky's stub in `.husky/_` (or to `<git common dir>/hooks/` before
  `npm install` has created it), so the upstream lint hooks still run
- `<git common dir>/hooks/pre-push`: used if `core.hooksPath` is unset
- `.husky/pre-push`: used after `npm install` has reset `core.hooksPath` to
  `.husky/_` and before you re-run the installer (`HUSKY=0` skips this one);
  listed in `.git/info/exclude`, so it never shows up in `git status`

Every `npm install` resets `core.hooksPath` to `.husky/_`, so re-run the
installer after it. The package.json `prepare` script is upstream's and stays
untouched, which is why this is not automatic.

If `core.hooksPath` points anywhere else, the installer stops and tells you
what to add by hand.

If the hook refuses a push, rewrite the offending commits (for example with an
interactive rebase) so the value never appears in any commit. A follow-up
commit that deletes it is not enough: the history is public.

## Branches and tags

| Ref | What it is |
|---|---|
| `main` | Mirrors upstream `documenso/documenso` untouched. Never commit to it. |
| `soar` | Default and deployable branch: the upstream release named by `soar-base`, plus an ordered stack of fork commits on top. |
| `soar-base` (tag) | The upstream release tag `soar` is currently based on. |
| `sync/vX.Y.Z` | A replay of the stack onto a new upstream release, opened as a review-only PR. |
| `soar-archive/<tag>` (tags) | Previous `soar` tips, kept when `soar` moves to a new release. |

### Changing the fork

- Branch from `soar` and open a PR into `soar`.
- Feature PRs are **squash-merged**, so each fork change is exactly one commit
  in the stack.

### Taking a new upstream release

The stack is replayed, never merged, so each fork change stays one visible
commit and upstream conflicts show up file by file. Three workflows do it:

1. **`soar-upstream-sync.yml`** runs daily (and by hand). It compares upstream's
   newest release tag (`vX.Y.Z`; prereleases are ignored) with the release
   `soar-base` names, using `scripts/soar/upstream-release.sh`. For a newer
   release it runs `scripts/soar/replay.sh`, which does
   `git rebase --onto <new tag> soar-base soar` on a fresh `sync/<new tag>`
   branch, then runs the ee, Enterprise-flag, denylist and gitleaks checks on
   the result before pushing anything. It pushes `sync/vX.Y.Z` and opens a PR
   into `soar` with the release notes link, the divergence report, and a
   `security` label when the release notes mention security.
   - A `package-lock.json` conflict is not a conflict: the replay keeps
     upstream's lockfile and regenerates it with
     `npm install --package-lock-only --ignore-scripts`.
   - Any other conflict, or any failure before the PR opens, opens an issue
     titled `Upstream sync vX.Y.Z: ...` that names the fork commit and the
     conflicting files. The daily run skips a release while that issue is
     open or its `sync/` branch exists.
   - Run by hand with the release `soar-base` already names, it is a dry run:
     it checks that the replay reproduces `soar` exactly and pushes nothing.
2. **On the pushed sync branch**, `soar-guardrails.yml` (against the new
   release, via `scripts/soar/sync-base.sh`) and `soar-sync-checks.yml` (lint,
   build, Docker image, Playwright) run. They run on push, because GitHub runs
   no pull_request workflows for a PR it cannot merge, and a sync PR into
   `soar` often cannot be merged. Their results show on the PR.
3. **`soar-promote.yml`** runs when the sync PR is approved. It checks that a
   repository admin (or a whole-repo owner in CODEOWNERS) approved the PR's
   current head, and that every check on that head passed. The sync PR names
   the `soar` commit it was replayed from, and promotion is refused if `soar`
   has moved since, so a fork change merged in the meantime is never dropped:
   delete the sync branch and run the sync again. Then
   `scripts/soar/promote.sh`, in one atomic push, tags the old `soar` tip as
   `soar-archive/<old tag>`, force-moves `soar` to the sync branch (leased on
   the tip it read), and moves `soar-base` to the new tag. It comments on and
   closes the PR and deletes the branch. If approving does not start it (the
   same unmergeable-PR rule), run it by hand with the PR number.

The sync PR is reviewed but **never merged**: a GitHub merge would duplicate
the stack. Security releases should reach production within a week of
publication.

To resolve a conflict, replay locally, fix the named fork commit so it applies
to the new release, land that fix as a PR into `soar`, close the issue, and let
the next run retry:

```sh
git fetch upstream tag vX.Y.Z --no-tags
scripts/soar/replay.sh vX.Y.Z      # exit 2 names the commit and files
```

`scripts/soar/test-sync.sh` exercises the replay, promote and release-detection
scripts against throwaway repositories (it stubs `npm`).

### Repository settings the sync needs

These are set by a repository admin; nothing in this repo can set them.

- **A GitHub App**, installed on this repository only, with repository
  permissions Contents, Pull requests, Workflows and Issues set to read and
  write (Metadata read is implied). Store its App ID as the Actions secret
  `SOAR_SYNC_APP_ID` and a private key as `SOAR_SYNC_APP_PRIVATE_KEY`. The
  workflows push with its token, not `GITHUB_TOKEN`, because `GITHUB_TOKEN`
  cannot push workflow files and its pushes and PRs start no workflows.
- **Actions enabled** on this fork, including scheduled workflows, with
  `soar` as the default branch (scheduled workflows run only from it).
- **Upstream's `deploy.yml` and `publish.yml` workflows disabled** in the
  Actions settings. `deploy.yml` runs on every tag push, and promotion pushes
  the `soar-base` and `soar-archive/*` tags.
- **The `soar` ruleset.** It already requires a PR with the four guard checks
  (packages/ee untouched, Enterprise flags off, Denylist, gitleaks), allows
  only squash merges so each fork change stays one commit, and blocks force
  pushes and deletion. Only repository admins bypass it. Keep all of that.
  Once the sync App exists, **add the App as a bypass actor** on this
  ruleset. Without it the promote workflow's force-move of `soar` is
  rejected and nothing is promoted; with it, only the promote workflow and
  admins can force-move `soar`.
- **Protect `sync/*`** once the App exists: a branch ruleset that only the
  App bypasses, so only it can create, update or delete these branches and
  the head a reviewer approves is what the automation built.
- **Protect the tags `soar-base` and `soar-archive/*`** once the App exists:
  a tag ruleset that only the App bypasses, so only it can create, move or
  delete them.

## Rules that keep the replay cheap

1. **No Prisma schema migrations.** New per-recipient data goes in the existing
   `authOptions` JSON.
2. **New behavior lives in new files.** Upstream files get at most a one-line
   hook point that calls into them.
3. **Every behavior change sits behind an environment flag whose default is
   upstream behavior**, so with the flag unset the fork behaves exactly like
   upstream and each change stays upstreamable.
4. **Never touch `packages/ee`.** It is under Documenso's commercial license.
5. **Never enable a Documenso Enterprise feature** (`cfr21`,
   `instanceCscSigning`, `authenticationPortal`, `emailDomains`, `hipaa`,
   `cscQesSigning`) in a seed, migration, or code path.

## What CI checks

`.github/workflows/soar-guardrails.yml` runs on every PR into `soar` and every
push to `soar`, comparing against `soar-base`. For a sync branch, on push and
on a PR from it, it compares against the upstream release that branch was
replayed onto, and fails for a `sync/` branch not named `sync/vX.Y.Z`:

| Job | Script | Fails when |
|---|---|---|
| packages/ee untouched | `scripts/soar/check-ee-untouched.sh` | anything under `packages/ee` differs from `soar-base` |
| Enterprise flags off | `scripts/soar/check-enterprise-flags.sh` | an added line sets one of the flags above to anything but a literal `false` (aliases and env-derived values included), or compares one with `true`. Prisma `include`/`select` objects and lines marked `// soar-allow-flag: <why>` are exempt |
| Denylist | `scripts/soar/check-denylist.sh` | an added line, the path of an added or modified file (binary and empty files included), a commit message, or an author/committer identity contains a denylisted value |
| gitleaks | pinned, checksum-verified gitleaks release with `.gitleaks.toml` | gitleaks reports a possible secret in the fork's commits |
| Divergence report | `scripts/soar/divergence-report.sh` | never; it lists the upstream files the stack modifies, for review |
| Fork script tests | `scripts/soar/test-guardrails.sh`, `scripts/soar/test-sync.sh` | the guardrail or sync scripts no longer behave as their tests expect |

`scripts/soar/denylist.txt` holds only SHA-256 hashes, so this repo does not
spell out what it guards. The `check-*` scripts and `divergence-report.sh`
compare against `SOAR_BASE` (default `soar-base`); the pre-push hook ignores it
and scans the range being pushed. `scripts/soar/test-guardrails.sh` exercises every check
against throwaway repositories.

The upstream checks also apply: `npm run lint`, `npm run build`, and the
Playwright suite (`npm run ci`). The root `package.json` has no separate
typecheck or unit-test script.
