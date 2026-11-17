#!/usr/bin/env python3
"""Find indentation that silently breaks YAML block scalars.

Why this exists
---------------
A workflow's `run: |` block is a YAML block scalar. Its indentation is decided
by the FIRST non-empty line inside the block. Every later line must be indented
at least that far. A line one space short does not produce an error where the
mistake is -- it ENDS the block, and the line after that gets parsed as YAML,
which fails somewhere unrelated:

    run: |
      sudo apt-get update          <- 10 spaces, so 10 is the block indent
     sudo apt-get install -y ...   <-  9 spaces -> block ends here
                                    <- parser then sees "sudo apt-get" as YAML
    => expected <block end>, but found '<scalar>'  at a line you did not edit

That is what makes it so confusing: the reported line is fine, and the actual
mistake is above it.

This is not lint for style. It catches a class of corruption that editors,
paste-through-chat and auto-formatters introduce routinely, and that GitHub
reports with a line number pointing at the symptom rather than the cause.

Usage
-----
    check-yaml-indent.py FILE [FILE...]
    check-yaml-indent.py .github/workflows/*.yml

Exit status is 1 if any file has an under-indented block line (or fails to
parse), so it can gate a build.
"""

from __future__ import annotations

import re
import sys

BLOCK_RE = re.compile(r"^(\s*)(?:- )?(run|script|command):\s*[|>]([+-]?\d*)\s*$")


def scan(path: str) -> list[str]:
    """Return human-readable problems for one file."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.read().split("\n")
    except OSError as exc:
        return [f"{path}: cannot read ({exc})"]

    problems: list[str] = []
    i = 0
    while i < len(lines):
        m = BLOCK_RE.match(lines[i])
        if not m:
            i += 1
            continue

        key_indent = len(m.group(1))
        block_indent: int | None = None
        j = i + 1

        while j < len(lines):
            raw = lines[j]
            if not raw.strip():
                j += 1
                continue
            cur = len(raw) - len(raw.lstrip())

            # A line at or left of the key's own indentation ends the block.
            if cur <= key_indent:
                break

            if block_indent is None:
                block_indent = cur
            elif cur < block_indent:
                problems.append(
                    f"{path}:{j + 1}: block scalar opened at line {i + 1} uses "
                    f"{block_indent} spaces, but this line uses {cur}. "
                    f"That ends the block early and the next line is then read "
                    f"as YAML. Indent this line to {block_indent}."
                )
            j += 1

        i = j

    return problems


def main(argv: list[str]) -> int:
    paths = argv[1:]
    if not paths:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        print("usage: check-yaml-indent.py FILE [FILE...]", file=sys.stderr)
        return 2

    total = 0
    for path in paths:
        found = scan(path)
        for line in found:
            print(line)
        total += len(found)

        # Report a parse failure separately: an indent problem is one cause of
        # it, but not the only one, and the two are worth distinguishing.
        try:
            import yaml  # noqa: PLC0415  (optional dependency, report if absent)
        except ImportError:
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                yaml.safe_load(fh)
        except Exception as exc:  # noqa: BLE001
            if not found:
                print(f"{path}: YAML does not parse: {str(exc).splitlines()[0]}")
            total += 0 if found else 1

    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
