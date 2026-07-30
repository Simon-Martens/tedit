# Deploying a Release

This document describes the complete release process for tedit. The current
GitHub Actions workflow publishes every tagged version as a GitHub prerelease.

## Release Outputs

The release workflow produces:

- Linux x64 AppImage
- Windows x64 NSIS installer
- macOS x64 DMG
- macOS arm64 DMG
- `SHA256SUMS.txt` covering all installers

The installers include:

- the renderer and Electron main process
- offline web and print documentation for Typst `0.15.0`

Tinymist is not bundled. On first use, tedit uses a compatible local binary or
downloads Tinymist `0.15.2` into the user's versioned application-data cache.

The macOS and Windows installers are currently unsigned. Users may therefore
see operating-system security warnings. The workflow explicitly disables
automatic macOS signing with `CSC_IDENTITY_AUTO_DISCOVERY=false`.

## Versioning

tedit uses semantic prerelease versions. Examples:

- `0.1.0-alpha.3`
- `0.1.0-beta.1`
- `0.1.0-rc.1`

The Git tag is the package version prefixed with `v`, for example:

```text
package version: 0.1.0-beta.1
Git tag:         v0.1.0-beta.1
```

Never reuse or move a published release tag. If a release contains a problem,
fix it and publish the next prerelease version.

## Version Alignment

Three upstream versions must remain aligned:

1. `TINYMIST_VERSION` in `electron/tinymist-release.cjs` selects the downloaded
   Tinymist release.
2. `TINYMIST_TYPST_VERSION` in the same file records the Typst version embedded
   in that Tinymist release.
3. The target hashes in the same file pin each supported release archive.
4. `TYPST_DOCS_REF` in `.github/workflows/release.yml` selects the documentation
   source and must be `v${TINYMIST_TYPST_VERSION}`.

Do not update one of these values independently. Verify every configured asset
and pinned checksum:

```sh
npm run verify-tinymist-release
```

The documentation packaging script rejects a Typst checkout whose workspace
version differs from `TINYMIST_TYPST_VERSION`.

## Prerequisites

Install and configure:

- Git
- Node.js 24
- npm
- GitHub CLI (`gh`)
- Rust stable and Cargo when building documentation locally
- push access to `Simon-Martens/tedit`
- permission to create tags and GitHub releases

Verify authentication and remotes:

```sh
gh auth status
git remote -v
```

The GitHub token used by `gh` needs the `repo` and `workflow` scopes.

## 1. Prepare the Branch

Start from `main` and synchronize it before making the release commit:

```sh
git switch main
git pull --ff-only origin main
git status --short --branch
git log --oneline --decorate -10
```

Review every pending change. A release must not accidentally include secrets,
temporary files, local installers, or generated resources.

```sh
git diff
git diff --check
```

The following directories are generated and ignored:

- `dist/`
- `release/`
- `resources/typst-docs/`

They must not be committed.

## 2. Select and Set the Version

Check existing tags and releases before selecting the next version:

```sh
git tag --sort=-version:refname
gh release list --limit 10
```

Update both `package.json` and `package-lock.json` without creating a tag:

```sh
npm version 0.1.0-beta.1 --no-git-tag-version
```

Replace the example version with the intended release. Verify both files:

```sh
node -p "require('./package.json').version"
node -p "require('./package-lock.json').version"
git diff -- package.json package-lock.json
```

The release workflow rejects a tag that does not exactly equal `v` plus the
version in `package.json`.

## 3. Install and Validate Dependencies

Use the lockfile exactly as CI will:

```sh
npm ci
```

Review security reports rather than automatically applying breaking upgrades:

```sh
npm audit
```

An audit warning does not automatically block a prerelease, but known runtime
vulnerabilities should be investigated before publication.

### Regenerate application icons

When `tedit.svg` changes, regenerate all derived application assets before
building or releasing:

```sh
npm run generate-icons
```

This requires Inkscape and ImageMagick's `magick` command. It converts live SVG
text to paths and writes `build/icon.svg`, `build/icon.png`, and
`build/icon.ico`. Commit the master SVG and all three generated assets together.

## 4. Run Application Checks

Run the production renderer build and source hygiene checks:

```sh
npm run build
git diff --check
node --check electron/main.cjs
node --check electron/preload.cjs
node --check electron/tinymist-lsp-service.cjs
node --check scripts/package-docs.mjs
node --check scripts/verify-tinymist-release.mjs
```

Start the application and perform a manual smoke test:

```sh
npm run dev
```

At minimum, verify:

- a saved document opens, edits, saves, and restores after restart
- an unsaved document compiles
- Tinymist diagnostics appear and clear correctly
- a multi-page document renders and updates
- source-position markers and auto-scroll work beyond page one
- PDF text is selectable and copyable
- zoom, rotation, download, and print still work
- offline web documentation opens, navigates, searches, and restores its position
- offline print documentation opens in PDF.js and switches back to the web version
- dark/light themes and editor settings persist
- tabs activate, close, reorder, and report unsaved state correctly
- compilation failures show only the useful inner diagnostic

## 5. Validate Runtime Tinymist

Verify that all supported GitHub release assets exist and their published
checksums still match the hashes pinned in `electron/tinymist-release.cjs`:

```sh
npm run verify-tinymist-release
```

Launch once with a fresh user-data directory and no compatible Tinymist on
`PATH`. Confirm that the footer reports download, verification, extraction, and
startup progress; compilation succeeds afterward; and restarting uses the
cached binary. Also confirm that an incompatible PATH binary is ignored. No
Tinymist executable may be present in the packaged application resources.

