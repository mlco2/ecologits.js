# Ecologits.js - Core calculator

Version 2.0.5 is the existing core implementation, published under the new `@ecologits` scope. It does not introduce the planned 3.0 redesign. The existing OpenAI and Mistral adapters remain under `@genai-impact` and are not part of this release.

Importing the package fetches model data from GitHub, so network access is required at initialization.

## Install

### `npm`

```
npm install @ecologits/ecologits.js
```

### `yarn`

```
yarn add @ecologits/ecologits.js
```

## Usage (Calculator only)

```ts
import { computeLlmImpacts, type Impacts } from "@ecologits/ecologits.js";

const PROVIDER = // provider name, must match one of the providers in https://raw.githubusercontent.com/genai-impact/ecologits/refs/tags/0.5.0/ecologits/data/models.csv
const model = // the model name used


const main = async () => {
  try {
    const startDate = new Date();
    const response = // Interact with any LLM
    const requestLatency = new Date().getTime() - startDate.getTime();
    const tokens = response.data.usage.completionTokens; // data structure to retrieve number of tokens may vary depending on the provider
    const impacts = computeLlmImpacts(
        PROVIDER,
        model,
        tokens,
        requestLatency);
    // Get estimated environmental impacts of the inference
    console.log(
      // @ts-ignore
      `Energy consumption: ${impacts.energy.value} ${impacts.energy.unit}`
    );
    console.log(
      // @ts-ignore
      `GHG emissions: ${impacts.gwp.value} ${impacts.gwp.unit}`
    );
  } catch (e) {
    console.error(e);
    throw e;
  }
};
main();
```
