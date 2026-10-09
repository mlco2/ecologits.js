import { EcoLogitsValueError } from "../exceptions.js";

/** Values available to an asset: its declared dependencies, minus absent ones. */
export type AssetInputs = Readonly<Record<string, unknown>>;

/** The computation of a single asset. */
export type AssetCompute = (deps: AssetInputs) => unknown;

/** Declaration of a single asset. */
export interface AssetDefinition {
    /** Unique name, and the key under which its result is stored. */
    readonly name: string;
    /** Names this asset consumes. Names that are not assets are treated as caller inputs. */
    readonly deps: readonly string[];
    readonly compute: AssetCompute;
}

export class DAG {
    private readonly definitions = new Map<string, AssetDefinition>();
    private cachedOrder: string[] | null = null;

    asset(definition: AssetDefinition): void {
        if (this.definitions.has(definition.name)) {
            throw new EcoLogitsValueError(`duplicated asset with: ${definition.name}`);
        }
        this.definitions.set(definition.name, definition);
        this.cachedOrder = null;
    }

    private order(): readonly string[] {
        if (this.cachedOrder !== null) {
            return this.cachedOrder;
        }

        const names = [...this.definitions.keys()];
        const indegree = new Map<string, number>();
        const dependents = new Map<string, string[]>();

        for (const name of names) {
            const definition = this.definitions.get(name);
            if (definition === undefined) {
                continue;
            }
            let degree = 0;
            for (const dep of definition.deps) {
                if (!this.definitions.has(dep)) {
                    continue; // Not an asset: supplied by the caller.
                }
                degree += 1;
                const list = dependents.get(dep);
                if (list === undefined) {
                    dependents.set(dep, [name]);
                } else {
                    list.push(name);
                }
            }
            indegree.set(name, degree);
        }

        const ready = names.filter((name) => indegree.get(name) === 0);
        const order: string[] = [];
        while (ready.length > 0) {
            const name = ready.shift() as string;
            order.push(name);
            for (const dependent of dependents.get(name) ?? []) {
                const remaining = (indegree.get(dependent) ?? 0) - 1;
                indegree.set(dependent, remaining);
                if (remaining === 0) {
                    ready.push(dependent);
                }
            }
        }

        if (order.length !== names.length) {
            throw new EcoLogitsValueError("cycle detected in DAG");
        }
        this.cachedOrder = order;
        return order;
    }

    execute(inputs: AssetInputs): Record<string, unknown> {
        const results: Record<string, unknown> = { ...inputs };

        for (const name of this.order()) {
            if (Object.hasOwn(results, name)) {
                continue;
            }
            const definition = this.definitions.get(name);
            if (definition === undefined) {
                continue;
            }
            const resolved: Record<string, unknown> = {};
            for (const dep of definition.deps) {
                const value = results[dep];
                if (value !== null && value !== undefined) {
                    resolved[dep] = value;
                }
            }
            results[name] = definition.compute(resolved);
        }

        return results;
    }
}
