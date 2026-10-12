import { EcoLogitsValueError } from "../exceptions.js";
import { isRangeValue, RangeValue, type ValueOrRange } from "./range_value.js";

export function add(a: ValueOrRange, b: ValueOrRange): ValueOrRange {
    if (isRangeValue(a)) {
        return isRangeValue(b)
            ? new RangeValue(a.min + b.min, a.max + b.max)
            : new RangeValue(a.min + b, a.max + b);
    }
    return isRangeValue(b) ? new RangeValue(a + b.min, a + b.max) : a + b;
}

export function mul(a: ValueOrRange, b: ValueOrRange): ValueOrRange {
    if (isRangeValue(a)) {
        return isRangeValue(b)
            ? new RangeValue(a.min * b.min, a.max * b.max)
            : new RangeValue(a.min * b, a.max * b);
    }
    return isRangeValue(b) ? new RangeValue(a * b.min, a * b.max) : a * b;
}

export function div(a: ValueOrRange, b: ValueOrRange): ValueOrRange {
    if (isRangeValue(a)) {
        if (isRangeValue(b)) {
            throw new EcoLogitsValueError("RangeValue cannot be used as a divisor");
        }
        return new RangeValue(quotient(a.min, b), quotient(a.max, b));
    }
    if (isRangeValue(b)) {
        return new RangeValue(quotient(b.min, a), quotient(b.max, a));
    }
    return quotient(a, b);
}

function quotient(dividend: number, divisor: number): number {
    if (divisor === 0) {
        throw new RangeError("division by zero");
    }
    return dividend / divisor;
}

export function eq(a: ValueOrRange, b: ValueOrRange): boolean {
    if (isRangeValue(a)) {
        return isRangeValue(b) ? a.min === b.min && a.max === b.max : a.min === b && a.max === b;
    }
    return isRangeValue(b) ? b.min === a && b.max === a : a === b;
}

export function lte(a: ValueOrRange, b: ValueOrRange): boolean {
    if (isRangeValue(a)) {
        return isRangeValue(b) ? a.max <= b.max : a.max <= b;
    }
    return isRangeValue(b) ? b.min >= a : a <= b;
}

export function lt(a: ValueOrRange, b: ValueOrRange): boolean {
    if (isRangeValue(a)) {
        return isRangeValue(b) ? a.max < b.min : a.max < b;
    }
    return isRangeValue(b) ? b.min > a : a < b;
}

export function gte(a: ValueOrRange, b: ValueOrRange): boolean {
    if (isRangeValue(a)) {
        return isRangeValue(b) ? a.min >= b.min : a.min >= b;
    }
    return isRangeValue(b) ? b.max <= a : a >= b;
}

export function gt(a: ValueOrRange, b: ValueOrRange): boolean {
    if (isRangeValue(a)) {
        return isRangeValue(b) ? a.min > b.max : a.min > b;
    }
    return isRangeValue(b) ? b.max < a : a > b;
}

/** Lower bound of a `ValueOrRange`, for collapsing a range to its minimum. */
export function lowerBound(value: ValueOrRange): number {
    return isRangeValue(value) ? value.min : value;
}

/** Upper bound of a `ValueOrRange`, for collapsing a range to its maximum. */
export function upperBound(value: ValueOrRange): number {
    return isRangeValue(value) ? value.max : value;
}
