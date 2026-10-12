export type ValueOrRangeData = number | { min: number; max: number };

/** Mixture-of-experts parameter counts. */
export interface ParametersMoEData {
    total: ValueOrRangeData;
    active: ValueOrRangeData;
}

export interface ArchitectureData {
    type: "dense" | "moe";
    parameters: ValueOrRangeData | ParametersMoEData;
}

/** Deployment characteristics, used to derive latency instead of the regression. */
export interface DeploymentData {
    tps: number | null;
    ttft: number | null;
}

/** An alias entry. `alias` must name an already-registered model of the same provider. */
export interface AliasData {
    type?: "alias";
    provider: string;
    name: string;
    alias: string;
}

/** A model entry. */
export interface ModelData {
    type?: "model";
    provider: string;
    name: string;
    architecture: ArchitectureData;
    warnings: string[] | null;
    sources: string[] | null;
    deployment: DeploymentData | null;
}

/** Top-level structure of `models.json`. */
export interface ModelsFileData {
    aliases: AliasData[] | null;
    models: ModelData[] | null;
}

/** An electricity mix entry. Impact factors are per kWh. */
export interface ElectricityMixData {
    name: string;
    adpe: number;
    pe: number;
    gwp: number;
    wue: number;
    warnings: string[] | null;
}

/** Top-level structure of `electricity_mixes.json`. */
export interface ElectricityMixesFileData {
    electricity_mixes: ElectricityMixData[] | null;
}
