import { afterEach, describe, expect, it, vi } from "vitest";
import { ECOLOGITS_VERSION, ECOLOGITS_GIT_SHA } from "../src/index.js";

/**
 * The old implementation downloaded `models.csv` from GitHub at import time, which made the
 * library unusable offline and in edge runtimes (and broke Next.js route handlers). The data
 * is now compiled into the package. These tests keep it that way.
 */
describe("the package performs no I/O at import time", () => {
    afterEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    it("imports with fetch poisoned", async () => {
        let fetchCalls = 0;
        vi.stubGlobal("fetch", (..._args: unknown[]) => {
            fetchCalls += 1;
            throw new Error("network access is not allowed at import time");
        });

        vi.resetModules();
        const module = await import("../src/index.js");

        expect(fetchCalls).toBe(0);
        expect(module.models.listModels().length).toBeGreaterThan(300);
        expect(module.electricityMixes.listElectricityMixes().length).toBeGreaterThan(200);
    });

    it("records the upstream version the vendored data came from", () => {
        expect(ECOLOGITS_VERSION).toMatch(/^\d+\.\d+/);
    });

    it("records the upstream commit, or null when it was unavailable", () => {
        expect(ECOLOGITS_GIT_SHA === null || /^[0-9a-f]{40}$/.test(ECOLOGITS_GIT_SHA)).toBe(true);
    });
});
