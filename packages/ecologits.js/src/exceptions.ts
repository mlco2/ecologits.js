export class EcoLogitsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

/** Tracer is initialized twice. */
export class TracerInitializationError extends EcoLogitsError {}

/** Operation or computation not allowed. */
export class ModelingError extends EcoLogitsError {}

export class EcoLogitsValueError extends EcoLogitsError {}
