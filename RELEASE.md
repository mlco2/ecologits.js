# Release docs

## npm release

This publishes only `@ecologits/ecologits.js` under `latest`, not the OpenAI or Mistral adapters. GitHub's `npm` environment and npm trusted publishing must already be configured.

1. Update the version in `packages/ecologits.js/package.json` to an unused stable version (e.g. `3.0.0`).
2. If dependencies changed, update and commit `yarn.lock`:
   ```sh
   npx --yes --package=yarn@1.22.19 yarn install --ignore-scripts --non-interactive
   ```
3. From the repository root, install, build, and pack:
   ```sh
   npx --yes --package=yarn@1.22.19 yarn install --frozen-lockfile --ignore-scripts --non-interactive
   npm run build --workspace=@ecologits/ecologits.js
   npm pack --workspace=@ecologits/ecologits.js
   ```
   Smoke-test the tarball in a separate project before releasing.
4. Commit and merge the changes into `main`. Wait for CI to pass on the release commit.
5. Go to [GitHub Releases](https://github.com/mlco2/ecologits.js/releases/new). Create a tag named `ecologits-v<VERSION>` (e.g. `ecologits-v3.0.0`) targeting that tested commit. The tag version must match the package version.
6. Click **Generate release notes** and review the changelog. Leave **Set as a pre-release** unchecked; this workflow supports stable releases only.
7. Click **Publish release**. This triggers npm publication; pushing a tag or saving a draft alone does not.
8. Check [GitHub Actions](https://github.com/mlco2/ecologits.js/actions) for **Publish core to npm**. Approve the `npm` deployment if requested and confirm the workflow succeeds.
9. Verify `latest` points to the new version and smoke-test it from npm:
   ```sh
   npm view @ecologits/ecologits.js dist-tags
   ```

Published npm versions cannot be overwritten. Before retrying a failed release, check whether the version already exists on npm. Do not move published release tags.
