import { EcoLogitsValueError, ModelingError } from "../exceptions.js";
import { add, div, lowerBound, lt, mul, upperBound } from "../utils/arithmetic.js";
import { isRangeValue, RangeValue, type ValueOrRange } from "../utils/range_value.js";
import { DAG } from "./dag.js";
import { ADPe, Embodied, Energy, GWP, Impacts, PE, Usage, WCF } from "./modeling.js";

export const MODEL_QUANTIZATION_BITS = 16;

export const GPU_ENERGY_ALPHA = 1.1665273170451914e-6;
export const GPU_ENERGY_BETA = -0.011205921025579175;
export const GPU_ENERGY_GAMMA = 4.052928146734005e-5;

export const LATENCY_ALPHA = 0.0006785088094353663;
export const LATENCY_BETA = 0.0003119310311688259;
export const LATENCY_GAMMA = 0.019473717579473387;

/** Memory available on a single GPU, in GB. */
export const GPU_MEMORY = 80;
export const GPU_EMBODIED_IMPACT_GWP = 273;
export const GPU_EMBODIED_IMPACT_ADPE = 0.00895;
export const GPU_EMBODIED_IMPACT_PE = 3721;

/** GPUs installed in the reference server. */
export const SERVER_GPUS = 8;
/** Power draw of the server excluding GPUs, in kW. */
export const SERVER_POWER = 1.2;
export const SERVER_EMBODIED_IMPACT_GWP = 5700;
export const SERVER_EMBODIED_IMPACT_ADPE = 0.37;
export const SERVER_EMBODIED_IMPACT_PE = 70000;

/** Hardware service life in seconds: 3 years. */
export const HARDWARE_LIFESPAN = 3 * 365 * 24 * 60 * 60;

/** Requests assumed to be handled concurrently by the server. */
export const BATCH_SIZE = 64;

const num = (value: unknown): number => value as number;
const vor = (value: unknown): ValueOrRange => value as ValueOrRange;

function requireNumber(value: ValueOrRange): number {
    if (isRangeValue(value)) {
        throw new TypeError(`Expected a scalar but received a range: ${value.toString()}`);
    }
    return value;
}

const dag = new DAG();

dag.asset({
    name: "gpu_energy",
    deps: [
        "model_active_parameter_count",
        "output_token_count",
        "batch_size",
        "gpu_energy_alpha",
        "gpu_energy_beta",
        "gpu_energy_gamma",
    ],
    compute: ({
        model_active_parameter_count: activeParameterCount,
        output_token_count: outputTokenCount,
        batch_size: batchSize,
        gpu_energy_alpha: gpuEnergyAlpha,
        gpu_energy_beta: gpuEnergyBeta,
        gpu_energy_gamma: gpuEnergyGamma,
    }) => {
        const scale = num(gpuEnergyAlpha) * Math.exp(num(gpuEnergyBeta) * num(batchSize));
        // alpha * exp(beta * batch) * active + gamma, converted from Wh to kWh.
        const energyPerToken = div(
            add(mul(scale, vor(activeParameterCount)), num(gpuEnergyGamma)),
            1000,
        );
        return mul(num(outputTokenCount), energyPerToken);
    },
});

dag.asset({
    name: "generation_latency",
    deps: [
        "model_active_parameter_count",
        "output_token_count",
        "batch_size",
        "latency_alpha",
        "latency_beta",
        "latency_gamma",
        "request_latency",
        "tps",
        "ttft",
    ],
    compute: ({
        model_active_parameter_count: activeParameterCount,
        output_token_count: outputTokenCount,
        batch_size: batchSize,
        latency_alpha: latencyAlpha,
        latency_beta: latencyBeta,
        latency_gamma: latencyGamma,
        request_latency: requestLatency,
        tps,
        ttft,
    }) => {
        // A published tokens-per-second figure supersedes the regression entirely.
        let latencyPerToken: ValueOrRange;
        if (tps === null || tps === undefined) {
            latencyPerToken = add(
                add(
                    mul(num(latencyAlpha), vor(activeParameterCount)),
                    num(latencyBeta) * num(batchSize),
                ),
                num(latencyGamma),
            );
        } else if (num(tps) === 0) {
            throw new ModelingError(
                "Cannot derive a latency from tps = 0; the deployment data for this model is invalid. " +
                    "The Python implementation raises ZeroDivisionError for the same input.",
            );
        } else {
            latencyPerToken = 1 / num(tps);
        }

        const firstTokenLatency = ttft === null || ttft === undefined ? 0 : num(ttft);
        const gpuLatency = add(mul(num(outputTokenCount), latencyPerToken), firstTokenLatency);

        // Never claim more time than the request actually took.
        return lt(num(requestLatency), gpuLatency) ? num(requestLatency) : gpuLatency;
    },
});

