import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
    computeLlmImpacts,
    electricityMixes,
    isParametersMoE,
    isRangeValue,
    llmImpacts,
    logger,
    lowerBound,
    models,
} from "../src/index.js";

/**
 * The examples from `packages/ecologits.js/README.md`, executed as written.
 *
 * Documentation that is never run drifts. Keeping the snippets here means a change to the
 * public API breaks the build rather than leaving a stale example in the README.
 *
 * Several models publish their parameter count as an interval, so their impacts come back
 * as ranges. Assertions therefore compare against the lower bound, using the library's own
 * `lowerBound` helper rather than a reimplementation.
 */

describe("README examples", () => {
    beforeEach(() => {
        // Warnings are part of the expected output; keep them out of the test log.
        logger.setSink(() => {});
        logger.resetOnceMessages();
    });

    afterAll(() => {
        logger.setSink(null);
    });

    it("llmImpacts: turns a model name into impacts", () => {
        const impacts = llmImpacts({
            provider: "openai",
            modelName: "gpt-4o-mini",
            outputTokenCount: 200,
            requestLatency: 1.5,
        });

        expect(impacts.hasErrors).toBe(false);

        const energy = impacts.energy;
        const gwp = impacts.gwp;
        expect(energy).not.toBeNull();
        expect(gwp).not.toBeNull();
        if (energy === null || gwp === null) {
            return;
        }

        expect(lowerBound(energy.value)).toBeGreaterThan(0);
        expect(energy.unit).toBe("kWh");
        expect(lowerBound(gwp.value)).toBeGreaterThan(0);
        expect(gwp.unit).toBe("kgCO2eq");
    });

    it("llmImpacts: accepts an explicit electricity mix zone", () => {
        const france = llmImpacts({
            provider: "openai",
            modelName: "gpt-4o-mini",
            outputTokenCount: 200,
            requestLatency: 1.5,
            electricityMixZone: "FRA",
        });
        const defaultZone = llmImpacts({
            provider: "openai",
            modelName: "gpt-4o-mini",
            outputTokenCount: 200,
            requestLatency: 1.5,
        });

        expect(france.hasErrors).toBe(false);
        // France's mix is far less carbon intensive than the USA default, so overriding the
        // zone has to change the answer for the example to be worth documenting.
        expect(lowerBound(france.gwp!.value)).toBeLessThan(lowerBound(defaultZone.gwp!.value));
        // Energy depends only on the hardware, so it must not move.
        expect(lowerBound(france.energy!.value)).toBeCloseTo(
            lowerBound(defaultZone.energy!.value),
            15,
        );
    });

    it("computeLlmImpacts: computes impacts from explicit factors", () => {
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

        expect(lowerBound(impacts.energy.value)).toBeGreaterThan(0);
        expect(lowerBound(impacts.gwp.value)).toBeGreaterThan(0);
        expect(lowerBound(impacts.adpe.value)).toBeGreaterThan(0);
        expect(lowerBound(impacts.pe.value)).toBeGreaterThan(0);
        expect(lowerBound(impacts.wcf.value)).toBeGreaterThan(0);

        expect(impacts.energy.unit).toBe("kWh");
        expect(impacts.usage.type).toBe("usage");
        expect(impacts.embodied.type).toBe("embodied");
    });

    it("keeps energy and water usage-only, and totals the rest", () => {
        const model = models.findModel("openai", "gpt-4o-mini");
        const mix = electricityMixes.findElectricityMix("USA");
        if (model === undefined || mix === undefined) {
            throw new Error("vector data missing");
        }
        const parameters = model.architecture.parameters;
        const impacts = computeLlmImpacts({
            modelActiveParameterCount: isParametersMoE(parameters) ? parameters.active : parameters,
            modelTotalParameterCount: isParametersMoE(parameters) ? parameters.total : parameters,
            outputTokenCount: 100,
            requestLatency: 1,
            ifElectricityMixAdpe: mix.adpe,
            ifElectricityMixPe: mix.pe,
            ifElectricityMixGwp: mix.gwp,
            ifElectricityMixWue: mix.wue,
            datacenterPue: 1.2,
            datacenterWue: 0.569,
        });

        // Water is usage-only and energy is not split, so both totals alias the usage phase.
        expect(impacts.usage.energy).toBe(impacts.energy);
        expect(impacts.wcf).toBe(impacts.usage.wcf);
        expect(impacts.embodied).not.toHaveProperty("wcf");
        expect(impacts.embodied).not.toHaveProperty("energy");
    });

    it("reports a range when the model's parameter count is an interval", () => {
        const ranged = models
            .listModels()
            .find(
                (model) =>
                    isRangeValue(model.architecture.parameters) ||
                    (isParametersMoE(model.architecture.parameters) &&
                        isRangeValue(model.architecture.parameters.total)),
            );
        expect(ranged, "expected a model with an interval parameter count").toBeDefined();
        if (ranged === undefined) {
            return;
        }

        const impacts = llmImpacts({
            provider: ranged.provider,
            modelName: ranged.name,
            outputTokenCount: 200,
            requestLatency: 5,
        });

        expect(impacts.hasErrors).toBe(false);
        expect(isRangeValue(impacts.energy?.value)).toBe(true);
        if (isRangeValue(impacts.energy?.value)) {
            expect(impacts.energy.value.min).toBeLessThan(impacts.energy.value.max);
        }
    });
});
