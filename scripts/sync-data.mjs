#!/usr/bin/env node
/**
 * Compiles the spec's model data into the TypeScript data modules.
 *
 * The data lives in the spec tree at `spec/data/`: `models.json`, `electricity_mixes.json`
 * and the `source.json` provenance file. It is the same data the Python package ships as
 * `ecologits/data/`, kept here so this package has no filesystem or network dependency at
 * runtime. The JSON is compiled to typed modules instead of being fetched on import, which
 * replaced an implementation that downloaded a stale `models.csv` over the network on
 * import and made the library unusable offline and in edge runtimes.
 *
 * Usage:
 *   node scripts/sync-data.mjs            # refresh spec/data from the Python checkout, then compile
 *   node scripts/sync-data.mjs --check    # verify the committed modules match spec/data
 *
 * The Python checkout is found at `../ecologits` by default, or at `$ECOLOGITS_PY_DIR`.
 *
 * `--check` needs no Python and is what CI runs, so the repository verifies itself. It is
 * fully deterministic: the modules are a pure function of the spec data and `source.json`,
 * so a re-run that changes nothing produces a byte-identical result. The informational sync
 * date lives only in `source.json` and in the `ECOLOGITS_SYNCED_AT` constant; regenerating
 * from a live Python checkout on a new day updates that one value.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const DATA_OUT_DIR = path.join(REPO_ROOT, "packages", "ecologits.js", "src", "data");
const SPEC_DATA_DIR = path.join(REPO_ROOT, "spec", "data");
const CHECK_ONLY = process.argv.includes("--check");

const DATA_FILES = ["models.json", "electricity_mixes.json"];
const SOURCE_FILE = "source.json";

/**
 * Reads the raw JSON data from a directory.
 * @param {string} dir
 */
function readData(dir) {
    /** @type {Record<string, unknown>} */
    const data = {};
    for (const name of DATA_FILES) {
        data[name] = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    }
    return data;
}

/**
 * Builds all generated module contents from the data plus a source descriptor.
 *
 * @param {Record<string, any>} data
 * @param {{ ecologitsVersion: string, gitSha: string | null, syncedAt: string }} source
 * @returns {Map<string, string>} file name -> file contents
 */
function generate(data, source) {
    const provenance = `ecologits v${source.ecologitsVersion}${source.gitSha ? ` (${source.gitSha.slice(0, 12)})` : ""}`;
    const banner = (what) =>
        [
            "/* eslint-disable */",
            "// AUTO-GENERATED FILE -- DO NOT EDIT.",
            `// ${what}`,
            "//",
            `// Source of truth: ${provenance}`,
            "// Regenerate with: npm run sync-data",
            "",
        ].join("\n");

    const emit = (bannerText, importName, exportName, typeName, value) =>
        `${banner(bannerText)}import type { ${typeName} } from "./schema.js";\n\n` +
        `export const ${exportName}: readonly ${typeName}[] = ${JSON.stringify(value, null, 2)};\n`;

    const models = data["models.json"];
    const mixes = data["electricity_mixes.json"];

    const files = new Map();
    files.set(
        "models.generated.ts",
        banner("LLM model registry, compiled from ecologits/data/models.json.") +
            `import type { AliasData, ModelData } from "./schema.js";\n\n` +
            `export const MODEL_ALIASES: readonly AliasData[] = ${JSON.stringify(models.aliases ?? [], null, 2)};\n\n` +
            `export const MODELS: readonly ModelData[] = ${JSON.stringify(models.models ?? [], null, 2)};\n`,
    );
    files.set(
        "electricity_mixes.generated.ts",
        emit(
            "Electricity mix impact factors, compiled from ecologits/data/electricity_mixes.json.",
            "ELECTRICITY_MIXES",
            "ELECTRICITY_MIXES",
            "ElectricityMixData",
            mixes.electricity_mixes ?? [],
        ),
    );
    files.set(
        "source.generated.ts",
        banner("Provenance of the vendored data.") +
            `/** Version of the Python package the vendored data was taken from. */\n` +
            `export const ECOLOGITS_VERSION = ${JSON.stringify(source.ecologitsVersion)};\n\n` +
            `/** Commit the vendored data was taken from, or null when unavailable. */\n` +
            `export const ECOLOGITS_GIT_SHA: string | null = ${JSON.stringify(source.gitSha)};\n\n` +
            `/** When the data was last vendored. Informational only; never affects the data modules. */\n` +
            `export const ECOLOGITS_SYNCED_AT = ${JSON.stringify(source.syncedAt)};\n`,
    );
    return files;
}