dag.asset({
    name: "model_required_memory",
    deps: ["model_total_parameter_count", "model_quantization_bits"],
    compute: ({
        model_total_parameter_count: totalParameterCount,
        model_quantization_bits: quantizationBits,
    }) => div(mul(mul(1.2, vor(totalParameterCount)), num(quantizationBits)), 8),
});

dag.asset({
    name: "gpu_required_count",
    deps: ["model_required_memory", "gpu_memory"],
    compute: ({ model_required_memory: requiredMemory, gpu_memory: gpuMemory }) => {
        const gpuCount = Math.ceil(requireNumber(div(vor(requiredMemory), num(gpuMemory))));
        // A non-positive count makes Python's `math.log2` raise `ValueError`, and a non-finite
        // one makes `math.ceil` raise `OverflowError`. JavaScript would instead evaluate the
        // expression below to `NaN` or `Infinity` and propagate it, so refuse both here rather
        // than return a number the reference never produces.
        if (!(gpuCount >= 1) || !Number.isFinite(gpuCount)) {
            throw new EcoLogitsValueError(
                "Cannot size the GPU set: the required GPU count must be a positive, finite " +
                    "number. The Python implementation raises for the same input.",
            );
        }
        return 2 ** Math.ceil(Math.log2(gpuCount)); // Round up in base two.
    },
});

dag.asset({
    name: "server_energy",
    deps: [
        "generation_latency",
        "server_power",
        "server_gpu_count",
        "gpu_required_count",
        "batch_size",
    ],
    compute: ({
        generation_latency: generationLatency,
        server_power: serverPower,
        server_gpu_count: serverGpuCount,
        gpu_required_count: gpuRequiredCount,
        batch_size: batchSize,
    }) => {
        const perHour = div(vor(generationLatency), 3600);
        const gpuRatio = num(gpuRequiredCount) / num(serverGpuCount);
        return mul(mul(mul(perHour, num(serverPower)), gpuRatio), 1 / num(batchSize));
    },
});

dag.asset({
    name: "request_it_energy",
    deps: ["server_energy", "gpu_required_count", "gpu_energy"],
    compute: ({
        server_energy: serverEnergy,
        gpu_required_count: gpuRequiredCount,
        gpu_energy: gpuEnergy,
    }) => add(vor(serverEnergy), mul(num(gpuRequiredCount), vor(gpuEnergy))),
});

dag.asset({
    name: "request_energy",
    deps: ["datacenter_pue", "request_it_energy"],
    compute: ({ datacenter_pue: datacenterPue, request_it_energy: requestItEnergy }) =>
        mul(vor(datacenterPue), vor(requestItEnergy)),
});

dag.asset({
    name: "request_usage_gwp",
    deps: ["request_energy", "if_electricity_mix_gwp"],
    compute: ({ request_energy: requestEnergy, if_electricity_mix_gwp: factor }) =>
        mul(vor(requestEnergy), num(factor)),
});

dag.asset({
    name: "request_usage_adpe",
    deps: ["request_energy", "if_electricity_mix_adpe"],
    compute: ({ request_energy: requestEnergy, if_electricity_mix_adpe: factor }) =>
        mul(vor(requestEnergy), num(factor)),
});

dag.asset({
    name: "request_usage_pe",
    deps: ["request_energy", "if_electricity_mix_pe"],
    compute: ({ request_energy: requestEnergy, if_electricity_mix_pe: factor }) =>
        mul(vor(requestEnergy), num(factor)),
});

