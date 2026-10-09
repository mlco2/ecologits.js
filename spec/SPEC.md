# EcoLogits estimator specification

This document is the language-neutral contract for an EcoLogits implementation. It describes
what an implementation must reproduce, not how it is built. The reference implementation is
the Python package [`mlco2/ecologits`](https://github.com/mlco2/ecologits); the TypeScript
implementation in this repository is validated against it through the vectors in
[`vectors/`](./vectors).

The key words **MUST**, **MUST NOT** and **MAY** are used as in RFC 2119.

- Spec version: [`VERSION`](./VERSION), restated in [`manifest.json`](./manifest.json)
- Conformance: [`CONFORMANCE.md`](./CONFORMANCE.md)
- Machine-readable schemas: [`schema/`](./schema)

## 1. Scope

A conforming implementation MUST reproduce, for the inputs covered by the vectors:

- the impact estimates of the estimator (§4);
- the high-level model-name lookup, including the zone fallback ladder, the provider
  datacenter assumptions and warning/error propagation (§5);
- the status-message codes and rendered strings (§6);
- the data-file semantics of §3.

Out of scope, and deliberately non-normative: the shape of the public API, class and module
names, error types, and the internal arithmetic used to reach a result. §9 records the
internal behaviours that are pinned for the port but are not part of this contract.

## 2. Versioning

[`VERSION`](./VERSION) is authoritative; `manifest.json` restates it for consumers.

- **MAJOR** — a change that can alter a conforming implementation's output, or that removes or
  renames a vector.
- **MINOR** — additive vectors, or new optional contract surface.
- **PATCH** — clarifications and documentation only.

`manifest.reference` records the implementation, version and commit the vectors were generated
from. The spec version is independent of the `ecologits` package version.

## 3. Data model

### 3.1 Model registry

Schema: [`schema/models.schema.json`](./schema/models.schema.json).

Each model entry carries a provider (from the enumerated set), a name unique within that
provider, an architecture, a list of warning codes, provenance sources and an optional
deployment block.

The architecture is either `dense` with a single parameter count, or `moe` with `total` and
`active` counts. A parameter count is a number or an explicit `{ min, max }` interval.

The deployment block carries `tps` (tokens per second) and `ttft` (time to first token, in
seconds); either may be `null`.

An alias entry names an already-registered model of the same provider and registers a second
key for it. If the alias's target name is already registered, the alias replaces that entry.

### 3.2 Electricity mixes

Schema: [`schema/electricity_mixes.schema.json`](./schema/electricity_mixes.schema.json).

A mix is keyed by an ISO 3166-1 alpha-3 zone code and carries four impact factors per kWh of
electricity consumed plus a list of warning codes:

| Field  | Unit        | Meaning                                  |
| ------ | ----------- | ---------------------------------------- |
| `adpe` | kgSbeq/kWh  | Abiotic Depletion Potential for elements |
| `pe`   | MJ/kWh      | Primary Energy                           |
| `gwp`  | kgCO2eq/kWh | Global Warming Potential                 |
| `wue`  | L/kWh       | Water Usage Effectiveness                |

## 4. Estimator contract

Given model active and total parameter counts, an output token count, the electricity-mix
factors, datacenter PUE/WUE and an optional measured latency, an implementation MUST produce
five impact criteria each split into a `usage` and an `embodied` phase:

| Impact   | Unit    | Total is         |
| -------- | ------- | ---------------- |
| `energy` | kWh     | usage only       |
| `gwp`    | kgCO2eq | usage + embodied |
| `adpe`   | kgSbeq  | usage + embodied |
| `pe`     | MJ      | usage + embodied |
| `wcf`    | L       | usage only       |

Rules:

- A missing measured latency is treated as `+Infinity`, so the modelled latency wins.
- A published `tps` supersedes the latency regression; `ttft` is added to the modelled
  generation time.
- When either parameter count is an interval, the estimator MUST evaluate the graph twice —
  at the lower bound of both counts and at the upper — and collapse each result to
  `RangeValue(firstPass.min, secondPass.max)`.
- Degenerate inputs MUST raise rather than return a number Python never produces: `tps = 0`
  (upstream `ZeroDivisionError`) and a zero parameter count (upstream `ValueError` from
  `log2(0)`).

## 5. High-level contract

Given a provider, a model name, an output token count and a measured latency, an
implementation MUST:

1. Resolve the model within the provider. An unknown model is an **error result**, not an
   exception.
2. Resolve the electricity mix: the caller's explicit zone, else the provider's datacenter
   location, else `WOR`. An unknown zone is an **error result**.
3. Run the estimator of §4 with the provider's datacenter assumptions.
4. Attach the model's and the mix's warnings, **deduplicated by code**. Errors are **not**
   deduplicated.

Provider datacenter assumptions (normative):

| Provider          | Location | PUE         | WUE          |
| ----------------- | -------- | ----------- | ------------ |
| `anthropic`       | `USA`    | 1.09 – 1.14 | 0.13 – 0.999 |
| `cohere`          | `USA`    | 1.09        | 0.999        |
| `google_genai`    | `USA`    | 1.09        | 0.999        |
| `huggingface_hub` | `USA`    | 1.09 – 1.14 | 0.13 – 0.99  |
| `mistralai`       | `SWE`    | 1.16        | 0.09         |
| `openai`          | `USA`    | 1.20        | 0.569        |

## 6. Status messages

Warning codes (non-exhaustive rendering; the vectors carry the exact strings):

`model-arch-not-released`, `model-arch-multimodal`, `electricity-mix-adpe-world`,
`electricity-mix-pe-world`, `electricity-mix-wue-world`.

Error codes: `model-not-registered`, `zone-not-registered`.

A rendered message is `"{message} For further information visit {url}"`, where `{url}` is the
code-specific documentation URL.

## 7. Numeric conformance

Numbers are IEEE-754 binary64 — Python `float` and JavaScript `number` agree. A vector passes
when every number matches within a relative tolerance of `1e-12`, and every non-numeric value
(structure, key set, string, boolean, `null`, `NaN`, `±Infinity`) matches exactly.

## 8. Extensions

An implementation MAY add APIs beyond this contract (for example an override for intermediate
DAG results). Omitting the extension MUST reproduce the contract exactly. Extensions MUST NOT
change the output of the operations in §4–§6.

## 9. Non-normative internals

The following are pinned for the TypeScript port by vectors under
`packages/ecologits.js/test/vectors/`, but are **not** part of this contract: `RangeValue`
arithmetic and its asymmetric comparison rules, the `@total_ordering` derivation of `<`/`>`,
and float formatting. A conforming implementation is free to differ here as long as §4–§6
hold.

## 10. Vectors

| Kind              | File                           | Covers                                                    |
| ----------------- | ------------------------------ | --------------------------------------------------------- |
| `estimator`       | `vectors/estimator.json`       | §4, every model and electricity mix, ranges, `tps`/`ttft` |
| `high-level`      | `vectors/high-level.json`      | §5, the zone ladder, warnings and both failure modes      |
| `repository`      | `vectors/repository.json`      | §3, lookup and alias resolution, in upstream order        |
| `status-messages` | `vectors/status-messages.json` | §6, every code and rendered string                        |
