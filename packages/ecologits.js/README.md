# @ecologits/ecologits.js

Core estimator for the [EcoLogits](https://github.com/mlco2/ecologits) methodology, ported to
TypeScript. It turns a model name — or explicit impact factors — plus your measured request
latency and output-token count into energy consumption and environmental impacts.

The model and electricity-mix data is compiled into the package, so importing it performs **no
network or filesystem I/O** and works offline and in edge runtimes. This package contains no
provider instrumentation: you measure the latency and count the tokens yourself.

## Install

### `npm`

```
npm install @ecologits/ecologits.js
```

### `yarn`

```
yarn add @ecologits/ecologits.js
```

## Usage

`llmImpacts` is the high-level entry point: give it a provider, a model name and what you
measured, and it looks up the model and the electricity mix for you.

```ts
import { llmImpacts } from "@ecologits/ecologits.js";

const impacts = llmImpacts({
    provider: "openai",
    modelName: "gpt-4o-mini",
    outputTokenCount: 200,
    requestLatency: 1.5,
});

if (impacts.hasErrors) {
    throw new Error("could not estimate impacts");
}

console.log(impacts.energy?.value, impacts.energy?.unit); // e.g. 0.0004 kWh
console.log(impacts.gwp?.value, impacts.gwp?.unit); // e.g. 0.002 kgCO2eq
```

Pass `electricityMixZone` to override the default zone (an ISO 3166-1 alpha-3 code, e.g. `FRA`):

```ts
import { llmImpacts } from "@ecologits/ecologits.js";

const impacts = llmImpacts({
    provider: "openai",
    modelName: "gpt-4o-mini",
    outputTokenCount: 200,
    requestLatency: 1.5,
    electricityMixZone: "FRA",
});
```

When you already know every impact factor, use `computeLlmImpacts` directly:

```ts
import {
    computeLlmImpacts,
    electricityMixes,
    isParametersMoE,
    models,
} from "@ecologits/ecologits.js";

const model = models.findModel("openai", "gpt-4o-mini");
if (model === undefined) {
    throw new Error("model is not registered");
}

const mix = electricityMixes.findElectricityMix("FRA");
if (mix === undefined) {
    throw new Error("electricity mix is not registered");
}

const parameters = model.architecture.parameters;
const impacts = computeLlmImpacts({
    modelActiveParameterCount: isParametersMoE(parameters) ? parameters.active : parameters,
    modelTotalParameterCount: isParametersMoE(parameters) ? parameters.total : parameters,
    outputTokenCount: 200,
    requestLatency: 1.5,
    ifElectricityMixAdpe: mix.adpe,
    ifElectricityMixPe: mix.pe,
    ifElectricityMixGwp: mix.gwp,
    ifElectricityMixWue: mix.wue,
    datacenterPue: 1.2,
    datacenterWue: 0.569,
});
```

## What you get back

Five impact criteria, each split into a `usage` and an `embodied` phase:

| Field    | Unit    | Meaning                                                     |
| -------- | ------- | ----------------------------------------------------------- |
| `energy` | kWh     | Final energy "from the plug", including datacenter overhead |
| `gwp`    | kgCO2eq | Global Warming Potential (carbon emissions)                 |
| `adpe`   | kgSbeq  | Abiotic Depletion Potential for elements                    |
| `pe`     | MJ      | Primary Energy                                              |
| `wcf`    | L       | Water Consumption Footprint                                 |

`energy` and `wcf` are usage-only: they have no embodied term, and `impacts.wcf` is the same
object as `impacts.usage.wcf`. The other three are `usage + embodied`.

Every value is either a `number` or a `RangeValue` with `min` and `max`. Ranges are the normal
case, not an exception: a model whose parameter count is published as an interval produces
ranges, as does a provider whose PUE or WUE is published as one. `gpt-4o-mini` in the example
above is one such model.

```ts
import { isRangeValue } from "@ecologits/ecologits.js";

if (isRangeValue(impacts.gwp.value)) {
    console.log(`${impacts.gwp.value.min} - ${impacts.gwp.value.max} kgCO2eq`);
} else {
    console.log(`${impacts.gwp.value} kgCO2eq`);
}
```

`JSON.stringify` on any result produces the same shape the Python package's `model_dump()`
returns, so results are portable across the two.

## Data

`models` and `electricityMixes` are populated from the spec's data (`spec/data/`, the copy of
the Python package's JSON), compiled to TypeScript by `scripts/sync-data.mjs`. Lookups are
exact-match:
`findModel(provider, name)` and `findElectricityMix(zone)`, where the zone is an ISO 3166-1
alpha-3 code. Aliases in the model data are resolved at build time.

`PROVIDER_CONFIG_MAP` carries the datacenter assumptions per provider, and is checked against
upstream by the test suite.

## Scope

Included: `llmImpacts`, `computeLlmImpacts`, the impacts model, the DAG engine, the data layer,
`PROVIDER_CONFIG_MAP`, the warning and error catalogue, and the `RangeValue` primitives.

Not included: any provider instrumentation. Nothing here patches an SDK or times a request for
you — you measure the latency and count the output tokens, and this package turns those into
impacts. Video generation and OpenTelemetry export are also still to come. See
[`docs/parity.md`](../../docs/parity.md) for the module-by-module mapping against Python.

## Parity

Every number this package produces is checked against the Python implementation. See the
[root README](../../README.md#numerical-parity) for how to run and regenerate the vectors.

## License

MPL-2.0.
