import { EcoLogitsValueError } from "./exceptions.js";

/** Base URL of the documentation page explaining each code. */
export const STATUS_DOCS_URL = "https://ecologits.ai/tutorial/warnings_and_errors/#{code}";

/** Builds the documentation URL for a status code. */
export function statusDocUrl(code: string): string {
    return STATUS_DOCS_URL.replace("{code}", code);
}

/** Base class for a warning or an error attached to an impacts result. */
export abstract class StatusMessage {
    abstract readonly code: string;
    readonly message: string;

    protected constructor(message: string) {
        this.message = message;
    }

    toString(): string {
        return `${this.message} For further information visit ${statusDocUrl(this.code)}`;
    }

    toJSON(): { code: string; message: string } {
        return { code: this.code, message: this.message };
    }
}

/** Warning message. */
export abstract class WarningMessage extends StatusMessage {}

/** Error message. */
export abstract class ErrorMessage extends StatusMessage {}

export class ModelArchNotReleasedWarning extends WarningMessage {
    readonly code = "model-arch-not-released";

    constructor(message = "The model architecture has not been released, expect lower precision.") {
        super(message);
    }
}

export class ModelArchMultimodalWarning extends WarningMessage {
    readonly code = "model-arch-multimodal";

    constructor(message = "The model architecture is multimodal, expect lower precision.") {
        super(message);
    }
}

export class ElectricityMixADPeDefaultWarning extends WarningMessage {
    readonly code = "electricity-mix-adpe-world";

    constructor(
        message = "The electricity mix ADPe factor is using the world default value, expect lower precision.",
    ) {
        super(message);
    }
}

export class ElectricityMixPEDefaultWarning extends WarningMessage {
    readonly code = "electricity-mix-pe-world";

    constructor(
        message = "The electricity mix PE factor is using the world default value, expect lower precision.",
    ) {
        super(message);
    }
}

export class ElectricityMixWUEDefaultWarning extends WarningMessage {
    readonly code = "electricity-mix-wue-world";

    constructor(
        message = "The electricity mix WUE factor is using the world default value, expect lower precision.",
    ) {
        super(message);
    }
}

export class ModelNotRegisteredError extends ErrorMessage {
    readonly code = "model-not-registered";

    constructor(message = "The model is not registered in the model repository.") {
        super(message);
    }
}

export class ZoneNotRegisteredError extends ErrorMessage {
    readonly code = "zone-not-registered";

    constructor(message = "The zone is not registered.") {
        super(message);
    }
}

type WarningConstructor = new () => WarningMessage;
type ErrorConstructor = new () => ErrorMessage;

const WARNING_CODES: Readonly<Record<string, WarningConstructor>> = {
    "model-arch-not-released": ModelArchNotReleasedWarning,
    "model-arch-multimodal": ModelArchMultimodalWarning,
    "electricity-mix-adpe-world": ElectricityMixADPeDefaultWarning,
    "electricity-mix-pe-world": ElectricityMixPEDefaultWarning,
    "electricity-mix-wue-world": ElectricityMixWUEDefaultWarning,
};

const ERROR_CODES: Readonly<Record<string, ErrorConstructor>> = {
    "model-not-registered": ModelNotRegisteredError,
    "zone-not-registered": ZoneNotRegisteredError,
};

export function warningFromCode(code: string): WarningMessage {
    const WarningCtor = WARNING_CODES[code];
    if (WarningCtor === undefined) {
        throw new EcoLogitsValueError(`Warning code \`${code}\` does not exist.`);
    }
    return new WarningCtor();
}

export function errorFromCode(code: string): ErrorMessage {
    const ErrorCtor = ERROR_CODES[code];
    if (ErrorCtor === undefined) {
        throw new EcoLogitsValueError(`Error code \`${code}\` does not exist.`);
    }
    return new ErrorCtor();
}
