#!/usr/bin/env python3
"""
Generate the conformance vectors for the EcoLogits spec from the Python implementation.

The spec (``SPEC.md``) defines the observable contract; these vectors are its conformance
suite. Every expected value is produced by the real Python implementation, so
implementations are validated against upstream rather than against hand-written numbers
that could encode the same misunderstanding twice.

This script lives in the spec tree (``spec/scripts/``), which is intended to become a
standalone repository consumed by both ``mlco2/ecologits`` and ``mlco2/ecologits.js``.

Usage::

    python spec/scripts/generate-vectors.py [--python-dir PATH] [--spec PATH] [--package PATH]

``--python-dir`` defaults to ``$ECOLOGITS_PY_DIR`` or a sibling ``ecologits`` checkout of
https://github.com/mlco2/ecologits.

Contract vectors are written under ``spec/vectors/`` alongside the manifest, which records
the spec version and the reference implementation they came from. The arithmetic and
impact-comparison vectors pin the port's internal semantics rather than spec surface: they
are written into the consumer package (``<consumer>/packages/ecologits.js/test/vectors/``)
when it is present, and skipped when the spec tree is used standalone.

Vectors are committed, and regenerating them is expected to be a no-op only while the
Python checkout sits at the commit recorded in ``manifest.json``. Regeneration is a local
step: CI has no access to the Python repository, so it validates the committed vectors
instead by running the test suite and ``npm run check-spec``.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
# The spec tree: this script lives in <spec>/scripts, so its parent is the spec root.
SPEC_ROOT = HERE.parent
# The consumer repository, which mounts the spec tree at <consumer>/spec. The spec tree is
# also usable standalone, in which case the implementation vectors are skipped.
CONSUMER_ROOT = SPEC_ROOT.parent

# Ordered so the diff of a regenerated fixture stays readable.
TOKEN_LATENCY_CASES = [
    (200, 5.0),
    (1000, 30.0),
]


DEFAULT_SPEC_VERSION = "0.1.0"

# Contract vectors: the observable behaviour the spec promises.
CONTRACT_VECTOR_KINDS = ("estimator", "high-level", "repository", "status-messages")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--python-dir",
        default=os.environ.get(
            "ECOLOGITS_PY_DIR", str(CONSUMER_ROOT.parent / "ecologits")
        ),
        help="Path to the Python ecologits checkout.",
    )
    parser.add_argument(
        "--spec",
        default=str(SPEC_ROOT),
        help="Directory holding the spec, its manifest and the contract vectors.",
    )
    parser.add_argument(
        "--package",
        default=str(CONSUMER_ROOT / "packages" / "ecologits.js"),
        help=(
            "Directory of the consumer package holding the implementation vectors. "
            "Skipped when it does not exist."
        ),
    )
    return parser.parse_args()


def import_python_package(python_dir: Path) -> dict[str, Any]:
    """Import the Python package from ``python_dir`` and return the pieces we need."""
    if not (python_dir / "ecologits" / "__init__.py").exists():
        raise SystemExit(
            f"Could not find the Python package at {python_dir}. "
            "Pass --python-dir or set ECOLOGITS_PY_DIR."
        )
    sys.path.insert(0, str(python_dir))

    import ecologits
    from ecologits.electricity_mix_repository import electricity_mixes
    from ecologits.impacts import modeling
    from ecologits.impacts.llm import compute_llm_impacts
    from ecologits.model_repository import ParametersMoE, models
    from ecologits.status_messages import _error_codes, _warning_codes
    from ecologits.tracers.utils import PROVIDER_CONFIG_MAP, llm_impacts
    from ecologits.utils.range_value import RangeValue

    # The package logs a warning the first time a status message is produced. Those messages
    # are captured verbatim in the vectors, so repeating them on the console only adds noise.
    logging.getLogger("ecologits").setLevel(logging.ERROR)

    return {
        "ecologits": ecologits,
        "compute_llm_impacts": compute_llm_impacts,
        "electricity_mixes": electricity_mixes,
        "models": models,
        "ParametersMoE": ParametersMoE,
        "RangeValue": RangeValue,
        "modeling": modeling,
        "warning_codes": _warning_codes,
        "error_codes": _error_codes,
        "provider_config_map": PROVIDER_CONFIG_MAP,
        "llm_impacts": llm_impacts,
    }


def git_sha(python_dir: Path) -> str | None:
    try:
        return (
            subprocess.check_output(
                ["git", "-C", str(python_dir), "rev-parse", "HEAD"],
                stderr=subprocess.DEVNULL,
            )
            .decode()
            .strip()
        )
    except Exception:
        return None


def ser(value: Any, RangeValue: type) -> Any:
    """Serialise a scalar or ``RangeValue`` the way Pydantic would dump it."""
    if isinstance(value, RangeValue):
        return {"min": value.min, "max": value.max}
    return value


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1, sort_keys=False)
        handle.write("\n")
    try:
        shown = path.relative_to(SPEC_ROOT)
    except ValueError:
        # Implementation vectors live in the consumer, outside the spec tree.
        shown = path
    print(f"wrote {shown}")


# --------------------------------------------------------------------------------------
# estimator.json -- the estimator itself
# --------------------------------------------------------------------------------------


def build_llm_impacts(pkg: dict[str, Any]) -> dict[str, Any]:
    """Every registered model, every electricity mix, plus explicit range cases."""
    compute = pkg["compute_llm_impacts"]
    models = pkg["models"]
    mixes = pkg["electricity_mixes"]
    ParametersMoE = pkg["ParametersMoE"]
    RangeValue = pkg["RangeValue"]
    config_map = pkg["provider_config_map"]

    cases: list[dict[str, Any]] = []

    def add_case(name: str, params: dict[str, Any]) -> None:
        inputs = {
            "modelActiveParameterCount": ser(params["active"], RangeValue),
            "modelTotalParameterCount": ser(params["total"], RangeValue),
            "outputTokenCount": params["output_token_count"],
            "requestLatency": params["request_latency"],
            "ifElectricityMixAdpe": params["adpe"],
            "ifElectricityMixPe": params["pe"],
            "ifElectricityMixGwp": params["gwp"],
            "ifElectricityMixWue": params["wue"],
            "datacenterPue": ser(params["datacenter_pue"], RangeValue),
            "datacenterWue": ser(params["datacenter_wue"], RangeValue),
        }
        if params.get("tps") is not None:
            inputs["tps"] = params["tps"]
        if params.get("ttft") is not None:
            inputs["ttft"] = params["ttft"]

        # Some inputs are expected to raise upstream -- a zero `tps` divides by zero, and a
        # zero parameter count makes `math.log2(0)` fail. Either way the port must refuse the
        # input rather than silently returning a value Python never produces, so the failure
        # itself is recorded and pinned.
        try:
            impacts = compute(
                model_active_parameter_count=params["active"],
                model_total_parameter_count=params["total"],
                output_token_count=params["output_token_count"],
                request_latency=params["request_latency"],
                if_electricity_mix_adpe=params["adpe"],
                if_electricity_mix_pe=params["pe"],
                if_electricity_mix_gwp=params["gwp"],
                if_electricity_mix_wue=params["wue"],
                datacenter_pue=params["datacenter_pue"],
                datacenter_wue=params["datacenter_wue"],
                tps=params.get("tps"),
                ttft=params.get("ttft"),
            )
        except Exception as error:  # noqa: BLE001 - recording the failure is the point
            cases.append(
                {"name": name, "inputs": inputs, "pythonError": type(error).__name__}
            )
            return
        cases.append({"name": name, "inputs": inputs, "expected": impacts.model_dump()})

    def parameters_of(model: Any) -> tuple[Any, Any]:
        if isinstance(model.architecture.parameters, ParametersMoE):
            return (
                model.architecture.parameters.active,
                model.architecture.parameters.total,
            )
        return model.architecture.parameters, model.architecture.parameters

    def provider_factors(provider: str) -> tuple[str, Any, Any]:
        config = config_map[provider]
        return config.datacenter_location, config.datacenter_pue, config.datacenter_wue

    # 1. Every registered model, at the first token/latency case.
    for model in models.list_models():
        provider = model.provider.value
        zone, pue, wue = provider_factors(provider)
        mix = mixes.find_electricity_mix(zone=zone or "WOR")
        if mix is None:
            continue
        active, total = parameters_of(model)
        tokens, latency = TOKEN_LATENCY_CASES[0]
        add_case(
            f"{provider}/{model.name}",
            {
                "active": active,
                "total": total,
                "output_token_count": tokens,
                "request_latency": latency,
                "adpe": mix.adpe,
                "pe": mix.pe,
                "gwp": mix.gwp,
                "wue": mix.wue,
                "datacenter_pue": pue,
                "datacenter_wue": wue,
                "tps": model.deployment.tps if model.deployment else None,
                "ttft": model.deployment.ttft if model.deployment else None,
            },
        )

    # 2. A subset of models across additional token/latency shapes, so the latency clamp
    #    (min of measured and modelled) and the batch terms are exercised both ways.
    subset = models.list_models()[:: max(1, len(models.list_models()) // 25)][:25]
    for model in subset:
        provider = model.provider.value
        zone, pue, wue = provider_factors(provider)
        mix = mixes.find_electricity_mix(zone=zone or "WOR")
        if mix is None:
            continue
        active, total = parameters_of(model)
        for tokens, latency in TOKEN_LATENCY_CASES[1:]:
            add_case(
                f"{provider}/{model.name} tokens={tokens} latency={latency}",
                {
                    "active": active,
                    "total": total,
                    "output_token_count": tokens,
                    "request_latency": latency,
                    "adpe": mix.adpe,
                    "pe": mix.pe,
                    "gwp": mix.gwp,
                    "wue": mix.wue,
                    "datacenter_pue": pue,
                    "datacenter_wue": wue,
                    "tps": model.deployment.tps if model.deployment else None,
                    "ttft": model.deployment.ttft if model.deployment else None,
                },
            )

    # 3. Every electricity mix, on one fixed model, so all 215 zone factor sets are covered.
    reference = models.find_model(provider="openai", model_name="gpt-4o-mini")
    if reference is None:
        reference = models.list_models()[0]
    _, ref_pue, ref_wue = provider_factors(reference.provider.value)
    ref_active, ref_total = parameters_of(reference)
    for mix in mixes.list_electricity_mixes():
        add_case(
            f"zone/{mix.zone}",
            {
                "active": ref_active,
                "total": ref_total,
                "output_token_count": 200,
                "request_latency": 5.0,
                "adpe": mix.adpe,
                "pe": mix.pe,
                "gwp": mix.gwp,
                "wue": mix.wue,
                "datacenter_pue": ref_pue,
                "datacenter_wue": ref_wue,
            },
        )

    # 4. Explicit ranges: parameter counts, and datacenter PUE/WUE.
    add_case(
        "range/parameters",
        {
            "active": RangeValue(min=7.3, max=12.9),
            "total": RangeValue(min=7.3, max=46.7),
            "output_token_count": 200,
            "request_latency": 5.0,
            "adpe": 7.37708e-08,
            "pe": 9.988,
            "gwp": 0.590478,
            "wue": 5.04,
            "datacenter_pue": 1.26,
            "datacenter_wue": 0.37,
        },
    )
    add_case(
        "range/active-only",
        {
            "active": RangeValue(min=8.0, max=15.0),
            "total": 70.6,
            "output_token_count": 512,
            "request_latency": 12.0,
            "adpe": 7.37708e-08,
            "pe": 9.988,
            "gwp": 0.590478,
            "wue": 5.04,
            "datacenter_pue": 1.2,
            "datacenter_wue": 0.569,
        },
    )
    add_case(
        "range/datacenter-pue-wue",
        {
            "active": 7.3,
            "total": 7.3,
            "output_token_count": 200,
            "request_latency": 5.0,
            "adpe": 7.37708e-08,
            "pe": 9.988,
            "gwp": 0.590478,
            "wue": 5.04,
            "datacenter_pue": RangeValue(min=1.09, max=1.14),
            "datacenter_wue": RangeValue(min=0.13, max=0.999),
        },
    )
    add_case(
        "range/parameters-and-pue",
        {
            "active": RangeValue(min=7.3, max=12.9),
            "total": RangeValue(min=7.3, max=46.7),
            "output_token_count": 800,
            "request_latency": 20.0,
            "adpe": 7.37708e-08,
            "pe": 9.988,
            "gwp": 0.590478,
            "wue": 5.04,
            "datacenter_pue": RangeValue(min=1.09, max=1.14),
            "datacenter_wue": RangeValue(min=0.13, max=0.999),
        },
    )

    # 5. No measured latency: the modelled latency must win.
    add_case(
        "no-request-latency",
        {
            "active": 7.3,
            "total": 7.3,
            "output_token_count": 200,
            "request_latency": None,
            "adpe": 7.37708e-08,
            "pe": 9.988,
            "gwp": 0.590478,
            "wue": 5.04,
            "datacenter_pue": 1.2,
            "datacenter_wue": 0.569,
        },
    )

    # 6. A zero tokens-per-second value. Up to 0.11.1 one model shipped with `tps: 0`, and
    #    upstream divides by it without a guard; 0.11.2 corrected that data, so the case is
    #    pinned explicitly here instead of relying on the accident staying in the data.
    add_case(
        "tps-zero",
        {
            "active": 7.3,
            "total": 7.3,
            "output_token_count": 200,
            "request_latency": 5.0,
            "adpe": 7.37708e-08,
            "pe": 9.988,
            "gwp": 0.590478,
            "wue": 5.04,
            "datacenter_pue": 1.2,
            "datacenter_wue": 0.569,
            "tps": 0.0,
        },
    )

    # 7. A zero parameter count. `gpu_required_count` evaluates `math.log2(0)` without a
    #    guard, which raises ValueError in Python; JavaScript would silently return 0. Pinned
    #    as an expected-failure case for the same reason as `tps-zero`.
    add_case(
        "zero-parameters",
        {
            "active": 0.0,
            "total": 0.0,
            "output_token_count": 200,
            "request_latency": 5.0,
            "adpe": 7.37708e-08,
            "pe": 9.988,
            "gwp": 0.590478,
            "wue": 5.04,
            "datacenter_pue": 1.2,
            "datacenter_wue": 0.569,
        },
    )

    # 8. A negative parameter count large enough that `gpu_required_count` computes a negative
    #    GPU count. Python's `math.log2` raises ValueError there, while JavaScript's
    #    `Math.log2` returns NaN and would propagate it through every downstream asset. Pinned
    #    for the same reason as the other expected-failure cases.
    add_case(
        "negative-parameters",
        {
            "active": 7.3,
            "total": -100.0,
            "output_token_count": 200,
            "request_latency": 5.0,
            "adpe": 7.37708e-08,
            "pe": 9.988,
            "gwp": 0.590478,
            "wue": 5.04,
            "datacenter_pue": 1.2,
            "datacenter_wue": 0.569,
        },
    )

    return {"kind": "estimator", "cases": cases}


# --------------------------------------------------------------------------------------
# range-value.json -- arithmetic and the asymmetric comparison matrix
# --------------------------------------------------------------------------------------


def build_range_value(pkg: dict[str, Any]) -> dict[str, Any]:
    RangeValue = pkg["RangeValue"]

    # Bounds are written as floats on purpose: JavaScript has a single numeric type, so a
    # `RangeValue` in the port is always double-based. Python renders an int bound as "2"
    # but a float bound as "2.0", and there is no JS equivalent of that distinction.
    values: list[dict[str, Any]] = [
        {"kind": "scalar", "value": 0},
        {"kind": "scalar", "value": 1},
        {"kind": "scalar", "value": 2.5},
        {"kind": "scalar", "value": -3},
        {"kind": "range", "min": 1.0, "max": 2.0},
        {"kind": "range", "min": -1.0, "max": 1.0},
        {"kind": "range", "min": 2.0, "max": 2.0},
    ]

    def revive(spec: dict[str, Any]) -> Any:
        return (
            spec["value"]
            if spec["kind"] == "scalar"
            else RangeValue(min=spec["min"], max=spec["max"])
        )

    operations = {
        "add": lambda a, b: a + b,
        "mul": lambda a, b: a * b,
        "div": lambda a, b: a / b,
        "eq": lambda a, b: a == b,
        "lte": lambda a, b: a <= b,
        "lt": lambda a, b: a < b,
        "gte": lambda a, b: a >= b,
        "gt": lambda a, b: a > b,
    }

    pairs: list[dict[str, Any]] = []
    for left in values:
        for right in values:
            results: dict[str, Any] = {}
            for name, operation in operations.items():
                try:
                    results[name] = ser(
                        operation(revive(left), revive(right)), RangeValue
                    )
                except (
                    Exception
                ) as error:  # noqa: BLE001 - recording the failure is the point
                    results[name] = {"error": type(error).__name__}
            pairs.append({"left": left, "right": right, "results": results})

    formats = []
    for spec in values:
        if spec["kind"] == "range":
            revived = revive(spec)
            formats.append({"value": spec, "formatted": f"{revived}"})

    # Extra cases pinning Python's repr thresholds, which differ from JavaScript's: Python
    # switches to exponent notation below 1e-4 and at/above 1e16, pads the exponent to two
    # digits and keeps a trailing ".0" on integral floats.
    extra_bounds = [
        (-1e-5, 1e-5),
        (1e-7, 2e-7),
        (1e-6, 2e-6),
        (1e-5, 2e-5),
        (9.999e-5, 9.999e-5),
        (1e-4, 2e-4),
        (0.0, 0.0),
        (0.1, 0.2),
        (1.0 / 3.0, 1.0 / 3.0),
        (123.456, 123.456),
        (1e15, 1e15),
        (1e16, 2e16),
        (1e21, 1e21),
    ]
    for low, high in extra_bounds:
        spec = {"kind": "range", "min": low, "max": high}
        revived = RangeValue(min=low, max=high)
        formats.append({"value": spec, "formatted": f"{revived}"})

    return {
        "kind": "range-value",
        "values": values,
        "pairs": pairs,
        "formats": formats,
    }


# --------------------------------------------------------------------------------------
# modeling.json -- impact addition and comparison
# --------------------------------------------------------------------------------------


def build_modeling(pkg: dict[str, Any]) -> dict[str, Any]:
    modeling = pkg["modeling"]
    RangeValue = pkg["RangeValue"]

    specs = [
        ("Energy", modeling.Energy),
        ("GWP", modeling.GWP),
        ("ADPe", modeling.ADPe),
        ("PE", modeling.PE),
        ("WCF", modeling.WCF),
    ]
    values = [1, 2.5, RangeValue(min=1, max=2)]

    additions = []
    for left_name, left_cls in specs:
        for right_name, right_cls in specs:
            for left_value in values:
                for right_value in values:
                    try:
                        result = left_cls(value=left_value) + right_cls(
                            value=right_value
                        )
                    except Exception as error:  # noqa: BLE001
                        additions.append(
                            {
                                "left": left_name,
                                "right": right_name,
                                "leftValue": ser(left_value, RangeValue),
                                "rightValue": ser(right_value, RangeValue),
                                "error": type(error).__name__,
                            }
                        )
                        continue
                    additions.append(
                        {
                            "left": left_name,
                            "right": right_name,
                            "leftValue": ser(left_value, RangeValue),
                            "rightValue": ser(right_value, RangeValue),
                            "expected": result.model_dump(),
                        }
                    )

    comparisons = []
    for name, cls in specs:
        for left_value in values:
            for right_value in values:
                left = cls(value=left_value)
                right = cls(value=right_value)
                comparisons.append(
                    {
                        "type": name,
                        "leftValue": ser(left_value, RangeValue),
                        "rightValue": ser(right_value, RangeValue),
                        "eq": left == right,
                        "lte": left <= right,
                        "lt": left < right,
                        "gte": left >= right,
                        "gt": left > right,
                    }
                )

    cross_type = []
    for left_name, left_cls in specs:
        for right_name, right_cls in specs:
            if left_name == right_name:
                continue
            try:
                left_cls(value=1) == right_cls(value=1)  # noqa: B015 - deliberate
                cross_type.append(
                    {"left": left_name, "right": right_name, "error": None}
                )
            except Exception as error:  # noqa: BLE001
                cross_type.append(
                    {
                        "left": left_name,
                        "right": right_name,
                        "error": type(error).__name__,
                    }
                )

    return {
        "kind": "modeling",
        "additions": additions,
        "comparisons": comparisons,
        "crossType": cross_type,
    }


# --------------------------------------------------------------------------------------
# status-messages.json
# --------------------------------------------------------------------------------------


def build_status_messages(pkg: dict[str, Any]) -> dict[str, Any]:
    warnings = []
    for code, cls in pkg["warning_codes"].items():
        instance = cls()
        warnings.append(
            {
                "code": code,
                "className": cls.__name__,
                "message": instance.message,
                "str": str(instance),
                "dump": instance.model_dump(),
            }
        )

    errors = []
    for code, cls in pkg["error_codes"].items():
        instance = cls()
        errors.append(
            {
                "code": code,
                "className": cls.__name__,
                "message": instance.message,
                "str": str(instance),
                "dump": instance.model_dump(),
            }
        )

    unknown = []
    for code in ["nope", "", "model-arch-not-released "]:
        for kind, factory in (("warning", "WarningMessage"), ("error", "ErrorMessage")):
            module = sys.modules["ecologits.status_messages"]
            try:
                getattr(module, factory).from_code(code)
                unknown.append({"kind": kind, "code": code, "error": None})
            except Exception as error:  # noqa: BLE001
                unknown.append(
                    {"kind": kind, "code": code, "error": type(error).__name__}
                )

    return {
        "kind": "status-messages",
        "warnings": warnings,
        "errors": errors,
        "unknown": unknown,
    }


# --------------------------------------------------------------------------------------
# repository.json -- the data layer
# --------------------------------------------------------------------------------------


def build_repository(pkg: dict[str, Any]) -> dict[str, Any]:
    models = pkg["models"]
    mixes = pkg["electricity_mixes"]
    ParametersMoE = pkg["ParametersMoE"]
    RangeValue = pkg["RangeValue"]

    def parameters_of(model: Any) -> dict[str, Any]:
        params = model.architecture.parameters
        if isinstance(params, ParametersMoE):
            return {
                "kind": "moe",
                "total": ser(params.total, RangeValue),
                "active": ser(params.active, RangeValue),
            }
        return {"kind": "dense", "parameters": ser(params, RangeValue)}

    model_entries = []
    for model in models.list_models():
        model_entries.append(
            {
                "provider": model.provider.value,
                "name": model.name,
                "architectureType": model.architecture.type.value,
                "parameters": parameters_of(model),
                "warningCodes": [w.code for w in model.warnings],
                "deployment": (
                    {"tps": model.deployment.tps, "ttft": model.deployment.ttft}
                    if model.deployment
                    else None
                ),
            }
        )

    mix_entries = [
        {
            "zone": mix.zone,
            "adpe": mix.adpe,
            "pe": mix.pe,
            "gwp": mix.gwp,
            "wue": mix.wue,
            "warningCodes": [w.code for w in mix.warnings],
        }
        for mix in mixes.list_electricity_mixes()
    ]

    lookups = []
    for provider, name in [
        ("openai", "gpt-4o-mini"),
        ("openai", "does-not-exist"),
        ("anthropic", "claude-haiku-4-5"),
        ("nope", "whatever"),
    ]:
        found = models.find_model(provider=provider, model_name=name)
        lookups.append(
            {
                "provider": provider,
                "name": name,
                "found": found is not None,
                "resolvedName": found.name if found else None,
            }
        )

    return {
        "kind": "repository",
        "models": model_entries,
        "electricityMixes": mix_entries,
        "modelLookups": lookups,
    }


# --------------------------------------------------------------------------------------
# high-level.json -- the high-level model-name-to-impacts path
# --------------------------------------------------------------------------------------


def build_llm_impacts_output(pkg: dict[str, Any]) -> dict[str, Any]:
    """The convenience layer: model name in, impacts plus warnings and errors out.

    This covers the whole user-facing path, including the zone fallback ladder and the
    warning propagation that the lower-level estimator vectors cannot reach. A missing
    model or zone is an ordinary result carrying an error, not an exception.
    """
    llm_impacts = pkg["llm_impacts"]
    models = pkg["models"]
    mixes = pkg["electricity_mixes"]

    cases: list[dict[str, Any]] = []

    def add(
        name: str,
        provider: str,
        model_name: str,
        tokens: int,
        latency: float,
        zone: str | None,
    ) -> None:
        inputs = {
            "provider": provider,
            "modelName": model_name,
            "outputTokenCount": tokens,
            "requestLatency": latency,
            "electricityMixZone": zone,
        }
        try:
            result = llm_impacts(
                provider=provider,
                model_name=model_name,
                output_token_count=tokens,
                request_latency=latency,
                electricity_mix_zone=zone,
            )
        except (
            Exception
        ) as error:  # noqa: BLE001 - the failure is what we want to record
            cases.append(
                {"name": name, "inputs": inputs, "pythonError": type(error).__name__}
            )
            return
        cases.append({"name": name, "inputs": inputs, "expected": result.model_dump()})

    # 1. Every registered model, resolved through its provider's default zone.
    for model in models.list_models():
        add(
            f"{model.provider.value}/{model.name}",
            model.provider.value,
            model.name,
            200,
            5.0,
            None,
        )

    # 2. Explicit zones, including one that is not registered.
    for zone in ["USA", "SWE", "FRA", "WOR", "ZZZ"]:
        add(f"zone/{zone}", "openai", "gpt-4o-mini", 200, 5.0, zone)

    # 3. Mixes that carry warnings and mixes that do not, so both the propagation and the
    #    deduplication by code get exercised.
    with_warnings = [mix for mix in mixes.list_electricity_mixes() if mix.warnings][:3]
    without_warnings = [
        mix for mix in mixes.list_electricity_mixes() if not mix.warnings
    ][:3]
    for mix in with_warnings + without_warnings:
        add(f"mix/{mix.zone}", "openai", "gpt-4o-mini", 200, 5.0, mix.zone)

    # 4. A model that is not registered, and a provider that is not known at all.
    add("error/unknown-model", "openai", "does-not-exist", 200, 5.0, None)
    add("error/unknown-provider", "nope", "whatever", 200, 5.0, None)

    RangeValue = pkg["RangeValue"]
    provider_config_map = {
        provider: {
            "datacenterLocation": config.datacenter_location,
            "datacenterPue": ser(config.datacenter_pue, RangeValue),
            "datacenterWue": ser(config.datacenter_wue, RangeValue),
        }
        for provider, config in pkg["provider_config_map"].items()
    }

    return {
        "kind": "high-level",
        "providerConfigMap": provider_config_map,
        "cases": cases,
    }


def read_spec_version(spec_dir: Path) -> str:
    """The spec version is owned by the spec, not the generator, so read it from VERSION."""
    version_file = spec_dir / "VERSION"
    if version_file.exists():
        return version_file.read_text(encoding="utf-8").strip()
    return DEFAULT_SPEC_VERSION


def main() -> None:
    args = parse_args()
    python_dir = Path(args.python_dir).resolve()
    spec_dir = Path(args.spec).resolve()
    package_dir = Path(args.package).resolve()

    pkg = import_python_package(python_dir)
    ecologits = pkg["ecologits"]

    estimator = build_llm_impacts(pkg)
    high_level = build_llm_impacts_output(pkg)

    spec_vectors_dir = spec_dir / "vectors"

    write_json(spec_vectors_dir / "estimator.json", estimator)
    write_json(spec_vectors_dir / "high-level.json", high_level)
    write_json(spec_vectors_dir / "repository.json", build_repository(pkg))
    write_json(spec_vectors_dir / "status-messages.json", build_status_messages(pkg))

    # These pin the consumer's internal arithmetic and comparison semantics. They are not
    # part of the spec's observable contract, so they belong to the consumer package and are
    # skipped when the spec tree is used standalone (as it will be once it is its own repo).
    if package_dir.is_dir():
        internal_vectors_dir = package_dir / "test" / "vectors"
        write_json(internal_vectors_dir / "range-value.json", build_range_value(pkg))
        write_json(internal_vectors_dir / "modeling.json", build_modeling(pkg))
    else:
        print(f"skipped implementation vectors: {package_dir} does not exist")

    write_json(
        spec_dir / "manifest.json",
        {
            "specVersion": read_spec_version(spec_dir),
            "reference": {
                "implementation": "ecologits",
                "version": ecologits.__version__,
                "commit": git_sha(python_dir),
                "pythonVersion": sys.version.split()[0],
            },
            "vectors": [
                {"kind": kind, "path": f"vectors/{kind}.json", "contract": "output"}
                for kind in CONTRACT_VECTOR_KINDS
            ],
        },
    )

    print(
        f"\ngenerated {len(estimator['cases'])} estimator cases and "
        f"{len(high_level['cases'])} high-level cases from ecologits {ecologits.__version__}"
    )


if __name__ == "__main__":
    main()
