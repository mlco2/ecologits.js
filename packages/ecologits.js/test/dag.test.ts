import { describe, expect, it } from "vitest";
import { DAG } from "../src/index.js";

describe("DAG", () => {
    it("runs assets in dependency order regardless of registration order", () => {
        const dag = new DAG();
        const order: string[] = [];

        dag.asset({ name: "c", deps: ["b"], compute: () => (order.push("c"), 3) });
        dag.asset({ name: "b", deps: ["a"], compute: () => (order.push("b"), 2) });
        dag.asset({ name: "a", deps: [], compute: () => (order.push("a"), 1) });

        const results = dag.execute({});

        expect(order).toEqual(["a", "b", "c"]);
        expect(results).toMatchObject({ a: 1, b: 2, c: 3 });
    });

    it("does not recompute an asset whose name the caller already supplied", () => {
        const dag = new DAG();
        let recomputations = 0;

        dag.asset({ name: "a", deps: ["seed"], compute: ({ seed }) => (seed as number) * 2 });
        dag.asset({
            name: "b",
            deps: ["a"],
            compute: ({ a }) => {
                recomputations += 1;
                return (a as number) + 1;
            },
        });

        const results = dag.execute({ seed: 1, b: 999 });

        expect(results.a).toBe(2);
        expect(results.b).toBe(999);
        expect(recomputations).toBe(0);
    });

    it("lets an override feed downstream assets", () => {
        const dag = new DAG();
        dag.asset({ name: "a", deps: [], compute: () => 1 });
        dag.asset({ name: "b", deps: ["a"], compute: ({ a }) => (a as number) + 10 });

        expect(dag.execute({ a: 5 })).toMatchObject({ a: 5, b: 15 });
    });

    it("omits null and undefined dependencies, as Python's `is not None` filter does", () => {
        const dag = new DAG();
        let received: Record<string, unknown> = {};

        dag.asset({
            name: "a",
            deps: ["x", "y", "z"],
            compute: (deps) => {
                received = { ...deps };
                return 1;
            },
        });

        dag.execute({ x: 1, y: null, z: undefined });

        expect(received).toEqual({ x: 1 });
    });

    it("treats a dependency that is not an asset as a caller input", () => {
        const dag = new DAG();
        dag.asset({ name: "a", deps: ["external"], compute: ({ external }) => external });

        expect(dag.execute({ external: "supplied" })).toMatchObject({ a: "supplied" });
    });

    it("rejects duplicate asset names", () => {
        const dag = new DAG();
        dag.asset({ name: "a", deps: [], compute: () => 1 });
        expect(() => dag.asset({ name: "a", deps: [], compute: () => 2 })).toThrow();
    });

    it("rejects a cyclic graph", () => {
        const dag = new DAG();
        dag.asset({ name: "a", deps: ["b"], compute: () => 1 });
        dag.asset({ name: "b", deps: ["a"], compute: () => 2 });
        expect(() => dag.execute({})).toThrow();
    });
});
