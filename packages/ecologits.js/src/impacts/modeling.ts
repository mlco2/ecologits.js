import { ModelingError } from "../exceptions.js";
import { add, eq, gte, lte } from "../utils/arithmetic.js";
import { isRangeValue, type ValueOrRange } from "../utils/range_value.js";

function dumpValue(value: ValueOrRange): number | { min: number; max: number } {
    return isRangeValue(value) ? value.toJSON() : value;
}

/** Discriminator carried by every impact. */
export type ImpactType = "energy" | "GWP" | "ADPe" | "PE" | "WCF";

export abstract class BaseImpact {
    readonly type: string;
    readonly name: string;
    readonly unit: string;
    readonly value: ValueOrRange;

    protected constructor(type: string, name: string, unit: string, value: ValueOrRange) {
        this.type = type;
        this.name = name;
        this.unit = unit;
        this.value = value;
    }

    /** Build a new instance of the concrete subclass with a different value. */
    protected abstract recreate(value: ValueOrRange): BaseImpact;

    private static assertComparable(self: BaseImpact, other: BaseImpact, verb: string): void {
        if (!(other instanceof BaseImpact)) {
            throw new ModelingError(
                `Error occurred, cannot ${verb} an Impact with ${typeof other}.`,
            );
        }
        if (self.type !== other.type) {
            throw new ModelingError(
                `Error occurred, cannot ${verb} a ${self.type} Impact with ${other.type} Impact.`,
            );
        }
    }

    add(other: BaseImpact): this {
        BaseImpact.assertComparable(this, other, "add");
        return this.recreate(add(this.value, other.value)) as this;
    }

    equals(other: BaseImpact): boolean {
        BaseImpact.assertComparable(this, other, "compare");
        return eq(this.value, other.value);
    }

    lte(other: BaseImpact): boolean {
        BaseImpact.assertComparable(this, other, "compare");
        return lte(this.value, other.value);
    }

    gte(other: BaseImpact): boolean {
        BaseImpact.assertComparable(this, other, "compare");
        return gte(this.value, other.value);
    }

    lt(other: BaseImpact): boolean {
        BaseImpact.assertComparable(this, other, "compare");
        return lte(this.value, other.value) && !eq(this.value, other.value);
    }

    gt(other: BaseImpact): boolean {
        BaseImpact.assertComparable(this, other, "compare");
        return !lte(this.value, other.value);
    }

    toJSON(): {
        type: string;
        name: string;
        value: number | { min: number; max: number };
        unit: string;
    } {
        return { type: this.type, name: this.name, value: dumpValue(this.value), unit: this.unit };
    }
}

/** Energy consumption, final energy "measured from the plug". */
export class Energy extends BaseImpact {
    constructor(value: ValueOrRange) {
        super("energy", "Energy", "kWh", value);
    }

    protected recreate(value: ValueOrRange): Energy {
        return new Energy(value);
    }
}

/** Global Warming Potential, also known as GHG or carbon emissions. */
export class GWP extends BaseImpact {
    constructor(value: ValueOrRange) {
        super("GWP", "Global Warming Potential", "kgCO2eq", value);
    }

    protected recreate(value: ValueOrRange): GWP {
        return new GWP(value);
    }
}

/** Abiotic Depletion Potential for elements: minerals and metals. */
export class ADPe extends BaseImpact {
    constructor(value: ValueOrRange) {
        super("ADPe", "Abiotic Depletion Potential (elements)", "kgSbeq", value);
    }

    protected recreate(value: ValueOrRange): ADPe {
        return new ADPe(value);
    }
}

/** Primary Energy: total energy drawn from primary sources. */
export class PE extends BaseImpact {
    constructor(value: ValueOrRange) {
        super("PE", "Primary Energy", "MJ", value);
    }

    protected recreate(value: ValueOrRange): PE {
        return new PE(value);
    }
}

/** Water Consumption Footprint. Usage-only; there is no embodied counterpart. */
export class WCF extends BaseImpact {
    constructor(value: ValueOrRange) {
        super("WCF", "Water Consumption Footprint", "L", value);
    }

    protected recreate(value: ValueOrRange): WCF {
        return new WCF(value);
    }
}

/** Common shape of an impact phase. */
export interface Phase {
    readonly type: string;
    readonly name: string;
}

/** Impacts during model execution. */
export class Usage implements Phase {
    readonly type = "usage";
    readonly name = "Usage";
    readonly energy: Energy;
    readonly gwp: GWP;
    readonly adpe: ADPe;
    readonly pe: PE;
    readonly wcf: WCF;

    constructor(fields: { energy: Energy; gwp: GWP; adpe: ADPe; pe: PE; wcf: WCF }) {
        this.energy = fields.energy;
        this.gwp = fields.gwp;
        this.adpe = fields.adpe;
        this.pe = fields.pe;
        this.wcf = fields.wcf;
    }

    toJSON(): Record<string, unknown> {
        return {
            type: this.type,
            name: this.name,
            energy: this.energy,
            gwp: this.gwp,
            adpe: this.adpe,
            pe: this.pe,
            wcf: this.wcf,
        };
    }
}

/** Embodied impacts: resource extraction, manufacturing and transport of the hardware. */
export class Embodied implements Phase {
    readonly type = "embodied";
    readonly name = "Embodied";
    readonly gwp: GWP;
    readonly adpe: ADPe;
    readonly pe: PE;

    constructor(fields: { gwp: GWP; adpe: ADPe; pe: PE }) {
        this.gwp = fields.gwp;
        this.adpe = fields.adpe;
        this.pe = fields.pe;
    }

    toJSON(): Record<string, unknown> {
        return { type: this.type, name: this.name, gwp: this.gwp, adpe: this.adpe, pe: this.pe };
    }
}

export class Impacts {
    readonly energy: Energy;
    readonly gwp: GWP;
    readonly adpe: ADPe;
    readonly pe: PE;
    readonly wcf: WCF;
    readonly usage: Usage;
    readonly embodied: Embodied;

    constructor(fields: {
        energy: Energy;
        gwp: GWP;
        adpe: ADPe;
        pe: PE;
        wcf: WCF;
        usage: Usage;
        embodied: Embodied;
    }) {
        this.energy = fields.energy;
        this.gwp = fields.gwp;
        this.adpe = fields.adpe;
        this.pe = fields.pe;
        this.wcf = fields.wcf;
        this.usage = fields.usage;
        this.embodied = fields.embodied;
    }

    toJSON(): Record<string, unknown> {
        return {
            energy: this.energy,
            gwp: this.gwp,
            adpe: this.adpe,
            pe: this.pe,
            wcf: this.wcf,
            usage: this.usage,
            embodied: this.embodied,
        };
    }
}
