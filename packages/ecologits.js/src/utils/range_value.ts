import { EcoLogitsValueError } from "../exceptions.js";

function pythonFloatRepr(value: number): string {
    if (Number.isNaN(value)) {
        return "nan";
    }
    if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
        return value > 0 ? "inf" : "-inf";
    }
    if (value === 0) {
        return Object.is(value, -0) ? "-0.0" : "0.0";
    }

    const sign = value < 0 ? "-" : "";
    // e.g. 1.5e-5 -> mantissa "1.5", exponent -5, significant digits "15".
    const [mantissa, exponentText] = Math.abs(value).toExponential().split("e");
    const digits = mantissa.replace(".", "");
    const pointPosition = Number(exponentText) + 1;

    if (pointPosition <= -4 || pointPosition > 16) {
        const fraction = digits.length > 1 ? `.${digits.slice(1)}` : "";
        const exponentSign = pointPosition - 1 < 0 ? "-" : "+";
        const exponentMagnitude = Math.abs(pointPosition - 1)
            .toString()
            .padStart(2, "0");
        return `${sign}${digits[0]}${fraction}e${exponentSign}${exponentMagnitude}`;
    }

    let body: string;
    if (pointPosition <= 0) {
        body = `0.${"0".repeat(-pointPosition)}${digits}`;
    } else if (pointPosition >= digits.length) {
        body = `${digits}${"0".repeat(pointPosition - digits.length)}.0`;
    } else {
        body = `${digits.slice(0, pointPosition)}.${digits.slice(pointPosition)}`;
    }
    return `${sign}${body}`;
}

export class RangeValue {
    readonly min: number;
    readonly max: number;

    constructor(min: number, max: number) {
        if (min > max) {
            throw new EcoLogitsValueError("min value must be lower than max value");
        }
        this.min = min;
        this.max = max;
    }

    /** Midpoint of the interval: `(min + max) / 2`. */
    get mean(): number {
        return (this.min + this.max) / 2;
    }

    toString(): string {
        return `${pythonFloatRepr(this.mean)} [${pythonFloatRepr(this.min)} - ${pythonFloatRepr(this.max)}]`;
    }

    toJSON(): { min: number; max: number } {
        return { min: this.min, max: this.max };
    }
}

export type ValueOrRange = number | RangeValue;

/** Runtime guard for the `ValueOrRange` union. */
export function isRangeValue(value: unknown): value is RangeValue {
    return value instanceof RangeValue;
}