## 6. Validate Offline Documentation

Local documentation generation is optional when disk space or build time is
limited, but it is strongly recommended after changing documentation packaging,
Typst, Tinymist, or the release workflow.

Use a Typst checkout matching `TINYMIST_TYPST_VERSION`:

```sh
git clone --depth 1 --branch v0.15.0 \
  https://github.com/typst/typst.git /tmp/typst-v0.15.0
npm run package-docs -- /tmp/typst-v0.15.0
```

The first build can take several minutes and multiple gigabytes of disk space.
Inspect the staged manifest afterward:

```sh
node -p "require('./resources/typst-docs/manifest.json')"
```

Confirm that `typstVersion` matches the version embedded in Tinymist. The
generated site must contain `site/index.html`, `site/assets/search.json`,
`site/print/docs.pdf`, and the Typst license files.

## 7. Build a Local Installer

When matching documentation resources are already staged, build a host-platform
installer:

```sh
npm run build
npx electron-builder --linux AppImage --x64 --publish never
```

Use the platform command appropriate for the host. `npm run dist` performs the
documentation build, renderer build, and Electron Builder step together, but
its default documentation checkout is `../typst` and must have the required
Typst version.

Inspect the installer under `release/` and, where possible, launch it once.

## 8. Review the Release Diff

Before committing, inspect the final state:

```sh
git status --short --branch
git diff --stat
git diff
git diff --check
git log --oneline -10
```

Confirm that:

- the package and lockfile versions match
- upstream Tinymist, pinned hashes, Typst, and docs versions match
- the release workflow still targets all four supported installers
- no installer contains a Tinymist executable
- no generated resources or credentials are staged
- all intended fixes and documentation are included

## 9. Commit the Release

Stage only the intended files. If the complete worktree is the intended
release, use:

```sh
git add -A
git commit -m "Prepare v0.1.0-beta.1 release"
```

Inspect the resulting commit and ensure the worktree is clean:

```sh
git show --stat --oneline HEAD
git diff HEAD^ HEAD --check
git status --short --branch
```

Do not amend or bypass hooks when a release commit fails. Correct the problem
and create a new commit.

## 10. Create and Push the Tag

Create an annotated tag on the release commit:

```sh
git tag -a v0.1.0-beta.1 -m "tedit v0.1.0-beta.1"
```

Push the branch and tag atomically so the workflow cannot see a tag whose
release commit is missing from `main`:

```sh
git push --atomic origin main v0.1.0-beta.1
```

Pushing any `v*` tag triggers `.github/workflows/release.yml`.

## 11. Monitor the Workflow

Find the triggered run:

```sh
gh run list --workflow Release --limit 5
```

Watch it through publication:

```sh
gh run watch RUN_ID --exit-status
```

The expected job order is:

1. Build Typst documentation once on Linux.
2. Build Linux x64, Windows x64, macOS x64, and macOS arm64 in parallel.
3. Download only `installer-*` artifacts.
4. Generate `SHA256SUMS.txt`.
5. Publish a GitHub prerelease with generated release notes.

Do not consider the release complete merely because the tag was pushed. Wait
for all jobs and the publication job to succeed.

## 12. Verify the Published Release

Inspect release metadata and uploaded assets:

```sh
gh release view v0.1.0-beta.1
gh release view v0.1.0-beta.1 --json url,isPrerelease,assets
```

Expected assets:

```text
tedit-0.1.0-beta.1-linux-x86_64.AppImage
tedit-0.1.0-beta.1-win-x64.exe
tedit-0.1.0-beta.1-mac-x64.dmg
tedit-0.1.0-beta.1-mac-arm64.dmg
SHA256SUMS.txt
```

Download and verify the published checksums:

```sh
mkdir -p /tmp/tedit-release/release-artifacts
gh release download v0.1.0-beta.1 \
  --dir /tmp/tedit-release/release-artifacts
(cd /tmp/tedit-release && \
  sha256sum -c release-artifacts/SHA256SUMS.txt)
```

Finally verify repository synchronization:

```sh
git status --short --branch
git log --oneline --decorate -3
git ls-remote --tags origin 'v0.1.0-beta.1*'
```

## Manual Workflow Rerun

The workflow can rebuild an existing tag through GitHub Actions:

```sh
gh workflow run Release --ref main -f tag=v0.1.0-beta.1
```

Use this only when the tagged application source is correct and the failure was
external or confined to workflow infrastructure. The workflow checks out the
specified tag for application builds.

## Failure Recovery

### Failure before publication

Inspect failed logs:

```sh
gh run view RUN_ID --log-failed
```

If the failure was transient, rerun failed jobs from GitHub. If only the
workflow implementation was defective, fix the workflow on `main` and manually
run it for the existing tag.

If application source, package metadata, staged assets, or version alignment
was wrong, do not move the remote tag. Fix the problem, increment the
prerelease version, and publish a new tag.

### Failure after publication

Do not replace release binaries under an existing version. Mark the release as
superseded if necessary, fix the issue, and publish the next prerelease.

### Missing or incorrect asset

Treat an incorrect installer as a new release, not as an in-place replacement.
Checksums and generated release notes are tied to the immutable release tag.

## Stable Releases

The current workflow always sets `prerelease: true`. Publishing a stable
release requires a deliberate workflow change and review in addition to using a
stable semantic version. Do not publish a stable tag while the workflow still
unconditionally marks releases as prereleases.