/**
 * Reads the Python package version out of `ecologits/__init__.py`.
 * @param {string} pyDir
 */
function readPythonVersion(pyDir) {
    const initPath = path.join(pyDir, "ecologits", "__init__.py");
    const match = /__version__\s*=\s*"([^"]+)"/.exec(readFileSync(initPath, "utf8"));
    if (!match) {
        throw new Error(`Could not find __version__ in ${initPath}`);
    }
    return match[1];
}

/**
 * Reads the current commit of the Python checkout.
 * @param {string} pyDir
 */
function readPythonGitSha(pyDir) {
    try {
        return execFileSync("git", ["-C", pyDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}

/**
 * Writes the files, or verifies them in check mode.
 * @param {Map<string, string>} files
 * @returns {boolean} true when everything is in sync
 */
function writeOrCheck(files) {
    mkdirSync(DATA_OUT_DIR, { recursive: true });
    let ok = true;
    for (const [name, content] of files) {
        const target = path.join(DATA_OUT_DIR, name);
        if (CHECK_ONLY) {
            const raw = existsSync(target) ? readFileSync(target, "utf8") : null;
            // Git may check these out with CRLF on Windows; compare line-ending agnostically.
            const existing = raw === null ? null : raw.replace(/\r\n/g, "\n");
            if (existing !== content) {
                console.error(
                    existing === null
                        ? `missing generated file: ${path.relative(REPO_ROOT, target)}`
                        : `out of date: ${path.relative(REPO_ROOT, target)}`,
                );
                ok = false;
            }
        } else {
            writeFileSync(target, content);
            console.log(`wrote ${path.relative(REPO_ROOT, target)}`);
        }
    }
    return ok;
}

function main() {
    if (CHECK_ONLY) {
        const source = JSON.parse(readFileSync(path.join(SPEC_DATA_DIR, SOURCE_FILE), "utf8"));
        const ok = writeOrCheck(generate(readData(SPEC_DATA_DIR), source));
        if (!ok) {
            console.error(
                "\nGenerated data is out of date. Run `npm run sync-data` and commit the result.",
            );
            process.exit(1);
        }
        console.log("Generated data is in sync with spec/data.");
        return;
    }

    const pyDir = process.env.ECOLOGITS_PY_DIR
        ? path.resolve(process.env.ECOLOGITS_PY_DIR)
        : path.resolve(REPO_ROOT, "..", "ecologits");
    const pyDataDir = path.join(pyDir, "ecologits", "data");
    if (!existsSync(pyDataDir)) {
        throw new Error(
            `Could not find the Python data directory at ${pyDataDir}.\n` +
                `Set ECOLOGITS_PY_DIR to the Python checkout, or run with --check to verify against the committed data.`,
        );
    }

    mkdirSync(SPEC_DATA_DIR, { recursive: true });
    for (const name of DATA_FILES) {
        writeFileSync(path.join(SPEC_DATA_DIR, name), readFileSync(path.join(pyDataDir, name)));
    }

    const source = {
        ecologitsVersion: readPythonVersion(pyDir),
        gitSha: readPythonGitSha(pyDir),
        syncedAt: new Date().toISOString().slice(0, 10),
    };
    writeFileSync(path.join(SPEC_DATA_DIR, SOURCE_FILE), `${JSON.stringify(source, null, 2)}\n`);

    const data = readData(SPEC_DATA_DIR);
    writeOrCheck(generate(data, source));

    const modelCount = (data["models.json"].models ?? []).length;
    const aliasCount = (data["models.json"].aliases ?? []).length;
    const mixCount = (data["electricity_mixes.json"].electricity_mixes ?? []).length;
    console.log(
        `\ncompiled ${modelCount} models, ${aliasCount} aliases and ${mixCount} electricity mixes from ${pyDir}`,
    );
}

main();
