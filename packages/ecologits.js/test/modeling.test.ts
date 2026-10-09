import { describe, expect, it } from "vitest";
import { ADPe, Energy, GWP, PE, WCF, type BaseImpact, type ValueOrRange } from "../src/index.js";
import {
    expectDeepClose,
    readInternalVector,
    reviveValueOrRange,
    serializeImpact,
} from "./helpers.js";

interface AdditionCase {
    left: string;
    right: string;
    leftValue: unknown;
    rightValue: unknown;
    expected?: unknown;
    error?: string;
}

interface ComparisonCase {
    type: string;
    leftValue: unknown;
    rightValue: unknown;
    eq: boolean;
    lte: boolean;
    lt: boolean;
    gte: boolean;
    gt: boolean;
}

interface CrossTypeCase {
    left: string;
    right: string;
    error: string | null;
}

interface ModelingVector {
    additions: AdditionCase[];
    comparisons: ComparisonCase[];
    crossType: CrossTypeCase[];
}

type ImpactName = "Energy" | "GWP" | "ADPe" | "PE" | "WCF";

const IMPACT_CLASSES: Record<ImpactName, new (value: ValueOrRange) => BaseImpact> = {
    Energy,
    GWP,
    ADPe,
    PE,
    WCF,
};

const vector = readInternalVector<ModelingVector>("modeling.json");

function build(name: string, value: unknown): BaseImpact {
    const ImpactClass = IMPACT_CLASSES[name as ImpactName];
    if (ImpactClass === undefined) {
        throw new Error(`Unknown impact class in vector: ${name}`);
    }
    return new ImpactClass(reviveValueOrRange(value));
}

describe("impact modelling parity with Python", () => {
    it("covers all five criteria without holes", () => {
        expect(new Set(vector.additions.map((item) => item.left)).size).toBe(5);
        expect(vector.comparisons).toHaveLength(5 * 3 * 3);
    });

    for (const [index, item] of vector.additions.entries()) {
        it(`add ${item.left}(${JSON.stringify(item.leftValue)}) + ${item.right}(${JSON.stringify(item.rightValue)}) (#${index})`, () => {
            const left = build(item.left, item.leftValue);
            const right = build(item.right, item.rightValue);

            if (item.error !== undefined) {
                expect(() => left.add(right)).toThrow();
                return;
            }
            expectDeepClose(serializeImpact(left.add(right)), item.expected);
        });
    }

    for (const item of vector.comparisons) {
        it(`compare ${item.type}(${JSON.stringify(item.leftValue)}) vs (${JSON.stringify(item.rightValue)})`, () => {
            const left = build(item.type, item.leftValue);
            const right = build(item.type, item.rightValue);

            expect(left.equals(right), "eq").toBe(item.eq);
            expect(left.lte(right), "lte").toBe(item.lte);
            expect(left.lt(right), "lt").toBe(item.lt);
            expect(left.gte(right), "gte").toBe(item.gte);
            expect(left.gt(right), "gt").toBe(item.gt);
        });
    }

    for (const item of vector.crossType) {
        it(`refuses to compare ${item.left} with ${item.right}`, () => {
            const left = build(item.left, 1);
            const right = build(item.right, 1);
            expect(() => left.equals(right)).toThrow();
            expect(() => left.add(right)).toThrow();
        });
    }

    it("keeps total = usage + embodied, with energy and water usage-only", () => {
        const usage = new GWP(1);
        const embodied = new GWP(2);
        expect(usage.add(embodied).value).toBe(3);

        // WCF has no embodied counterpart, so it is only ever a usage figure.
        expect(Object.keys(new WCF(1)).length).toBe(Object.keys(new Energy(1)).length);
    });
});
