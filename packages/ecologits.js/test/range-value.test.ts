import { describe, expect, it } from "vitest";
import {
    add,
    div,
    eq,
    gt,
    gte,
    lt,
    lte,
    mul,
    RangeValue,
    type ValueOrRange,
} from "../src/index.js";
import { expectDeepClose, readInternalVector, serializeValue } from "./helpers.js";

interface ValueSpec {
    kind: "scalar" | "range";
    value?: number;
    min?: number;
    max?: number;
}

interface PairCase {
    left: ValueSpec;
    right: ValueSpec;
    results: Record<string, unknown>;
}

interface RangeValueVector {
    values: ValueSpec[];
    pairs: PairCase[];
    formats: { value: ValueSpec; formatted: string }[];
}

const vector = readInternalVector<RangeValueVector>("range-value.json");

const OPERATIONS: Record<string, (a: ValueOrRange, b: ValueOrRange) => unknown> = {
    add,
    mul,
    div,
    eq,
    lte,
    lt,
    gte,
    gt,
};

function revive(spec: ValueSpec): ValueOrRange {
    return spec.kind === "scalar"
        ? (spec.value as number)
        : new RangeValue(spec.min as number, spec.max as number);
}

function label(spec: ValueSpec): string {
    return spec.kind === "scalar" ? String(spec.value) : `RangeValue(${spec.min}, ${spec.max})`;
}

describe("RangeValue parity with Python", () => {
    it("exercises the full ordered value matrix", () => {
        expect(vector.values).toHaveLength(7);
        expect(vector.pairs).toHaveLength(49);
    });

    for (const [index, pair] of vector.pairs.entries()) {
        it(`${label(pair.left)} op ${label(pair.right)} (#${index})`, () => {
            const left = revive(pair.left);
            const right = revive(pair.right);

            for (const [name, operation] of Object.entries(OPERATIONS)) {
                const expected = pair.results[name];
                const isError =
                    expected !== null &&
                    typeof expected === "object" &&
                    "error" in (expected as object);
                if (isError) {
                    expect(() => operation(left, right), `${name} should throw`).toThrow();
                    continue;
                }
                expectDeepClose(serializeValue(operation(left, right)), expected, name);
            }
        });
    }

    for (const entry of vector.formats) {
        it(`formats ${label(entry.value)}`, () => {
            expect(String(revive(entry.value))).toBe(entry.formatted);
        });
    }

    it("rejects an interval whose minimum exceeds its maximum", () => {
        expect(() => new RangeValue(2, 1)).toThrow();
    });

    it("renders non-finite bounds the way Python's repr does", () => {
        // JSON cannot carry Infinity or NaN, so these cannot round-trip through the vector.
        const infinity = Number.POSITIVE_INFINITY;
        expect(new RangeValue(infinity, infinity).toString()).toBe("inf [inf - inf]");
        expect(new RangeValue(Number.NaN, Number.NaN).toString()).toBe("nan [nan - nan]");
        expect(new RangeValue(-0, -0).toString()).toBe("-0.0 [-0.0 - -0.0]");
    });

    it("exposes the midpoint", () => {
        expect(new RangeValue(1, 2).mean).toBe(1.5);
        expect(new RangeValue(-1, 1).mean).toBe(0);
    });

    it("serialises to the same shape Pydantic dumps", () => {
        expect(JSON.parse(JSON.stringify(new RangeValue(1, 2)))).toEqual({ min: 1, max: 2 });
    });
});
