#!/usr/bin/env node
/**
 * Validates the spec artefacts and the spec data against the JSON Schemas in
 * `spec/schema/`.
 *
 * Three things are checked, none of which need network or Python:
 *
 * - `spec/data/models.json` and `spec/data/electricity_mixes.json` conform to the data
 *   schemas, so a malformed drop fails here rather than at runtime.
 * - `spec/manifest.json` conforms to the manifest schema.
 * - every vector the manifest lists exists and declares the matching `kind`.
 *
 * `npm test` replays the vector values; this script checks their structure and provenance.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/** @param {string} filePath */
function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: true });

/** @type {readonly [string, string][]} schema file -> data file, both relative to the repo root. */
const CHECKS = [
    ["spec/schema/models.schema.json", "spec/data/models.json"],
    ["spec/schema/electricity_mixes.schema.json", "spec/data/electricity_mixes.json"],
    ["spec/schema/manifest.schema.json", "spec/manifest.json"],
];

let failed = false;

for (const [schemaRel, dataRel] of CHECKS) {
    const schema = readJson(path.join(REPO_ROOT, schemaRel));
    const data = readJson(path.join(REPO_ROOT, dataRel));
    const validate = ajv.compile(schema);
    if (!validate(data)) {
        failed = true;
        console.error(`${dataRel} does not conform to ${schemaRel}:`);
        for (const error of validate.errors ?? []) {
            console.error(`  ${error.instancePath || "/"} ${error.message ?? ""}`);
        }
    }
}

// Existence is outside the manifest schema's reach, so check it here.
const manifest = readJson(path.join(REPO_ROOT, "spec", "manifest.json"));

// `SPEC.md` §2 makes `spec/VERSION` authoritative and `manifest.specVersion` a restatement of
// it. Only the generator writes the manifest, so nothing else would notice the two drifting.
const versionFile = readFileSync(path.join(REPO_ROOT, "spec", "VERSION"), "utf8").trim();
if (versionFile !== manifest.specVersion) {
    failed = true;
    console.error(
        `spec/VERSION declares "${versionFile}" but manifest.json declares ` +
            `specVersion "${manifest.specVersion}"`,
    );
}

for (const vector of manifest.vectors) {
    const vectorPath = path.join(REPO_ROOT, "spec", vector.path);
    if (!existsSync(vectorPath)) {
        failed = true;
        console.error(`manifest lists a missing vector: ${vector.path}`);
        continue;
    }
    const file = readJson(vectorPath);
    if (file.kind !== vector.kind) {
        failed = true;
        console.error(
            `${vector.path} declares kind "${file.kind}" but the manifest expects "${vector.kind}"`,
        );
    }
}

if (failed) {
    process.exit(1);
}
console.log(
    `Spec artefacts conform to spec/schema (spec ${manifest.specVersion}, reference ` +
        `${manifest.reference.implementation} ${manifest.reference.version}).`,
);