dag.asset({
    name: "request_usage_wcf",
    deps: ["request_it_energy", "if_electricity_mix_wue", "datacenter_wue", "datacenter_pue"],
    compute: ({
        request_it_energy: requestItEnergy,
        if_electricity_mix_wue: electricityMixWue,
        datacenter_wue: datacenterWue,
        datacenter_pue: datacenterPue,
    }) =>
        // On-site water, plus the water consumed upstream to supply the datacenter's own draw.
        mul(
            vor(requestItEnergy),
            add(vor(datacenterWue), mul(vor(datacenterPue), num(electricityMixWue))),
        ),
});

dag.asset({
    name: "server_gpu_embodied_gwp",
    deps: ["server_embodied_gwp", "server_gpu_count", "gpu_embodied_gwp", "gpu_required_count"],
    compute: ({
        server_embodied_gwp: serverEmbodiedGwp,
        server_gpu_count: serverGpuCount,
        gpu_embodied_gwp: gpuEmbodiedGwp,
        gpu_required_count: gpuRequiredCount,
    }) =>
        add(
            mul(num(gpuRequiredCount) / num(serverGpuCount), num(serverEmbodiedGwp)),
            mul(num(gpuRequiredCount), num(gpuEmbodiedGwp)),
        ),
});

dag.asset({
    name: "server_gpu_embodied_adpe",
    deps: ["server_embodied_adpe", "server_gpu_count", "gpu_embodied_adpe", "gpu_required_count"],
    compute: ({
        server_embodied_adpe: serverEmbodiedAdpe,
        server_gpu_count: serverGpuCount,
        gpu_embodied_adpe: gpuEmbodiedAdpe,
        gpu_required_count: gpuRequiredCount,
    }) =>
        add(
            mul(num(gpuRequiredCount) / num(serverGpuCount), num(serverEmbodiedAdpe)),
            mul(num(gpuRequiredCount), num(gpuEmbodiedAdpe)),
        ),
});

dag.asset({
    name: "server_gpu_embodied_pe",
    deps: ["server_embodied_pe", "server_gpu_count", "gpu_embodied_pe", "gpu_required_count"],
    compute: ({
        server_embodied_pe: serverEmbodiedPe,
        server_gpu_count: serverGpuCount,
        gpu_embodied_pe: gpuEmbodiedPe,
        gpu_required_count: gpuRequiredCount,
    }) =>
        add(
            mul(num(gpuRequiredCount) / num(serverGpuCount), num(serverEmbodiedPe)),
            mul(num(gpuRequiredCount), num(gpuEmbodiedPe)),
        ),
});

dag.asset({
    name: "request_embodied_gwp",
    deps: ["server_gpu_embodied_gwp", "server_lifetime", "generation_latency", "batch_size"],
    compute: ({
        server_gpu_embodied_gwp: serverGpuEmbodiedGwp,
        server_lifetime: serverLifetime,
        generation_latency: generationLatency,
        batch_size: batchSize,
    }) =>
        // Time-share of the hardware's embodied impact, split across the batch.
        div(
            mul(vor(generationLatency), num(serverGpuEmbodiedGwp)),
            num(serverLifetime) * num(batchSize),
        ),
});

dag.asset({
    name: "request_embodied_adpe",
    deps: ["server_gpu_embodied_adpe", "server_lifetime", "generation_latency", "batch_size"],
    compute: ({
        server_gpu_embodied_adpe: serverGpuEmbodiedAdpe,
        server_lifetime: serverLifetime,
        generation_latency: generationLatency,
        batch_size: batchSize,
    }) =>
        div(
            mul(vor(generationLatency), num(serverGpuEmbodiedAdpe)),
            num(serverLifetime) * num(batchSize),
        ),
});

dag.asset({
    name: "request_embodied_pe",
    deps: ["server_gpu_embodied_pe", "server_lifetime", "generation_latency", "batch_size"],
    compute: ({
        server_gpu_embodied_pe: serverGpuEmbodiedPe,
        server_lifetime: serverLifetime,
        generation_latency: generationLatency,
        batch_size: batchSize,
    }) =>
        div(
            mul(vor(generationLatency), num(serverGpuEmbodiedPe)),
            num(serverLifetime) * num(batchSize),
        ),
});

