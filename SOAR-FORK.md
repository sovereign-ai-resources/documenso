# About this fork

This fork runs the Documenso community edition with a small set of generic,
opt-in engine changes. It is public. Anything confidential (configuration,
deployment, secrets, templates, customer data, company names, domains, tenant
or site identifiers) lives in private systems and never enters this repo.

## Before your first push: install the pre-push hook

```sh
scripts/soar/install-hooks.sh
```

Run it once per clone and once per extra worktree, and again whenever
`scripts/soar/` changes. It needs [gitleaks](https://github.com/gitleaks/gitleaks/releases)
on `PATH`; without it the hook refuses every push.

The hook runs gitleaks and the denylist on exactly the commits being pushed and
refuses the push on any finding. CI runs the same checks, but CI only sees a
leak after it is already public, so the hook is the real gate. Agents working
in this repo install it before their first push too. Never push with
`--no-verify`.

How it coexists with husky: `npm install` runs husky, which sets
`core.hooksPath=.husky/_` and regenerates that directory each time. Husky's
stubs run `.husky/<hook>` when it exists. The installer therefore writes:

- `<git common dir>/soar-hooks/`: a copy of the guard scripts and denylist, so
  the hook works whichever branch is checked out
- `<git common dir>/hooks/pre-push`: used while `core.hooksPath` is unset
  (before `npm install`)
- `.husky/pre-push`: used once husky owns `core.hooksPath`; listed in
  `.git/info/exclude`, so it never shows up in `git status`

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
commit and upstream conflicts show up file by file:

```sh
git rebase --onto <new upstream tag> soar-base soar   # onto a sync/vX.Y.Z branch
```

- If `package-lock.json` conflicts, take upstream's lockfile and regenerate it
  with `npm install --package-lock-only`; that is not a real conflict.
- The full test suite and the guardrails run on the sync PR. The PR is reviewed
  but **never merged**: a GitHub merge would duplicate the stack.
- Once approved, the promote step tags the old `soar` tip as
  `soar-archive/<old tag>`, moves `soar` to the sync branch, and moves
  `soar-base` to the new tag. Only that promote step may force-push `soar`.
- Security releases should reach production within a week of publication.

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
push to `soar`, comparing against `soar-base`:

| Job | Script | Fails when |
|---|---|---|
| packages/ee untouched | `scripts/soar/check-ee-untouched.sh` | anything under `packages/ee` differs from `soar-base` |
| Enterprise flags off | `scripts/soar/check-enterprise-flags.sh` | an added line sets one of the flags above to true |
| Denylist | `scripts/soar/check-denylist.sh` | an added line, new file path, commit message, or author/committer identity contains a denylisted value |
| gitleaks | pinned, checksum-verified gitleaks release with `.gitleaks.toml` | gitleaks reports a possible secret in the fork's commits |
| Divergence report | `scripts/soar/divergence-report.sh` | never; it lists the upstream files the stack modifies, for review |

`scripts/soar/denylist.txt` holds only SHA-256 hashes, so this repo does not
spell out what it guards. Every script takes the base from `SOAR_BASE`
(default `soar-base`). `scripts/soar/test-guardrails.sh` exercises every check
against throwaway repositories.

The upstream checks also apply: `npm run lint`, `npm run build`, and the
Playwright suite (`npm run ci`). The root `package.json` has no separate
typecheck or unit-test script.
