import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
    ElectricityMixADPeDefaultWarning,
    ImpactsOutput,
    llmImpacts,
    logger,
    ModelArchMultimodalWarning,
    ModelNotRegisteredError,
    models,
    PROVIDER_CONFIG_MAP,
    ZoneNotRegisteredError,
} from "../src/index.js";
import { expectDeepClose, readVector } from "./helpers.js";

interface CaseInputs {
    provider: string;
    modelName: string;
    outputTokenCount: number;
    requestLatency: number;
    electricityMixZone: string | null;
}

interface OutputCase {
    name: string;
    inputs: CaseInputs;
    expected?: unknown;
    pythonError?: string;
}

interface HighLevelVector {
    providerConfigMap: Record<string, unknown>;
    cases: OutputCase[];
}

const vector = readVector<HighLevelVector>("high-level.json");

function serialize(output: ImpactsOutput): unknown {
    return JSON.parse(JSON.stringify(output));
}

function call(inputs: CaseInputs): ImpactsOutput {
    return llmImpacts({
        provider: inputs.provider,
        modelName: inputs.modelName,
        outputTokenCount: inputs.outputTokenCount,
        requestLatency: inputs.requestLatency,
        electricityMixZone: inputs.electricityMixZone,
    });
}

describe("llmImpacts parity with Python", () => {
    // The package logs each distinct warning once per process. Capturing the sink keeps the
    // suite quiet, and resetting the dedupe state stops it leaking between tests.
    beforeEach(() => {
        logger.setSink(() => {});
        logger.resetOnceMessages();
    });

    afterAll(() => {
        logger.setSink(null);
    });

    it("exposes the same provider datacenter assumptions", () => {
        expectDeepClose(JSON.parse(JSON.stringify(PROVIDER_CONFIG_MAP)), vector.providerConfigMap);
    });

    it("covers every registered model", () => {
        expect(models.listModels().length).toBeGreaterThan(300);
        expect(vector.cases.length).toBeGreaterThan(350);
    });

    for (const testCase of vector.cases) {
        it(testCase.name, () => {
            if (testCase.pythonError !== undefined) {
                expect(() => call(testCase.inputs)).toThrow();
                return;
            }
            expectDeepClose(serialize(call(testCase.inputs)), testCase.expected);
        });
    }
});

describe("llmImpacts behaviour", () => {
    beforeEach(() => {
        logger.setSink(() => {});
        logger.resetOnceMessages();
    });

    afterAll(() => {
        logger.setSink(null);
    });

    it("reports an unregistered model as an error instead of throwing", () => {
        const result = llmImpacts({
            provider: "openai",
            modelName: "does-not-exist",
            outputTokenCount: 100,
            requestLatency: 1,
        });

        expect(result.hasErrors).toBe(true);
        expect(result.hasWarnings).toBe(false);
        expect(result.errors?.[0]).toBeInstanceOf(ModelNotRegisteredError);
        expect(result.errors?.[0]?.message).toContain("does-not-exist");
        expect(result.energy).toBeNull();
        expect(result.usage).toBeNull();
    });

    it("reports an unregistered zone as an error naming the zone", () => {
        const result = llmImpacts({
            provider: "openai",
            modelName: "gpt-4o-mini",
            outputTokenCount: 100,
            requestLatency: 1,
            electricityMixZone: "ZZZ",
        });

        expect(result.hasErrors).toBe(true);
        expect(result.errors?.[0]).toBeInstanceOf(ZoneNotRegisteredError);
        expect(result.errors?.[0]?.message).toContain("ZZZ");
    });

    it("defaults to the provider's datacenter zone", () => {
        const model = models.listModels().find((entry) => entry.provider === "mistralai");
        expect(model).toBeDefined();
        if (model === undefined) {
            return;
        }

        const implicit = llmImpacts({
            provider: "mistralai",
            modelName: model.name,
            outputTokenCount: 100,
            requestLatency: 1,
        });
        const explicit = llmImpacts({
            provider: "mistralai",
            modelName: model.name,
            outputTokenCount: 100,
            requestLatency: 1,
            electricityMixZone: PROVIDER_CONFIG_MAP.mistralai.datacenterLocation,
        });

        expect(serialize(implicit)).toEqual(serialize(explicit));
    });

    it("logs each distinct warning once", () => {
        const logged: string[] = [];
        logger.setSink((_level, message) => logged.push(message));

        const repeat = () =>
            llmImpacts({
                provider: "openai",
                modelName: "does-not-exist",
                outputTokenCount: 1,
                requestLatency: 1,
            });
        repeat();
        repeat();
        repeat();

        expect(logged).toHaveLength(1);
    });

    it("deduplicates warnings by code but not errors", () => {
        const output = new ImpactsOutput();
        output.addWarning(new ModelArchMultimodalWarning());
        output.addWarning(new ModelArchMultimodalWarning());
        output.addWarning(new ElectricityMixADPeDefaultWarning());

        expect(output.warnings).toHaveLength(2);
        expect(output.hasWarnings).toBe(true);

        output.addErrors(new ModelNotRegisteredError());
        output.addErrors(new ModelNotRegisteredError());
        expect(output.errors).toHaveLength(2);
    });

    it("starts with every field absent", () => {
        const output = new ImpactsOutput();

        expect(output.energy).toBeNull();
        expect(output.usage).toBeNull();
        expect(output.embodied).toBeNull();
        expect(output.warnings).toBeNull();
        expect(output.errors).toBeNull();
        expect(output.hasWarnings).toBe(false);
        expect(output.hasErrors).toBe(false);
    });

    it("serialises absent fields as null, the way model_dump does", () => {
        expect(JSON.parse(JSON.stringify(new ImpactsOutput()))).toEqual({
            energy: null,
            gwp: null,
            adpe: null,
            pe: null,
            wcf: null,
            usage: null,
            embodied: null,
            warnings: null,
            errors: null,
        });
    });
});
