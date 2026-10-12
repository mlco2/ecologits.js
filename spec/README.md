# EcoLogits specification and data

The language-neutral contract for an EcoLogits implementation, together with the data it is
defined against.

This directory is the seed of a standalone repository — `mlco2/ecologits-spec` — that
[`mlco2/ecologits`](https://github.com/mlco2/ecologits) (Python) and
[`mlco2/ecologits.js`](https://github.com/mlco2/ecologits.js) (TypeScript) both consume, so
the contract and the data are maintained in one place instead of once per implementation.

## Layout

| Path                          | Contents                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| `SPEC.md`                     | the contract (§1–§10)                                                |
| `CONFORMANCE.md`              | what conformance means and how to run it                             |
| `VERSION`                     | authoritative spec version; `manifest.json` restates it              |
| `manifest.json`               | spec version, reference implementation and vector index              |
| `schema/`                     | JSON Schemas for the data model and the manifest                     |
| `vectors/`                    | contract vectors: expected outputs from the reference implementation |
| `data/`                       | model registry, electricity mixes and `source.json` provenance       |
| `scripts/generate-vectors.py` | regenerates `vectors/` and `manifest.json` from the Python reference |

## How a consumer uses it

`ecologits.js` mounts this directory as a git submodule at `spec/` and reads:

- `spec/data/*.json` — compiled into `packages/ecologits.js/src/data/*.generated.ts` by
  `npm run sync-data`, and verified by `npm run check-data`;
- `spec/schema/*` and `spec/manifest.json` — validated by `npm run check-spec`;
- `spec/vectors/*` — replayed by the test suite.

## Promoting this folder to its own repository

Until the remote exists this is an ordinary directory. To publish it and switch to a submodule:

```sh
cd spec
git init && git add -A && git commit -m "feat: initial spec and data"
git branch -M main
git remote add origin https://github.com/mlco2/ecologits-spec.git
git push -u origin main
cd ..

git rm -r --cached spec      # stop tracking the files directly
mv spec spec.tmp             # move the local copy aside (it carries its own .git)
git submodule add https://github.com/mlco2/ecologits-spec.git spec
rm -rf spec.tmp
```

Once it is a submodule, CI must check it out: `actions/checkout@v6` with `submodules: true`,
or `git submodule update --init --recursive`.

## Not yet here

`scripts/generate-vectors.py` also writes the consumer-only implementation vectors
(`packages/ecologits.js/test/vectors/`) when it can see the consumer checkout. Those are
deliberately outside the contract (see `SPEC.md` §9), so that half should move to a
consumer-side script once this is its own repository.
