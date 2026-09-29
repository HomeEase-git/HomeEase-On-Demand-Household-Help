# Automated security checks (CI)

What runs on every pull request and every change to `main`, what each check
catches, and what to do when one fails. The workflows are in
`.github/workflows/`. Results appear on the pull request and in the
repository's **Security** tab.

## Checks

| Check | Where | Catches | Fails the PR when |
|---|---|---|---|
| **CodeQL** | `security.yml` → `codeql` | Injection, XSS, path traversal, unsafe redirects, weak crypto and similar code-level bugs in backend, admin web and mobile (JavaScript/TypeScript, `security-extended` queries) | The PR adds a new high/critical alert. The `codeql` job itself only uploads results; the separate **CodeQL** check that GitHub adds to the PR is the one that fails. It compares against `main` and respects alerts dismissed as false positives. The same applies to the **Trivy** check. Make both required in branch protection |
| **Secret scan** (gitleaks) | `security.yml` → `secrets` | API keys, tokens, private keys and passwords in commits | Any commit in the PR adds one, even if a later commit removes it |
| **Dependency review** | `security.yml` → `dependency-review` | A PR adding or upgrading to a package with a known high/critical vulnerability, in any app, including dev and build tools | Such a package is added |
| **Container scan** (Trivy) | `security.yml` → `images` | Known vulnerabilities in the backend and admin web Docker images (OS packages + npm). Also starts the backend image the way Render does (migrations, then the app) | A **critical** vulnerability with a released fix. Everything high and critical is reported to the Security tab either way |
| **npm audit** | `ci.yml` | Known vulnerabilities in what each app ships | Backend and web: high or critical. Mobile: critical (see below) |
| **SBOM** | `security.yml` → `sbom` | Nothing: records every shipped dependency (CycloneDX) for each `main` commit, kept 90 days (Actions → run → Artifacts) | Never |

Also on:
- **GitHub secret scanning with push protection** blocks a push that contains a recognised provider key before it reaches the repository.
- **Dependabot** keeps npm packages, Docker base images and the pinned GitHub Actions up to date with weekly PRs.
- **A weekly run** (Mondays) repeats the full-history secret scan, CodeQL and the container scan, because new advisories and scanner rules appear even when the code doesn't change.

## Supply-chain rules for the workflows

- **Pin third-party actions to a full commit SHA**, with the version as a comment: `uses: owner/action@<40-char sha> # v1.2.3`. A tag like `@v4` can be moved to different code by whoever controls the action's repository; a SHA can't. Dependabot updates the SHA and the comment together.
- **Default to `permissions: contents: read`.** Grant a job more only if it needs it, the way CodeQL and Trivy get `security-events: write` to upload results.
- **Pin downloaded tools to an exact version with a SHA-256 written in the workflow**, as gitleaks and Trivy are in `security.yml`. To upgrade, download the new release, compare `sha256sum` with the release's checksums file, and update both values.

## When a check fails

**CodeQL alert:** open it from the PR (or Security → Code scanning). Fix the code. Dismiss an alert only as "false positive" or "used in tests", with a comment saying why.

**Secret found in a PR:**
1. Treat the secret as leaked, even though the PR isn't merged: the branch is public. Rotate it first (`docs/SECRETS.md`).
2. Then remove it from the branch. Rewrite the branch's commits (`git rebase -i`, then force-push the PR branch) so the value isn't in its history.
3. If it's a false positive (test fixture, public identifier), add its fingerprint to `.gitleaksignore` with a comment explaining why. The fingerprint is printed in the job log as `commit:file:rule:line`.

**Dependency review:** use a version without the advisory (usually the next patch), or pick another package. If the vulnerable code can't be reached, say why in the PR; don't merge around the check silently.

**Container scan (critical with a fix):** usually fixed by rebuilding on an updated base image. Merge the Dependabot docker PR, or bump the `FROM` tag. For an npm package inside the image, update it as for npm audit.

**npm audit:** `npm audit` in that app lists what to update. For a vulnerable package nested under a dependency you can't upgrade, pin a patched version in the app's `package.json` `overrides` (the backend already does this for Prisma's nested packages). Check the lockfile diff only touches that package.

## Known exceptions (review these when upgrading Expo)

- **Mobile npm audit is gated at critical, not high.** As of 2026-09-29, the one high finding is `image-size` (denial of service on crafted images). It's used only by the Metro bundler on the build machine to read the app's own image files, and it isn't in the shipped app. The patched version is a major release Metro doesn't support. The 15 moderate findings are all in Expo's build tooling, and npm's only offered "fix" is downgrading Expo to version 46. New high or critical packages are still blocked by dependency review. **After the next Expo SDK upgrade:** run `npm audit --omit=dev` in `mobile/`, and switch the CI gate back to `--audit-level=high` if the high is gone.
- **Backend image: 56 high findings in Debian (bookworm) packages** such as `util-linux`, `perl-base` and `ncurses`, none with a released fix as of 2026-09-29. They show in the Security tab and don't fail the build. When Debian ships fixes, the weekly scan shows them as fixable: rebuild (Render does on each deploy), or merge Dependabot's base-image PR. The runtime image has no npm, npx or corepack (the npm CLI's own dependencies were the fixable findings), and CI starts the image with its real entrypoint to prove it still works.
- **Admin web image:** 0 high or critical findings on `nginx:1.30-alpine` (2026-09-29).
- **`.gitleaksignore`** lists every reviewed historical finding and why. Only one of them was a real credential: the Resend API key committed in June 2026, which must be revoked (see `docs/SECRETS.md`).

## Repository settings (owner only)

These aren't in code. Check them after any repository transfer:

- **Branch protection on `main`:** require these checks to pass before merging:
  - from CI: `backend`, `mobile`, `web`, `docker`
  - from Security: `secrets`, `dependency-review`, `images (backend, …)`, `images (web, …)`
  - GitHub's code-scanning checks: `CodeQL`, `Trivy`
  
  Also block force-pushes and deletion. No required approvals, since this is a one-person project.
- **Dependabot security updates:** on, so GitHub opens a fix PR as soon as an advisory affects a dependency, instead of waiting for the weekly run.
- **Private vulnerability reporting:** on, so a researcher can report privately (Security → Advisories).
- **Secret scanning and push protection:** on (verified 2026-09-29).
