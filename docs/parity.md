# Parity with the Python package

This document maps the TypeScript port against [`mlco2/ecologits`](https://github.com/mlco2/ecologits)
and records what is ported, what is deliberately not, and where the two knowingly diverge.
The language-neutral contract — what any implementation must reproduce — lives in
[`spec/`](../spec); this document is the port-specific companion to it.

Reference version: **`ecologits` 0.11.2**, commit `c739e8d61f6a12a85864adb698ab85623fe70f3c`,
recorded in [`spec/manifest.json`](../spec/manifest.json).

## Module mapping

| Python                                    | TypeScript                          | Notes                                                                                            |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ecologits/utils/range_value.py`          | `src/utils/range_value.ts`          | `RangeValue` class; operators move to `arithmetic.ts`                                            |
| —                                         | `src/utils/arithmetic.ts`           | No Python counterpart: `add`/`mul`/`div`/`lte`/`lt`/`gte`/`gt`/`eq` replace operator overloading |
| `ecologits/status_messages.py`            | `src/status_messages.ts`            | Codes and messages identical                                                                     |
| `ecologits/exceptions.py`                 | `src/exceptions.ts`                 | Plus `EcoLogitsValueError`, standing in for the builtin `ValueError`                             |
| `ecologits/log.py`                        | `src/log.ts`                        | `*_once` dedupe preserved; level filtering differs, see below                                    |
| `ecologits/model_repository.py`           | `src/model_repository.ts`           | `Providers`/`ArchitectureTypes` enums become string unions                                       |
| `ecologits/electricity_mix_repository.py` | `src/electricity_mix_repository.ts` | —                                                                                                |
| `ecologits/data/*.json`                   | `src/data/*.generated.ts`           | Maintained in [`spec/data`](../spec/data) and compiled                                           |
| `ecologits/impacts/modeling.py`           | `src/impacts/modeling.ts`           | `@total_ordering` reproduced explicitly, see below                                               |
| `ecologits/impacts/dag.py`                | `src/impacts/dag.ts`                | Dependencies declared per asset instead of read from `__annotations__`                           |
| `ecologits/impacts/llm.py`                | `src/impacts/llm.ts`                | All 17 assets, constants and formulas verbatim                                                   |
| `ecologits/tracers/utils.py`              | `src/tracers/utils.ts`              | `ImpactsOutput`, `PROVIDER_CONFIG_MAP` and `llm_impacts`; takes an options object                |

## Not ported

| Python                                                                                           | Reason                                                            |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `ecologits/tracers/*` (openai, mistralai, anthropic, cohere, google_genai, huggingface, litellm) | Adapters are rebuilt separately on top of this core               |
| `ecologits/_ecologits.py` (`EcoLogits.init`, `config`, `label`)                                  | Instrumentation lifecycle; meaningless without adapters           |
| `ecologits/impacts/video.py`, `ecologits/estimations/video.py`, `data/video_models.json`         | Video generation, a separate methodology added upstream in 0.11.0 |
| `ecologits/utils/opentelemetry.py`                                                               | OTLP metrics export                                               |

## Known divergences

These are deliberate. Each is covered by a test so it cannot regress silently.

### 1. Degenerate inputs raise instead of silently producing a value

Upstream leaves two computations unguarded, so JavaScript would otherwise return a number
Python never produces:

- `latency_per_token = 1 / tps`: a zero tokens-per-second figure raises `ZeroDivisionError`
  in Python, while `1 / 0` is `Infinity` in JavaScript. That would yield an infinite latency
  and then quietly fall back to the measured latency. The port raises `ModelingError`.
- `2 ** ceil(log2(gpu_count))` when the count is not a positive, finite number: Python's
  `math.log2` raises `ValueError` for a zero or negative count and `math.ceil` raises
  `OverflowError` for an infinite one, while `Math.log2` yields `-Infinity` or `NaN` and the
  expression evaluates to `0`, `NaN` or `Infinity`. The port raises `EcoLogitsValueError`.

Until 0.11.1 one model in the shipped data hit the first of these for real
(`google_genai/gemini-2.5-flash-image` carried `tps: 0`); 0.11.2 corrected it to `null`. The
guard is kept, and the `tps-zero` case in `spec/vectors/estimator.json` pins it explicitly by
passing `tps = 0` directly, so the behaviour is covered rather than left to the data. The
second is pinned the same way by the `zero-parameters` and `negative-parameters` cases.

### 2. Division by zero raises, and dividing a range by a range is refused

`RangeValue.__truediv__` raises `ZeroDivisionError` when the divisor is zero. JavaScript would
return `Infinity`. `div` in `arithmetic.ts` raises `RangeError` to match.

Dividing one `RangeValue` by another is also undefined upstream: Python builds a `RangeValue`
whose bounds are themselves `RangeValue`s, which Pydantic rejects with a `ValidationError` (a
`ValueError`). `div` raises `EcoLogitsValueError`, the port's `ValueError` stand-in, rather
than inventing a value. Note that the reflected case `x / rv` (a plain number on the left)
_does_ work upstream, as `rv.__rtruediv__(x)`, and the port reproduces it.

### 3. `sources` is populated

`Model.from_json` tests `if "source" in data` but then reads `data["sources"]`. The singular
key never exists in the data files, so upstream always leaves `sources` empty. The port reads
`sources` as clearly intended. The field is provenance metadata only — it does not feed any
computation — so no estimate changes.

### 4. `total_ordering` is reproduced literally

Python defines `__eq__`, `__le__` and `__ge__` on `BaseImpact` and applies `@total_ordering`.
`total_ordering` picks its root with a plain string `max`, so `"__le__"` wins over `"__ge__"`,
and the derived operators are:

- `a < b` → `(a <= b) and (a != b)`
- `a > b` → `not (a <= b)`

Both are implemented as-is. Note `a < b` and `a >= b` are not complements, which is surprising
but is what upstream ships. Verified against Python in `test/modeling.test.ts`.

### 5. Comparisons on `RangeValue` are asymmetric

Which bound is consulted depends on the operator _and_ on which side the range sits, because
Python falls back to reflected methods when the left operand is a plain number. `arithmetic.ts`
documents the full table. All 49 ordered pairs of the value matrix are checked against Python
in `test/range-value.test.ts`.

### 6. Logging levels

Python delegates to the `logging` module, whose default level is WARNING, so `debug`/`info` go
nowhere unless the host application configures logging. JavaScript has no equivalent global
configuration, so `debug` and `info` are silent by default here too. Call
`logger.setSink(...)` to capture output.

### 7. Float rendering in `RangeValue.toString()`

Python distinguishes `int` from `float` when formatting, so `RangeValue(1, 2)` renders as
`1.5 [1 - 2]` while `RangeValue(1.0, 2.0)` renders as `1.5 [1.0 - 2.0]`. JavaScript has a
single numeric type, so the port always uses the float form.

Everything else about the rendering is reproduced exactly: the shortest round-tripping
digits, the switch to exponent notation below `1e-4` and at or above `1e16`, the two-digit
exponent padding (`1e-07`) and the trailing `.0` on integral floats. `test/range-value.test.ts`
pins the thresholds through `packages/ecologits.js/test/vectors/range-value.json`, which the
Python implementation generated.

### 8. `assets` is an extension beyond the Python API

`ComputeLlmImpactsDagParams.assets` lets a caller inject or override any DAG input by name,
and is merged last so it wins over the named parameters. Upstream accepts `**kwargs` on
`compute_llm_impacts` but forwards them to `compute_llm_impacts_dag`, which takes no
`**kwargs`, so any extra keyword raises `TypeError`. The port implements the evident intent of
that unusable parameter. Omitting `assets` behaves exactly as upstream does.

## Verifying parity

```bash
npm test                              # replays the contract and implementation vectors
npm run check-spec                    # validates the data and manifest against spec/schema
python spec/scripts/generate-vectors.py    # regenerates the vectors from the Python checkout
```

Contract vectors — the observable behaviour an implementation must reproduce — live in
[`spec/vectors`](../spec/vectors) and are indexed by
[`spec/manifest.json`](../spec/manifest.json):

| Kind              | File                                | Covers                                                                    |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `estimator`       | `spec/vectors/estimator.json`       | `computeLlmImpacts`: every model, every electricity mix, ranges, tps/ttft |
| `high-level`      | `spec/vectors/high-level.json`      | `llmImpacts`: every model, the zone ladder, warnings and failure modes    |
| `repository`      | `spec/vectors/repository.json`      | Models, electricity mixes and alias resolution, in upstream order         |
| `status-messages` | `spec/vectors/status-messages.json` | Every warning and error code, message and rendered string                 |

The port's internal semantics — `RangeValue` arithmetic and the full asymmetric comparison
matrix, plus impact addition and comparison including the `ModelingError` paths — are pinned
by implementation vectors under `packages/ecologits.js/test/vectors`. They are deliberately
not part of the spec: a conforming implementation may differ there.

Vectors are committed, and regeneration is a no-op only while the Python checkout is at the
commit recorded in `spec/manifest.json`. CI does not regenerate them — it has no access to the
Python repository — but it validates the committed vectors, checks the data and manifest
against the schemas, and asserts that the vector version matches the version spec/data
was built from, so the two cannot drift apart unnoticed.