/** Every coefficient the graph accepts, all optional and defaulted to the constants above. */
export interface LlmImpactCoefficients {
    modelQuantizationBits?: number;
    gpuEnergyAlpha?: number;
    gpuEnergyBeta?: number;
    gpuEnergyGamma?: number;
    latencyAlpha?: number;
    latencyBeta?: number;
    latencyGamma?: number;
    gpuMemory?: number;
    gpuEmbodiedGwp?: number;
    gpuEmbodiedAdpe?: number;
    gpuEmbodiedPe?: number;
    serverGpuCount?: number;
    serverPower?: number;
    serverEmbodiedGwp?: number;
    serverEmbodiedAdpe?: number;
    serverEmbodiedPe?: number;
    serverLifetime?: number;
    batchSize?: number;
}

/** Inputs of {@link computeLlmImpactsDag}. */
export interface ComputeLlmImpactsDagParams extends LlmImpactCoefficients {
    modelActiveParameterCount: ValueOrRange;
    modelTotalParameterCount: ValueOrRange;
    outputTokenCount: number;
    requestLatency: number;
    ifElectricityMixAdpe: number;
    ifElectricityMixPe: number;
    ifElectricityMixGwp: number;
    ifElectricityMixWue: number;
    datacenterPue: ValueOrRange;
    datacenterWue: ValueOrRange;
    /** Published generation speed in tokens per second; supersedes the latency regression. */
    tps?: number | null;
    /** Time to first token in seconds. */
    ttft?: number | null;
    assets?: Readonly<Record<string, unknown>>;
}

export function computeLlmImpactsDag(
    params: ComputeLlmImpactsDagParams,
): Record<string, ValueOrRange> {
    const inputs: Record<string, unknown> = {
        model_active_parameter_count: params.modelActiveParameterCount,
        model_total_parameter_count: params.modelTotalParameterCount,
        model_quantization_bits: params.modelQuantizationBits ?? MODEL_QUANTIZATION_BITS,
        output_token_count: params.outputTokenCount,
        request_latency: params.requestLatency,
        tps: params.tps ?? null,
        ttft: params.ttft ?? null,
        if_electricity_mix_gwp: params.ifElectricityMixGwp,
        if_electricity_mix_adpe: params.ifElectricityMixAdpe,
        if_electricity_mix_pe: params.ifElectricityMixPe,
        if_electricity_mix_wue: params.ifElectricityMixWue,
        datacenter_wue: params.datacenterWue,
        datacenter_pue: params.datacenterPue,
        gpu_energy_alpha: params.gpuEnergyAlpha ?? GPU_ENERGY_ALPHA,
        gpu_energy_beta: params.gpuEnergyBeta ?? GPU_ENERGY_BETA,
        gpu_energy_gamma: params.gpuEnergyGamma ?? GPU_ENERGY_GAMMA,
        latency_alpha: params.latencyAlpha ?? LATENCY_ALPHA,
        latency_beta: params.latencyBeta ?? LATENCY_BETA,
        latency_gamma: params.latencyGamma ?? LATENCY_GAMMA,
        gpu_memory: params.gpuMemory ?? GPU_MEMORY,
        gpu_embodied_gwp: params.gpuEmbodiedGwp ?? GPU_EMBODIED_IMPACT_GWP,
        gpu_embodied_adpe: params.gpuEmbodiedAdpe ?? GPU_EMBODIED_IMPACT_ADPE,
        gpu_embodied_pe: params.gpuEmbodiedPe ?? GPU_EMBODIED_IMPACT_PE,
        server_gpu_count: params.serverGpuCount ?? SERVER_GPUS,
        server_power: params.serverPower ?? SERVER_POWER,
        server_embodied_gwp: params.serverEmbodiedGwp ?? SERVER_EMBODIED_IMPACT_GWP,
        server_embodied_adpe: params.serverEmbodiedAdpe ?? SERVER_EMBODIED_IMPACT_ADPE,
        server_embodied_pe: params.serverEmbodiedPe ?? SERVER_EMBODIED_IMPACT_PE,
        server_lifetime: params.serverLifetime ?? HARDWARE_LIFESPAN,
        batch_size: params.batchSize ?? BATCH_SIZE,
        ...params.assets,
    };

    // The DAG is dynamically typed by construction: every value stored under an asset name is
    // either a scalar or a RangeValue.
    return dag.execute(inputs) as Record<string, ValueOrRange>;
}

