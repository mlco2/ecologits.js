import { describe, expect, it } from "vitest";
import {
    electricityMixes,
    ElectricityMixRepository,
    models,
    ModelRepository,
} from "../src/index.js";
import type { Model } from "../src/index.js";
import { expectDeepClose, readVector, serializeParameters } from "./helpers.js";

interface ModelEntry {
    provider: string;
    name: string;
    architectureType: string;
    parameters: Record<string, unknown>;
    warningCodes: string[];
    deployment: { tps: number | null; ttft: number | null } | null;
}

interface MixEntry {
    zone: string;
    adpe: number;
    pe: number;
    gwp: number;
    wue: number;
    warningCodes: string[];
}

interface LookupEntry {
    provider: string;
    name: string;
    found: boolean;
    resolvedName: string | null;
}

interface RepositoryVector {
    models: ModelEntry[];
    electricityMixes: MixEntry[];
    modelLookups: LookupEntry[];
}

const vector = readVector<RepositoryVector>("repository.json");

function serializeModel(model: Model): ModelEntry {
    return {
        provider: model.provider,
        name: model.name,
        architectureType: model.architecture.type,
        parameters: serializeParameters(model.architecture.parameters),
        warningCodes: model.warnings.map((warning) => warning.code),
        deployment: model.deployment
            ? { tps: model.deployment.tps, ttft: model.deployment.ttft }
            : null,
    };
}

describe("data layer parity with Python", () => {
    it("registers every model, in upstream order", () => {
        const registered = models.listModels();
        expect(registered).toHaveLength(vector.models.length);

        vector.models.forEach((expected, index) => {
            const actual = registered[index];
            expectDeepClose(
                serializeModel(actual),
                expected,
                `models[${index}] ${expected.provider}/${expected.name}`,
            );
        });
    });

    it("resolves aliases to a copy renamed after the alias", () => {
        // "claude-haiku-4-5-20251001" is registered as an alias of "claude-haiku-4-5".
        const aliased = models.findModel("anthropic", "claude-haiku-4-5-20251001");
        expect(aliased).toBeDefined();
        expect(aliased?.name).toBe("claude-haiku-4-5-20251001");
        expect(aliased?.provider).toBe("anthropic");
    });

    it("populates `sources`, unlike upstream's singular-key bug", () => {
        // Divergence #3 in docs/parity.md: upstream guards on `"source"` but reads
        // `data["sources"]`, so it always leaves the list empty. The port reads `sources` as
        // intended. The field is provenance metadata and never feeds a computation.
        const model = models.findModel("openai", "gpt-4o-mini");
        expect(model).toBeDefined();
        expect(model?.sources.length).toBeGreaterThan(0);
        expect(model?.sources[0]).toMatch(/^https?:\/\//);
    });

    it("registers every electricity mix, in upstream order", () => {
        const registered = electricityMixes.listElectricityMixes();
        expect(registered).toHaveLength(vector.electricityMixes.length);

        vector.electricityMixes.forEach((expected, index) => {
            const actual = registered[index];
            expectDeepClose(
                {
                    zone: actual.zone,
                    adpe: actual.adpe,
                    pe: actual.pe,
                    gwp: actual.gwp,
                    wue: actual.wue,
                    warningCodes: actual.warnings.map((warning) => warning.code),
                },
                expected,
                `electricityMixes[${index}] ${expected.zone}`,
            );
        });
    });

    for (const lookup of vector.modelLookups) {
        it(`findModel(${lookup.provider}, ${lookup.name})`, () => {
            const found = models.findModel(lookup.provider, lookup.name);
            expect(found !== undefined).toBe(lookup.found);
            expect(found?.name ?? null).toBe(lookup.resolvedName);
        });
    }

    it("does not fall back to fuzzy matching for an unknown model", () => {
        expect(models.findModel("openai", "gpt-4o-minni")).toBeUndefined();
    });

    it("is case-sensitive on the zone code", () => {
        expect(electricityMixes.findElectricityMix("USA")).toBeDefined();
        expect(electricityMixes.findElectricityMix("usa")).toBeUndefined();
    });

    it("refuses to initialise from an empty model repository", () => {
        expect(() => ModelRepository.fromData({ models: [], aliases: null })).toThrow();
    });

    it("refuses to initialise from an empty electricity mix repository", () => {
        expect(() => ElectricityMixRepository.fromData({ electricity_mixes: [] })).toThrow();
    });

    it("refuses duplicate models", () => {
        const duplicate = {
            provider: "openai",
            name: "gpt-4o-mini",
            architecture: { type: "dense" as const, parameters: 8 },
            warnings: null,
            sources: null,
            deployment: null,
        };
        expect(() =>
            ModelRepository.fromData({ models: [duplicate, duplicate], aliases: null }),
        ).toThrow();
    });

    it("refuses an alias whose target is not registered", () => {
        expect(() =>
            ModelRepository.fromData({
                models: null,
                aliases: [{ provider: "openai", name: "alias", alias: "missing" }],
            }),
        ).toThrow();
    });

    it("refuses an unknown provider", () => {
        expect(() =>
            ModelRepository.fromData({
                models: [
                    {
                        provider: "not-a-provider",
                        name: "x",
                        architecture: { type: "dense", parameters: 1 },
                        warnings: null,
                        sources: null,
                        deployment: null,
                    },
                ],
                aliases: null,
            }),
        ).toThrow();
    });

    it("rejects an unknown warning code in the data", () => {
        expect(() =>
            ModelRepository.fromData({
                models: [
                    {
                        provider: "openai",
                        name: "x",
                        architecture: { type: "dense", parameters: 1 },
                        warnings: ["nope"],
                        sources: null,
                        deployment: null,
                    },
                ],
                aliases: null,
            }),
        ).toThrow();
    });
});
