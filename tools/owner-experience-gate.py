#!/usr/bin/env python3
"""Owner Experience Gate v1: fail-closed coverage registry, NOT a substitute for Playwright.

Checks that every registered owner-discovered UX defect still has a named
browser scenario and that those scenarios are actually run by Generator CI
in Chromium, Firefox and WebKit. All test execution remains in existing jobs.
No browser, network or live device is started here.
"""
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "tests/fixtures/owner-experience-regressions.json"
UX_RUNNER = ROOT / "tests/owner-ux-browser.cjs"
WORKFLOW = ROOT / ".github/workflows/generator-ci.yml"
REQUIRED = {f"UX-{i:02d}" for i in range(1, 9)}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    require(manifest.get("schema_version") == 1, "unsupported gate manifest version")
    require(manifest.get("project") == "link-generators", "wrong project manifest")
    entries = manifest.get("user_findings")
    require(isinstance(entries, list) and entries, "empty owner finding registry")
    ids = [entry.get("id") for entry in entries]
    require(len(ids) == len(set(ids)), "duplicate owner UX finding IDs")
    require(REQUIRED.issubset(ids), "original UX-01..08 findings must remain registered")
    require(all(re.fullmatch(r"UX-\d{2,}", str(item)) for item in ids), "invalid UX finding ID")

    js = UX_RUNNER.read_text(encoding="utf-8")
    # Extract the literal beginning of check('...') labels. A scenario may
    # append a dynamic suffix (e.g. a node count), but its prefix is stable.
    scenario_names = re.findall(r"\bcheck\(\s*(['\"])(.*?)\1", js)
    scenario_names = [name for _, name in scenario_names]
    require(scenario_names, "browser UX scenarios not found")

    for item in entries:
        uid = item["id"]
        require(isinstance(item.get("summary"), str) and item["summary"].strip(),
                f"{uid}: missing user-visible symptom")
        prefixes = item.get("scenario_prefixes")
        require(isinstance(prefixes, list) and prefixes, f"{uid}: no executable scenario references")
        require(len(prefixes) == len(set(prefixes)), f"{uid}: duplicate scenario references")
        for prefix in prefixes:
            require(isinstance(prefix, str) and prefix.startswith(uid.replace("-", "")),
                    f"{uid}: malformed or cross-linked scenario prefix {prefix!r}")
            require(any(name.startswith(prefix) for name in scenario_names),
                    f"{uid}: missing actual Playwright check: {prefix}")
        print(f"PASS {uid}: {len(prefixes)} named browser scenarios registered")

    workflow = WORKFLOW.read_text(encoding="utf-8")
    require(workflow.count("node tests/owner-ux-browser.cjs") >= 2,
            "owner UX suite missing from main browser or browser matrix")
    require("browser: [firefox, webkit]" in workflow,
            "Firefox/WebKit owner UX matrix no longer required")
    require("node tests/final-release-browser.cjs" in workflow,
            "release journey / viewport test is no longer wired into CI")
    require("python3 tools/owner-experience-gate.py" in workflow,
            "this owner UX coverage guard must run in Generator CI")
    print("PASS CI: owner UX browser + Firefox/WebKit + release journey wired")
    print("OWNER EXPERIENCE COVERAGE REGISTRY PASS — runtime/UI results belong to browser jobs")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, ValueError, KeyError, OSError) as error:
        print(f"OWNER EXPERIENCE COVERAGE REGISTRY FAIL: {error}", file=sys.stderr)
        sys.exit(1)
