---
name: Release
description: Release Bookdrop end to end. Use when the user asks to release, publish, or ship a version. Bumps the version, checks the build, drafts release notes, and after one approval commits, pushes, and publishes the GitHub release.
---

# Release Bookdrop

The user builds the Windows installers. Everything else is yours. Keep the user informed at each step, but do not ask them to run commands you can run.

## Before starting

1. Confirm the target version `X.Y.Z`. If the user did not give one, propose one using semver (feature: minor, fix: patch) and wait for a yes.
2. Run `git status`. Stop and tell the user if there are uncommitted changes that are not part of this release.
3. Run `git log --oneline` and find the last release tag with `git tag --sort=-v:refname | head -1`.

## Steps

1. **Bump.** If `package.json` is not already at `X.Y.Z`, run `bun run bump X.Y.Z`. It updates `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.
2. **Check.** Run `bun run lint`, `bun run test`, and `bun run build`. Fix any failures before asking for the Windows build. Do not change unrelated files to make them pass; report them instead.
3. **Ask for the build.** Tell the user to run `bun run tauri build` on Windows and say when it is done. Wait for their reply.
4. **Verify the build.** These files must exist in `src-tauri/target/release/bundle/` with version `X.Y.Z`:
   - `nsis/Bookdrop_X.Y.Z_x64-setup.exe` and its `.sig`
   - `msi/Bookdrop_X.Y.Z_x64_en-US.msi` and its `.sig`

   If any are missing, stop and ask the user to rebuild.
5. **Generate artifacts.** Run `bun run checksums`, then `bun run latest-json "<one-line notes>"`.
6. **Draft notes.** Run `git log <last-tag>..HEAD --format=%s` (or the full log if there is no tag). Drop version-bump and internal-only commits. Write notes for end users in plain language: short bullets, what changed for the user, no commit hashes or internal names.
7. **Checkpoint.** Show the user, in one message:
   - the version
   - the commits that will be included
   - the draft notes
   - the asset list

   Then wait. The user may approve or edit the notes. Do not continue without an explicit go-ahead. Approval covers the commit, push, and publish in the following steps.
8. **Commit.** Stage only the release files (the four version files, plus any changes the user approved). Use the repo convention, e.g. `Bump version to X.Y.Z`. Do not commit `SHA256SUMS.txt` or `latest.json`; they are git-ignored.
9. **Push.** Run `git push origin HEAD`.
10. **Publish.** Write the approved notes to `/tmp/opencode/release-notes.md`, then run:

    ```sh
    gh release create vX.Y.Z --target main --title "Bookdrop X.Y.Z" --notes-file /tmp/opencode/release-notes.md <assets>
    ```

    The assets are the two installers with their `.sig` files, `latest.json`, and `SHA256SUMS.txt`, all with paths under `src-tauri/target/release/bundle/` or the repo root.
11. **Verify.** Run `gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,assets`. Confirm every asset is attached and the release is not a draft. Give the user the release URL.

## Rules

- Never publish, push, or commit without the approval in step 7.
- Never use `--force` or delete a tag or release without explicit instruction.
- If a step fails after the push, stop and report. Do not retry blindly.
- Do not add a CI workflow or change the signing setup as part of a release.
