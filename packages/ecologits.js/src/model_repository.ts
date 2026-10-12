import { MODEL_ALIASES, MODELS } from "./data/models.generated.js";
import type {
    AliasData,
    ArchitectureData,
    DeploymentData,
    ModelData,
    ModelsFileData,
    ParametersMoEData,
    ValueOrRangeData,
} from "./data/schema.js";
import { EcoLogitsValueError } from "./exceptions.js";
import { warningFromCode, type WarningMessage } from "./status_messages.js";
import { RangeValue, type ValueOrRange } from "./utils/range_value.js";

export const PROVIDERS = [
    "anthropic",
    "mistralai",
    "openai",
    "huggingface_hub",
    "cohere",
    "google_genai",
] as const;

export type Providers = (typeof PROVIDERS)[number];

export const ARCHITECTURE_TYPES = ["dense", "moe"] as const;

export type ArchitectureTypes = (typeof ARCHITECTURE_TYPES)[number];

/** Mixture-of-experts parameter counts. */
export interface ParametersMoE {
    total: ValueOrRange;
    active: ValueOrRange;
}

/** Model architecture: a parameter count, or total/active counts for mixture-of-experts. */
export interface Architecture {
    type: ArchitectureTypes;
    parameters: ValueOrRange | ParametersMoE;
}

/** Deployment characteristics used to override the latency regression. */
export interface Deployment {
    tps: number | null;
    ttft: number | null;
}

/**
 * Structural test for the mixture-of-experts shape. Shared by the raw JSON view and the
 * domain view, which differ only in the types of the two counts.
 */
function hasTotalAndActive(value: unknown): value is { total: unknown; active: unknown } {
    return typeof value === "object" && value !== null && "total" in value && "active" in value;
}

/** Runtime guard for {@link ParametersMoE}. */
export function isParametersMoE(value: unknown): value is ParametersMoE {
    return hasTotalAndActive(value);
}

function toProvider(value: string): Providers {
    if ((PROVIDERS as readonly string[]).includes(value)) {
        return value as Providers;
    }
    throw new EcoLogitsValueError(`Invalid provider: ${value}`);
}

function toArchitectureType(value: string): ArchitectureTypes {
    if ((ARCHITECTURE_TYPES as readonly string[]).includes(value)) {
        return value as ArchitectureTypes;
    }
    throw new EcoLogitsValueError(`Invalid architecture type: ${value}`);
}

function toValueOrRange(value: ValueOrRangeData): ValueOrRange {
    return typeof value === "number" ? value : new RangeValue(value.min, value.max);
}

function toParameters(value: ValueOrRangeData | ParametersMoEData): ValueOrRange | ParametersMoE {
    if (hasTotalAndActive(value)) {
        return { total: toValueOrRange(value.total), active: toValueOrRange(value.active) };
    }
    return toValueOrRange(value);
}

function toArchitecture(data: ArchitectureData): Architecture {
    return {
        type: toArchitectureType(data.type),
        parameters: toParameters(data.parameters),
    };
}

function toDeployment(data: DeploymentData | null): Deployment | null {
    if (data === null) {
        return null;
    }
    return { tps: data.tps ?? null, ttft: data.ttft ?? null };
}

/** A registered model. */
export class Model {
    readonly provider: Providers;
    readonly name: string;
    readonly architecture: Architecture;
    readonly warnings: readonly WarningMessage[];
    readonly sources: readonly string[];
    readonly deployment: Deployment | null;

    constructor(fields: {
        provider: Providers;
        name: string;
        architecture: Architecture;
        warnings?: readonly WarningMessage[];
        sources?: readonly string[];
        deployment?: Deployment | null;
    }) {
        this.provider = fields.provider;
        this.name = fields.name;
        this.architecture = fields.architecture;
        this.warnings = fields.warnings ?? [];
        this.sources = fields.sources ?? [];
        this.deployment = fields.deployment ?? null;
    }

    get hasWarnings(): boolean {
        return this.warnings.length > 0;
    }

    static fromJSON(data: ModelData): Model {
        const warnings =
            data.warnings === null || data.warnings === undefined
                ? []
                : data.warnings.map((code) => warningFromCode(code));
        return new Model({
            provider: toProvider(data.provider),
            name: data.name,
            architecture: toArchitecture(data.architecture),
            warnings,
            sources: data.sources ?? [],
            deployment: toDeployment(data.deployment ?? null),
        });
    }

    withName(name: string): Model {
        return new Model({
            provider: this.provider,
            name,
            architecture: this.architecture,
            warnings: this.warnings,
            sources: this.sources,
            deployment: this.deployment,
        });
    }
}

function modelKey(provider: string, name: string): string {
    return `${provider}\0${name}`;
}

export class ModelRepository {
    private readonly byKey = new Map<string, Model>();

    constructor(models?: readonly Model[] | null, aliases?: readonly AliasData[] | null) {
        for (const model of models ?? []) {
            this.insert(model.provider, model.name, model);
        }

        for (const alias of aliases ?? []) {
            const provider = toProvider(alias.provider);
            const source = this.byKey.get(modelKey(provider, alias.alias));
            if (source === undefined) {
                throw new EcoLogitsValueError(
                    `model alias not found: (${provider}, ${alias.alias})`,
                );
            }
            this.byKey.set(modelKey(provider, alias.name), source.withName(alias.name));
        }
    }

    private insert(provider: Providers, name: string, model: Model): void {
        const key = modelKey(provider, name);
        if (this.byKey.has(key)) {
            throw new EcoLogitsValueError(`duplicated models with: (${provider}, ${name})`);
        }
        this.byKey.set(key, model);
    }

    addModel(data: ModelData | Model): void {
        const model = data instanceof Model ? data : Model.fromJSON(data);
        this.insert(model.provider, model.name, model);
    }

    findModel(provider: string, modelName: string): Model | undefined {
        return this.byKey.get(modelKey(provider, modelName));
    }

    listModels(): Model[] {
        return [...this.byKey.values()];
    }

    static fromData(data: ModelsFileData): ModelRepository {
        const modelList = (data.models ?? []).map((model) => Model.fromJSON(model));
        if (modelList.length === 0) {
            throw new EcoLogitsValueError("Cannot initialize on an empty model repository.");
        }
        return new ModelRepository(modelList, data.aliases ?? []);
    }

    /** Build from the data compiled into this package. */
    static fromGenerated(): ModelRepository {
        return ModelRepository.fromData({ models: [...MODELS], aliases: [...MODEL_ALIASES] });
    }
}

export const models = ModelRepository.fromGenerated();
