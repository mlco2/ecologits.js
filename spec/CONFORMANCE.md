# Conformance

A conforming implementation reproduces the vectors that make up the [spec](./SPEC.md) within
the tolerance of §7. This repository contains the reference vector set and one conforming
implementation (the TypeScript package).

## What conformance means

An implementation conforms to this spec, at a given `specVersion`, when:

1. It reproduces every case in the contract vectors (see `manifest.json`) within tolerance.
2. Its bundled data files validate against `schema/models.schema.json` and
   `schema/electricity_mixes.schema.json`.
3. It does not change the §4–§6 outputs to accommodate an extension.

Conformance is defined on the observable output only. How an implementation is structured, the
names of its APIs, its error types and its internal arithmetic are outside the contract.

## Running it

In this repository:

```bash
npm test          # replays every contract vector plus the implementation vectors
npm run check-spec # validates the data and the manifest against spec/schema
```

The TypeScript suite loads the contract vectors from `spec/vectors/` and the
implementation-only vectors from `packages/ecologits.js/test/vectors/`. `npm run check-spec`
validates structure and provenance; `npm test` validates values.

## Vector format

Every vector file is a JSON object with a `kind` field matching its entry in
[`manifest.json`](./manifest.json). The remaining fields are the payload: `cases` for the
`estimator` and `high-level` kinds, and kind-specific arrays for the others. Cases that the
reference implementation rejects carry `pythonError` and no `expected`, so the failure itself
is part of the contract.

`manifest.json` is the index:

```json
{
    "specVersion": "0.2.0",
    "reference": {
        "implementation": "ecologits",
        "version": "0.11.2",
        "commit": "…",
        "pythonVersion": "…"
    },
    "vectors": [{ "kind": "estimator", "path": "vectors/estimator.json", "contract": "output" }]
}
```

## Regenerating the vectors

Vectors are generated from the reference implementation, which is why they are trustworthy:
the expected values are produced by the real package, not written by hand.

```bash
python spec/scripts/generate-vectors.py                 # writes spec/ + test vectors in place
python spec/scripts/generate-vectors.py --python-dir PATH
```

The generator imports the Python package from a sibling checkout (`$ECOLOGITS_PY_DIR` by
default). Regeneration is expected to be a no-op while that checkout sits at the commit
recorded in `manifest.reference.commit`; a diff means either the checkout moved or the spec
changed, and either way it is a review event.

CI does **not** regenerate the vectors — it has no access to the Python repository. It
validates the committed vectors instead. Making regeneration a CI job (in a container, with a
Python checkout) is the next step toward two-way conformance: ideally the Python
implementation runs these same vectors in its own pipeline, which would make both
implementations peers of the spec rather than one following the other.

## Adding a vector

1. Add the case to the relevant `build_*` function in `spec/scripts/generate-vectors.py`.
2. Regenerate and commit both the generator change and the vector diff.
3. If the change alters what an implementation must do, bump `VERSION` per §2 and say so in
   the changelog.