const RANGE_FIELDS = [
    "request_energy",
    "request_usage_gwp",
    "request_usage_adpe",
    "request_usage_pe",
    "request_usage_wcf",
    "request_embodied_gwp",
    "request_embodied_adpe",
    "request_embodied_pe",
] as const;

/** Inputs of {@link computeLlmImpacts}. */
export interface ComputeLlmImpactsParams extends LlmImpactCoefficients {
    modelActiveParameterCount: ValueOrRange;
    modelTotalParameterCount: ValueOrRange;
    outputTokenCount: number;
    ifElectricityMixAdpe: number;
    ifElectricityMixPe: number;
    ifElectricityMixGwp: number;
    ifElectricityMixWue: number;
    datacenterPue: ValueOrRange;
    datacenterWue: ValueOrRange;
    /** Measured request latency in seconds. Omitted means unbounded. */
    requestLatency?: number | null;
    tps?: number | null;
    ttft?: number | null;
    /** Extra DAG inputs, merged last. See {@link ComputeLlmImpactsDagParams.assets}. */
    assets?: Readonly<Record<string, unknown>>;
}

export function computeLlmImpacts(params: ComputeLlmImpactsParams): Impacts {
    const requestLatency = params.requestLatency ?? Number.POSITIVE_INFINITY;
    const activeParameterCount = params.modelActiveParameterCount;
    const totalParameterCount = params.modelTotalParameterCount;

    let activeParams: readonly ValueOrRange[] = [activeParameterCount];
    let totalParams: readonly ValueOrRange[] = [totalParameterCount];
    if (isRangeValue(activeParameterCount) || isRangeValue(totalParameterCount)) {
        activeParams = isRangeValue(activeParameterCount)
            ? [activeParameterCount.min, activeParameterCount.max]
            : [activeParameterCount, activeParameterCount];
        totalParams = isRangeValue(totalParameterCount)
            ? [totalParameterCount.min, totalParameterCount.max]
            : [totalParameterCount, totalParameterCount];
    }

    const results = new Map<string, ValueOrRange>();

    for (let index = 0; index < activeParams.length; index += 1) {
        const pass = computeLlmImpactsDag({
            ...params,
            modelActiveParameterCount: activeParams[index] as ValueOrRange,
            modelTotalParameterCount: totalParams[index] as ValueOrRange,
            requestLatency,
            tps: params.tps ?? null,
            ttft: params.ttft ?? null,
        });

        for (const field of RANGE_FIELDS) {
            const value = pass[field];
            if (value === undefined) {
                throw new ModelingError(`DAG did not produce \`${field}\``);
            }
            const existing = results.get(field);
            if (existing === undefined) {
                results.set(field, value);
            } else {
                results.set(field, new RangeValue(lowerBound(existing), upperBound(value)));
            }
        }
    }

    const at = (field: (typeof RANGE_FIELDS)[number]): ValueOrRange => {
        const value = results.get(field);
        if (value === undefined) {
            throw new ModelingError(`Missing DAG result: \`${field}\``);
        }
        return value;
    };

    const energy = new Energy(at("request_energy"));
    const usageGwp = new GWP(at("request_usage_gwp"));
    const usageAdpe = new ADPe(at("request_usage_adpe"));
    const usagePe = new PE(at("request_usage_pe"));
    const usageWcf = new WCF(at("request_usage_wcf"));
    const embodiedGwp = new GWP(at("request_embodied_gwp"));
    const embodiedAdpe = new ADPe(at("request_embodied_adpe"));
    const embodiedPe = new PE(at("request_embodied_pe"));

    return new Impacts({
        energy,
        gwp: usageGwp.add(embodiedGwp),
        adpe: usageAdpe.add(embodiedAdpe),
        pe: usagePe.add(embodiedPe),
        wcf: usageWcf,
        usage: new Usage({
            energy,
            gwp: usageGwp,
            adpe: usageAdpe,
            pe: usagePe,
            wcf: usageWcf,
        }),
        embodied: new Embodied({ gwp: embodiedGwp, adpe: embodiedAdpe, pe: embodiedPe }),
    });
}
