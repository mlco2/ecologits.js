import { ELECTRICITY_MIXES } from "./data/electricity_mixes.generated.js";
import type { ElectricityMixData, ElectricityMixesFileData } from "./data/schema.js";
import { EcoLogitsValueError } from "./exceptions.js";
import { warningFromCode, type WarningMessage } from "./status_messages.js";

export class ElectricityMix {
    /** ISO 3166-1 alpha-3 code of the zone. */
    readonly zone: string;
    readonly adpe: number;
    readonly pe: number;
    readonly gwp: number;
    readonly wue: number;
    readonly warnings: readonly WarningMessage[];

    constructor(fields: {
        zone: string;
        adpe: number;
        pe: number;
        gwp: number;
        wue: number;
        warnings?: readonly WarningMessage[];
    }) {
        this.zone = fields.zone;
        this.adpe = fields.adpe;
        this.pe = fields.pe;
        this.gwp = fields.gwp;
        this.wue = fields.wue;
        this.warnings = fields.warnings ?? [];
    }

    get hasWarnings(): boolean {
        return this.warnings.length > 0;
    }

    static fromJSON(data: ElectricityMixData): ElectricityMix {
        return new ElectricityMix({
            zone: data.name,
            adpe: Number(data.adpe),
            pe: Number(data.pe),
            gwp: Number(data.gwp),
            wue: Number(data.wue),
            warnings:
                data.warnings === null || data.warnings === undefined
                    ? []
                    : data.warnings.map((code) => warningFromCode(code)),
        });
    }
}

/** Repository of electricity mixes, keyed by zone. */
export class ElectricityMixRepository {
    private readonly mixesByZone = new Map<string, ElectricityMix>();

    constructor(electricityMixes: readonly ElectricityMix[]) {
        for (const mix of electricityMixes) {
            if (this.mixesByZone.has(mix.zone)) {
                throw new EcoLogitsValueError(`duplicated electricity mix with: ${mix.zone}`);
            }
            this.mixesByZone.set(mix.zone, mix);
        }
    }

    findElectricityMix(zone: string): ElectricityMix | undefined {
        return this.mixesByZone.get(zone);
    }

    listElectricityMixes(): ElectricityMix[] {
        return [...this.mixesByZone.values()];
    }

    static fromData(data: ElectricityMixesFileData): ElectricityMixRepository {
        const mixList = (data.electricity_mixes ?? []).map((mix) => ElectricityMix.fromJSON(mix));
        if (mixList.length === 0) {
            throw new EcoLogitsValueError(
                "Cannot initialize on an empty electricity mix repository.",
            );
        }
        return new ElectricityMixRepository(mixList);
    }

    /** Build from the data compiled into this package. */
    static fromGenerated(): ElectricityMixRepository {
        return ElectricityMixRepository.fromData({ electricity_mixes: [...ELECTRICITY_MIXES] });
    }
}

export const electricityMixes = ElectricityMixRepository.fromGenerated();
