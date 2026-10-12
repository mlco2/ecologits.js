import { describe, expect, it } from "vitest";
import {
    computeLlmImpacts,
    ECOLOGITS_VERSION,
    upperBound,
    type ComputeLlmImpactsParams,
} from "../src/index.js";
import {
    expectDeepClose,
    readManifest,
    readVector,
    reviveValueOrRange,
    serializeImpacts,
} from "./helpers.js";

interface LlmImpactsCase {
    name: string;
    inputs: Record<string, unknown>;
    expected?: unknown;
    pythonError?: string;
}

interface EstimatorVector {
    cases: LlmImpactsCase[];
}

const vector = readVector<EstimatorVector>("estimator.json");
const manifest = readManifest();

function toParams(inputs: Record<string, unknown>): ComputeLlmImpactsParams {
    return {
        modelActiveParameterCount: reviveValueOrRange(inputs.modelActiveParameterCount),
        modelTotalParameterCount: reviveValueOrRange(inputs.modelTotalParameterCount),
        outputTokenCount: inputs.outputTokenCount as number,
        ifElectricityMixAdpe: inputs.ifElectricityMixAdpe as number,
        ifElectricityMixPe: inputs.ifElectricityMixPe as number,
        ifElectricityMixGwp: inputs.ifElectricityMixGwp as number,
        ifElectricityMixWue: inputs.ifElectricityMixWue as number,
        datacenterPue: reviveValueOrRange(inputs.datacenterPue),
        datacenterWue: reviveValueOrRange(inputs.datacenterWue),
        requestLatency: (inputs.requestLatency ?? null) as number | null,
        tps: (inputs.tps ?? null) as number | null,
        ttft: (inputs.ttft ?? null) as number | null,
    };
}

describe("computeLlmImpacts parity with Python ecologits", () => {
    it("the vectors were generated from the same upstream version as the vendored data", () => {
        expect(manifest.reference.version).toBe(ECOLOGITS_VERSION);
    });

    it("covers every registered model plus every electricity mix", () => {
        const names = vector.cases.map((testCase) => testCase.name);
        expect(names.filter((name) => name.startsWith("zone/")).length).toBeGreaterThan(200);
        expect(
            names.filter((name) => name.includes("/") && !name.startsWith("zone/")).length,
        ).toBeGreaterThan(300);
    });

    for (const testCase of vector.cases) {
        it(testCase.name, () => {
            const params = toParams(testCase.inputs);

            if (testCase.pythonError !== undefined) {
                expect(() => computeLlmImpacts(params)).toThrow();
                return;
            }

            expectDeepClose(serializeImpacts(computeLlmImpacts(params)), testCase.expected);
        });
    }
});

/**
 * `docs/parity.md` divergence #8: `assets` is an extension beyond the Python API. It is merged
 * last, so it wins over the named parameters, and omitting it must reproduce the contract
 * exactly. Those are the two properties the extension promises, so they are the ones pinned.
 */
describe("computeLlmImpacts `assets` extension", () => {
    const baseParams: ComputeLlmImpactsParams = {
        modelActiveParameterCount: 7.3,
        modelTotalParameterCount: 7.3,
        outputTokenCount: 200,
        requestLatency: 5.0,
        ifElectricityMixAdpe: 7.37708e-8,
        ifElectricityMixPe: 9.988,
        ifElectricityMixGwp: 0.590478,
        ifElectricityMixWue: 5.04,
        datacenterPue: 1.2,
        datacenterWue: 0.569,
    };

    it("merges `assets` last, so an override wins over the named parameter", () => {
        const baseline = computeLlmImpacts(baseParams);
        const overridden = computeLlmImpacts({
            ...baseParams,
            assets: { output_token_count: baseParams.outputTokenCount * 2 },
        });

        // Doubling the token count must reach the DAG: energy usage scales with it.
        expect(upperBound(overridden.usage.energy.value)).toBeGreaterThan(
            upperBound(baseline.usage.energy.value),
        );
    });

    it("omitting `assets` reproduces the contract exactly", () => {
        const explicitUndefined = computeLlmImpacts({ ...baseParams, assets: undefined });

        expect(serializeImpacts(explicitUndefined)).toEqual(
            serializeImpacts(computeLlmImpacts(baseParams)),
        );
    });
});
