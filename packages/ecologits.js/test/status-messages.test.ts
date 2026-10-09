import { describe, expect, it } from "vitest";
import { errorFromCode, warningFromCode } from "../src/index.js";
import { readVector } from "./helpers.js";

/**
 * Parity for the warning and error catalogue.
 *
 * Codes are part of the public contract: they appear in the documentation URL, in the model
 * and electricity-mix data files, and in the `warnings` array of a result. The vector
 * records the exact code, message, class name and rendered string for every entry, so a
 * renamed code or a reworded message fails here rather than surprising a downstream caller.
 */

interface MessageEntry {
    code: string;
    className: string;
    message: string;
    str: string;
    dump: { code: string; message: string };
}

interface UnknownCase {
    kind: "warning" | "error";
    code: string;
    error: string | null;
}

interface StatusMessagesVector {
    warnings: MessageEntry[];
    errors: MessageEntry[];
    unknown: UnknownCase[];
}

const vector = readVector<StatusMessagesVector>("status-messages.json");

describe("status message parity with Python", () => {
    it("has the same catalogue size as upstream", () => {
        expect(vector.warnings).toHaveLength(5);
        expect(vector.errors).toHaveLength(2);
    });

    for (const entry of vector.warnings) {
        it(`warning ${entry.code}`, () => {
            const message = warningFromCode(entry.code);
            expect(message.constructor.name).toBe(entry.className);
            expect(message.code).toBe(entry.code);
            expect(message.message).toBe(entry.message);
            expect(message.toString()).toBe(entry.str);
            expect(message.toJSON()).toEqual(entry.dump);
        });
    }

    for (const entry of vector.errors) {
        it(`error ${entry.code}`, () => {
            const message = errorFromCode(entry.code);
            expect(message.constructor.name).toBe(entry.className);
            expect(message.code).toBe(entry.code);
            expect(message.message).toBe(entry.message);
            expect(message.toString()).toBe(entry.str);
            expect(message.toJSON()).toEqual(entry.dump);
        });
    }

    for (const item of vector.unknown) {
        it(`rejects unknown ${item.kind} code ${JSON.stringify(item.code)}`, () => {
            const lookup = item.kind === "warning" ? warningFromCode : errorFromCode;
            expect(() => lookup(item.code)).toThrow();
        });
    }

    it("appends the documentation URL to the rendered message", () => {
        const message = warningFromCode("model-arch-multimodal");
        expect(message.toString()).toContain("https://ecologits.ai/tutorial/warnings_and_errors/");
        expect(message.toString()).toContain("#model-arch-multimodal");
    });
});
