import { electricityMixes } from "../electricity_mix_repository.js";
import { computeLlmImpacts } from "../impacts/llm.js";
import type { ADPe, Embodied, Energy, GWP, Impacts, PE, Usage, WCF } from "../impacts/modeling.js";
import { logger } from "../log.js";
import { isParametersMoE, models, type Providers } from "../model_repository.js";
import { ModelNotRegisteredError, ZoneNotRegisteredError } from "../status_messages.js";
import type { ErrorMessage, WarningMessage } from "../status_messages.js";
import { RangeValue, type ValueOrRange } from "../utils/range_value.js";

/** Fields of {@link ImpactsOutput}. Everything is optional; absent means `null`. */
export interface ImpactsOutputFields {
    energy?: Energy | null;
    gwp?: GWP | null;
    adpe?: ADPe | null;
    pe?: PE | null;
    wcf?: WCF | null;
    usage?: Usage | null;
    embodied?: Embodied | null;
    warnings?: WarningMessage[] | null;
    errors?: ErrorMessage[] | null;
}

export class ImpactsOutput {
    energy: Energy | null;
    gwp: GWP | null;
    adpe: ADPe | null;
    pe: PE | null;
    wcf: WCF | null;
    usage: Usage | null;
    embodied: Embodied | null;
    warnings: WarningMessage[] | null;
    errors: ErrorMessage[] | null;

    constructor(fields: ImpactsOutputFields = {}) {
        this.energy = fields.energy ?? null;
        this.gwp = fields.gwp ?? null;
        this.adpe = fields.adpe ?? null;
        this.pe = fields.pe ?? null;
        this.wcf = fields.wcf ?? null;
        this.usage = fields.usage ?? null;
        this.embodied = fields.embodied ?? null;
        this.warnings = fields.warnings ?? null;
        this.errors = fields.errors ?? null;
    }

    get hasWarnings(): boolean {
        return this.warnings !== null && this.warnings.length > 0;
    }

    get hasErrors(): boolean {
        return this.errors !== null && this.errors.length > 0;
    }

    addWarning(warning: WarningMessage): void {
        if (this.warnings === null) {
            this.warnings = [];
        }
        if (this.warnings.some((existing) => existing.code === warning.code)) {
            return;
        }
        this.warnings.push(warning);
    }

    addErrors(error: ErrorMessage): void {
        if (this.errors === null) {
            this.errors = [];
        }
        this.errors.push(error);
    }

    static fromImpacts(impacts: Impacts): ImpactsOutput {
        return new ImpactsOutput({
            energy: impacts.energy,
            gwp: impacts.gwp,
            adpe: impacts.adpe,
            pe: impacts.pe,
            wcf: impacts.wcf,
            usage: impacts.usage,
            embodied: impacts.embodied,
        });
    }

    /** Result carrying a single error and no impacts. */
    static fromError(error: ErrorMessage): ImpactsOutput {
        return new ImpactsOutput({ errors: [error] });
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
            warnings: this.warnings,
            errors: this.errors,
        };
    }
}

export interface ProviderConfig {
    /**
     * ISO 3166-1 alpha-3 zone of the provider's datacenter. Used as the default electricity
     * mix when the caller does not name one.
     */
    datacenterLocation: string | null;
    datacenterPue: ValueOrRange;
    datacenterWue: ValueOrRange;
}

export const PROVIDER_CONFIG_MAP: Readonly<Record<Providers, ProviderConfig>> = {
    anthropic: {
        datacenterLocation: "USA",
        datacenterPue: new RangeValue(1.09, 1.14),
        datacenterWue: new RangeValue(0.13, 0.999),
    },
    cohere: {
        datacenterLocation: "USA",
        datacenterPue: 1.09,
        datacenterWue: 0.999,
    },
    google_genai: {
        datacenterLocation: "USA",
        datacenterPue: 1.09,
        datacenterWue: 0.999,
    },
    huggingface_hub: {
        datacenterLocation: "USA",
        datacenterPue: new RangeValue(1.09, 1.14),
        datacenterWue: new RangeValue(0.13, 0.99),
    },
    mistralai: {
        datacenterLocation: "SWE",
        datacenterPue: 1.16,
        datacenterWue: 0.09,
    },
    openai: {
        datacenterLocation: "USA",
        datacenterPue: 1.2,
        datacenterWue: 0.569,
    },
};

/** Arguments of {@link llmImpacts}. */
export interface LlmImpactsParams {
    /** Provider the model belongs to, e.g. `"openai"`. */
    provider: string;
    /** Model name as reported by the API, e.g. `"gpt-4o-mini"`. */
    modelName: string;
    /** Number of generated tokens. */
    outputTokenCount: number;
    /** Measured request latency in seconds. */
    requestLatency: number;
    /**
     * ISO 3166-1 alpha-3 zone overriding the provider's datacenter location. Falls back to
     * the provider default, then to `"WOR"`.
     */
    electricityMixZone?: string | null;
}

export function llmImpacts(params: LlmImpactsParams): ImpactsOutput {
    const model = models.findModel(params.provider, params.modelName);
    if (model === undefined) {
        const error = new ModelNotRegisteredError(
            `Could not find model \`${params.modelName}\` for ${params.provider} provider.`,
        );
        logger.warningOnce(error.toString());
        return ImpactsOutput.fromError(error);
    }

    const parameters = model.architecture.parameters;
    const activeParameterCount = isParametersMoE(parameters) ? parameters.active : parameters;
    const totalParameterCount = isParametersMoE(parameters) ? parameters.total : parameters;

    const config = PROVIDER_CONFIG_MAP[model.provider];
    const zone = params.electricityMixZone ?? config.datacenterLocation ?? "WOR";

    const electricityMix = electricityMixes.findElectricityMix(zone);
    if (electricityMix === undefined) {
        const error = new ZoneNotRegisteredError(
            `Could not find electricity mix for \`${zone}\` zone.`,
        );
        logger.warningOnce(error.toString());
        return ImpactsOutput.fromError(error);
    }

    const impacts = ImpactsOutput.fromImpacts(
        computeLlmImpacts({
            modelActiveParameterCount: activeParameterCount,
            modelTotalParameterCount: totalParameterCount,
            outputTokenCount: params.outputTokenCount,
            requestLatency: params.requestLatency,
            ifElectricityMixAdpe: electricityMix.adpe,
            ifElectricityMixPe: electricityMix.pe,
            ifElectricityMixGwp: electricityMix.gwp,
            ifElectricityMixWue: electricityMix.wue,
            datacenterPue: config.datacenterPue,
            datacenterWue: config.datacenterWue,
            tps: model.deployment?.tps ?? null,
            ttft: model.deployment?.ttft ?? null,
        }),
    );

    for (const warning of model.warnings) {
        logger.warningOnce(warning.toString());
        impacts.addWarning(warning);
    }

    for (const warning of electricityMix.warnings) {
        logger.warningOnce(warning.toString());
        impacts.addWarning(warning);
    }

    return impacts;
}
