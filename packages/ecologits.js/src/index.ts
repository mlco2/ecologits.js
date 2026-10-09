export {
    computeLlmImpacts,
    computeLlmImpactsDag,
    MODEL_QUANTIZATION_BITS,
    GPU_ENERGY_ALPHA,
    GPU_ENERGY_BETA,
    GPU_ENERGY_GAMMA,
    LATENCY_ALPHA,
    LATENCY_BETA,
    LATENCY_GAMMA,
    GPU_MEMORY,
    GPU_EMBODIED_IMPACT_GWP,
    GPU_EMBODIED_IMPACT_ADPE,
    GPU_EMBODIED_IMPACT_PE,
    SERVER_GPUS,
    SERVER_POWER,
    SERVER_EMBODIED_IMPACT_GWP,
    SERVER_EMBODIED_IMPACT_ADPE,
    SERVER_EMBODIED_IMPACT_PE,
    HARDWARE_LIFESPAN,
    BATCH_SIZE,
} from "./impacts/llm.js";
export type {
    ComputeLlmImpactsParams,
    ComputeLlmImpactsDagParams,
    LlmImpactCoefficients,
} from "./impacts/llm.js";

export {
    ADPe,
    BaseImpact,
    Embodied,
    Energy,
    GWP,
    Impacts,
    PE,
    Usage,
    WCF,
} from "./impacts/modeling.js";
export type { ImpactType, Phase } from "./impacts/modeling.js";

export { DAG } from "./impacts/dag.js";
export type { AssetCompute, AssetDefinition, AssetInputs } from "./impacts/dag.js";

export {
    ARCHITECTURE_TYPES,
    isParametersMoE,
    Model,
    ModelRepository,
    models,
    PROVIDERS,
} from "./model_repository.js";
export type {
    Architecture,
    ArchitectureTypes,
    Deployment,
    ParametersMoE,
    Providers,
} from "./model_repository.js";

export {
    ElectricityMix,
    ElectricityMixRepository,
    electricityMixes,
} from "./electricity_mix_repository.js";

export { add, div, eq, gt, gte, lowerBound, lt, lte, mul, upperBound } from "./utils/arithmetic.js";
export { isRangeValue, RangeValue } from "./utils/range_value.js";
export type { ValueOrRange } from "./utils/range_value.js";

export {
    ElectricityMixADPeDefaultWarning,
    ElectricityMixPEDefaultWarning,
    ElectricityMixWUEDefaultWarning,
    ErrorMessage,
    errorFromCode,
    ModelArchMultimodalWarning,
    ModelArchNotReleasedWarning,
    ModelNotRegisteredError,
    STATUS_DOCS_URL,
    StatusMessage,
    statusDocUrl,
    WarningMessage,
    warningFromCode,
    ZoneNotRegisteredError,
} from "./status_messages.js";

export {
    EcoLogitsError,
    EcoLogitsValueError,
    ModelingError,
    TracerInitializationError,
} from "./exceptions.js";

export { EcoLogitsLogger, logger } from "./log.js";
export type { LogLevel, LogSink } from "./log.js";

export { ImpactsOutput, llmImpacts, PROVIDER_CONFIG_MAP } from "./tracers/utils.js";
export type { ImpactsOutputFields, LlmImpactsParams, ProviderConfig } from "./tracers/utils.js";

export {
    ECOLOGITS_GIT_SHA,
    ECOLOGITS_SYNCED_AT,
    ECOLOGITS_VERSION,
} from "./data/source.generated.js";
