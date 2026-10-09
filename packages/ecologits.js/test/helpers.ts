import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import {
    isParametersMoE,
    isRangeValue,
    RangeValue,
    type BaseImpact,
    type Impacts,
    type ParametersMoE,
    type ValueOrRange,
} from "../src/index.js";

/** The test folder itself, i.e. the folder holding the implementation vectors. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, i.e. the folder holding `spec/` and `packages/`. */
const REPO_ROOT = path.resolve(HERE, "../../..");

/** Contract vectors: the observable behaviour the spec promises. */
const SPEC_VECTORS_DIR = path.join(REPO_ROOT, "spec", "vectors");

/** Implementation vectors: internal arithmetic and comparison semantics, not spec surface. */
const INTERNAL_VECTORS_DIR = path.join(HERE, "vectors");

const RELATIVE_TOLERANCE = 1e-12;

/** Provenance and index of the spec vectors. Mirrors `spec/schema/manifest.schema.json`. */
export interface SpecManifest {
    specVersion: string;
    reference: {
        implementation: string;
        version: string;
        commit: string | null;
        pythonVersion: string;
    };
    vectors: { kind: string; path: string; contract: string }[];
}

export function readManifest(): SpecManifest {
    return JSON.parse(
        readFileSync(path.join(REPO_ROOT, "spec", "manifest.json"), "utf8"),
    ) as SpecManifest;
}

/** Read a contract vector from `spec/vectors/`. */
export function readVector<T>(name: string): T {
    return JSON.parse(readFileSync(path.join(SPEC_VECTORS_DIR, name), "utf8")) as T;
}

/** Read an implementation vector from `test/vectors/`. */
export function readInternalVector<T>(name: string): T {
    return JSON.parse(readFileSync(path.join(INTERNAL_VECTORS_DIR, name), "utf8")) as T;
}

/** Turn a vector value back into a `ValueOrRange`: `{min, max}` becomes a `RangeValue`. */
export function reviveValueOrRange(value: unknown): ValueOrRange {
    if (typeof value === "number") {
        return value;
    }
    if (value !== null && typeof value === "object" && "min" in value && "max" in value) {
        const range = value as { min: number; max: number };
        return new RangeValue(range.min, range.max);
    }
    throw new Error(`Not a ValueOrRange: ${JSON.stringify(value)}`);
}

export function serializeValue(value: unknown): unknown {
    return isRangeValue(value) ? { min: value.min, max: value.max } : value;
}

/**
 * Serialise through the object's own `toJSON`, which is what a caller gets from
 * `JSON.stringify`. Doing it this way means the vectors validate the serialisation as well
 * as the numbers, rather than a test-only reimplementation of the same shape.
 */
export function serializeImpact(impact: BaseImpact): unknown {
    return JSON.parse(JSON.stringify(impact));
}

export function serializeImpacts(impacts: Impacts): unknown {
    return JSON.parse(JSON.stringify(impacts));
}

export function serializeParameters(
    parameters: ValueOrRange | ParametersMoE,
): Record<string, unknown> {
    if (isParametersMoE(parameters)) {
        return {
            kind: "moe",
            total: serializeValue(parameters.total),
            active: serializeValue(parameters.active),
        };
    }
    return { kind: "dense", parameters: serializeValue(parameters) };
}

export function expectDeepClose(actual: unknown, expected: unknown, context = "value"): void {
    if (typeof expected === "number") {
        if (typeof actual !== "number") {
            throw new Error(`${context}: expected a number but received ${typeof actual}`);
        }
        if (Number.isNaN(expected)) {
            expect(actual, context).toBeNaN();
            return;
        }
        if (!Number.isFinite(expected)) {
            expect(actual, context).toBe(expected);
            return;
        }
        const tolerance = Math.abs(expected) * RELATIVE_TOLERANCE;
        const difference = Math.abs(actual - expected);
        expect(
            difference,
            `${context}: ${actual} differs from the Python value ${expected} by ${difference}`,
        ).toBeLessThanOrEqual(tolerance);
        return;
    }

    if (expected === null || typeof expected !== "object") {
        expect(actual, context).toBe(expected);
        return;
    }

    if (Array.isArray(expected)) {
        expect(Array.isArray(actual), `${context}: expected an array`).toBe(true);
        const actualArray = actual as unknown[];
        expect(actualArray.length, `${context}: array length`).toBe(expected.length);
        expected.forEach((item, index) => {
            expectDeepClose(actualArray[index], item, `${context}[${index}]`);
        });
        return;
    }

    expect(actual !== null && typeof actual === "object", `${context}: expected an object`).toBe(
        true,
    );
    const expectedObject = expected as Record<string, unknown>;
    const actualObject = actual as Record<string, unknown>;
    expect(Object.keys(actualObject).sort(), `${context}: keys`).toEqual(
        Object.keys(expectedObject).sort(),
    );
    for (const key of Object.keys(expectedObject)) {
        expectDeepClose(actualObject[key], expectedObject[key], `${context}.${key}`);
    }
}
