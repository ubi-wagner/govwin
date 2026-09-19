"""
What does each Python file import, and what does it define?

READ BY `build-project-tree.mjs`, which cannot parse Python. A regex over `import` lines was the
obvious alternative and is wrong in the direction that matters here: it silently misses a
multi-line `from x import (a, b, c)`, an import inside a function, and a conditional import — and a
dependency graph that quietly drops edges reports a file as unused when it is not. `ast` sees all
three, and anything it cannot parse is REPORTED rather than skipped.

Reads a NUL-separated list of paths on stdin, writes one JSON object to stdout:

    {"<path>": {"imports": [{"module": "...", "names": [...], "level": 0}],
                "defines": [...], "docstring": "...", "error": null}}

`level` is the relative-import depth (`from .foo import x` is 1), which the resolver needs to turn
a dotted module into a file path.
"""
import ast
import json
import sys


def describe(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
    except Exception as exc:  # unreadable is a finding, not a skip
        return {"imports": [], "defines": [], "docstring": None, "error": f"read: {exc}"}

    try:
        tree = ast.parse(src, filename=path)
    except SyntaxError as exc:
        # A file this cannot parse is UNCHECKED, and saying so is the whole contract. A scanner
        # that silently drops what it cannot parse reports a clean run.
        return {"imports": [], "defines": [], "docstring": None, "error": f"syntax: {exc}"}

    imports = []
    defines = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({"module": alias.name, "names": [], "level": 0})
        elif isinstance(node, ast.ImportFrom):
            imports.append({
                "module": node.module or "",
                "names": [a.name for a in node.names],
                "level": node.level or 0,
            })

    # Top-level definitions only — a nested helper is not part of the module's surface.
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defines.append(node.name)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id.isupper():
                    defines.append(t.id)

    return {
        "imports": imports,
        "defines": defines,
        "docstring": ast.get_docstring(tree),
        "error": None,
    }


def main() -> None:
    raw = sys.stdin.read()
    paths = [p for p in raw.split("\0") if p]
    sys.stdout.write(json.dumps({p: describe(p) for p in paths}))


if __name__ == "__main__":
    main()
