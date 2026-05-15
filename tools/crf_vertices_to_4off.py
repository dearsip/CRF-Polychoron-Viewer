#!/usr/bin/env python3
"""
Generate a 4D polychoron-style OFF file from CRF vertex text.

Supported input formats:
  1) CRF expression text, for example:

       <±1, ±phi, 0, ±1/2>

     Each <...> line must contain four coordinate expressions.
     Each ± is expanded independently.
     Supported expression syntax includes:
       phi, φ, sqrt(...), √3, +, -, *, /, ^ or **, parentheses.

  2) Raw numeric text: one 4D vertex per line: x y z w.
     Commas are also accepted. Lines starting with # are ignored.

  3) Existing 4OFF/OFF-like files: only the vertex block is read.

Output format:
  4OFF
  # Vertices, Faces, Edges, Cells
  <num_vertices> <num_faces> <num_edges> <num_cells>

  # Vertices
  x y z w
  ...

  # Faces
  <num_face_vertices> v0 v1 ...
  ...

  # Cells
  <num_cell_faces> f0 f1 ...
  ...

Faces are written as vertex-index cycles.
Cells are written as face-index lists.
"""

from __future__ import annotations

import argparse
import ast
import itertools
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

try:
    import numpy as np
except ImportError as exc:
    raise SystemExit(
        "This script requires numpy. Install it with: python -m pip install numpy"
    ) from exc


FloatArray = "np.ndarray"
Edge = Tuple[int, int]
Face = Tuple[int, ...]
Cell = Tuple[int, ...]

_NUMBER_RE = re.compile(r"[-+]?(?:(?:\d+\.\d*)|(?:\.\d+)|(?:\d+))(?:[eE][-+]?\d+)?")
PHI = (1.0 + math.sqrt(5.0)) / 2.0

# Accepted whole-vector delimiters.  Angle brackets are common in CRF vertex
# lists, but square/round/curly brackets are also useful when copying from
# other sources.  Full-width and mathematical angle brackets are accepted too.
_VECTOR_BRACKETS: Dict[str, str] = {
    "<": ">",
    "⟨": "⟩",
    "＜": "＞",
    "[": "]",
    "［": "］",
    "(": ")",
    "（": "）",
    "{": "}",
    "｛": "｝",
}
_CLOSING_TO_OPEN = {v: k for k, v in _VECTOR_BRACKETS.items()}


@dataclass
class BuildResult:
    vertices: FloatArray
    edges: List[Edge]
    faces: List[Face]
    cells: List[Cell]


@dataclass
class BuildOptions:
    max_face_sides: int = 12
    min_face_sides: int = 3
    rel_eps: float = 1.0e-6
    abs_eps: float = 1.0e-8
    point_eps: Optional[float] = None
    plane_eps: Optional[float] = None
    angle_eps: float = 1.0e-5
    keep_unpaired_faces: bool = False


@dataclass
class InputOptions:
    dedupe_eps: float = 1.0e-9


def strip_comment(line: str) -> str:
    return line.split("#", 1)[0].strip()


def numbers_from_line(line: str) -> List[float]:
    return [float(x) for x in _NUMBER_RE.findall(line)]


def split_top_level_commas(text: str) -> List[str]:
    """Split a vector body on commas that are not inside expression brackets."""
    parts: List[str] = []
    stack: List[str] = []
    start = 0
    for i, ch in enumerate(text):
        if ch in _VECTOR_BRACKETS:
            stack.append(_VECTOR_BRACKETS[ch])
        elif ch in _CLOSING_TO_OPEN:
            if not stack or stack[-1] != ch:
                raise ValueError(f"unmatched {ch!r} in vector body: {text!r}")
            stack.pop()
        elif ch == "," and not stack:
            parts.append(text[start:i].strip())
            start = i + 1
    if stack:
        raise ValueError(f"unmatched bracket in vector body: {text!r}")
    parts.append(text[start:].strip())
    return parts


def find_matching_closer(text: str, open_index: int) -> Optional[int]:
    """Return the index of the closer matching text[open_index]."""
    opener = text[open_index]
    closer = _VECTOR_BRACKETS.get(opener)
    if closer is None:
        return None

    stack = [closer]
    i = open_index + 1
    while i < len(text):
        ch = text[i]
        if ch in _VECTOR_BRACKETS:
            stack.append(_VECTOR_BRACKETS[ch])
        elif ch in _CLOSING_TO_OPEN:
            if not stack or stack[-1] != ch:
                return None
            stack.pop()
            if not stack:
                return i
        i += 1
    return None


def unwrap_whole_vector(line: str) -> Optional[str]:
    """Return the inside of one whole-line bracketed vector, if present.

    A trailing delimiter after the closing vector bracket is tolerated.  This is
    useful for copied coordinate lists such as ``<a,b,c,d>,`` or ``[a,b,c,d];``.
    Only harmless row delimiters are ignored; any other trailing text still makes
    the line non-whole-vector so that accidental input is not silently accepted.
    """
    clean = line.strip()
    if not clean or clean[0] not in _VECTOR_BRACKETS:
        return None
    closer_index = find_matching_closer(clean, 0)
    if closer_index is None:
        return None
    tail = clean[closer_index + 1 :].strip()
    if tail and not re.fullmatch(r"[,;，；、]+", tail):
        return None
    return clean[1:closer_index]


def extract_vector_bodies(line: str) -> List[str]:
    """Extract candidate four-coordinate vector bodies from one cleaned line.

    Supported forms include:
      <a,b,c,d>, [a,b,c,d], (a,b,c,d), {a,b,c,d}
      a,b,c,d

    Parentheses inside coordinate expressions are preserved, so expressions like
    sqrt(1+sqrt(5)) or √(1+√5) do not confuse tuple splitting.
    """
    clean = line.strip()
    if not clean:
        return []

    whole = unwrap_whole_vector(clean)
    if whole is not None:
        return [whole]

    # Keep backward compatibility with lines that contain one or more
    # angle-bracket vectors among other text.  For non-angle brackets, requiring
    # the whole line to be the vector avoids confusing expression parentheses
    # with tuple delimiters.
    bodies: List[str] = []
    i = 0
    angle_openers = {"<", "⟨", "＜"}
    while i < len(clean):
        if clean[i] in angle_openers:
            j = find_matching_closer(clean, i)
            if j is None:
                raise ValueError(f"unmatched vector bracket in line: {line!r}")
            bodies.append(clean[i + 1 : j])
            i = j + 1
        else:
            i += 1
    if bodies:
        return bodies

    # Bracketless expression tuple.  This intentionally requires commas; plain
    # numeric whitespace-separated rows are handled by the raw numeric fallback.
    try:
        parts = split_top_level_commas(clean)
    except ValueError:
        return []
    if len(parts) == 4:
        return [clean]
    return []


def insert_implicit_multiplication(expr: str) -> str:
    """Insert '*' in common mathematical shorthand cases.

    In particular, this accepts 2√3, 2sqrt(3), 2(1+phi), 2phi,
    phi√3, and (1+phi)sqrt(3).
    """
    previous = None
    while previous != expr:
        previous = expr
        expr = re.sub(r"(\d|\))\s*(?=√|sqrt\s*\()", r"\1*", expr)
        expr = re.sub(r"(\d|\))\s*(?=phi\b|pi\b)", r"\1*", expr)
        expr = re.sub(r"(\d|\))\s*(?=\()", r"\1*", expr)
        expr = re.sub(r"\b(phi|pi)\s*(?=√|sqrt\s*\(|\()", r"\1*", expr)
        expr = re.sub(r"(\))\s*(?=\d)", r"\1*", expr)
    return expr


def normalize_sqrt_symbols(expr: str) -> str:
    """Convert √ notation, including nested radicals, to sqrt(...)."""

    def parse_radical_operand(i: int) -> Tuple[str, int]:
        while i < len(expr) and expr[i].isspace():
            i += 1
        if i >= len(expr):
            raise ValueError("dangling √ in expression")

        if expr[i] == "√":
            nested, j = parse_radical(i)
            return nested, j

        if expr[i] in _VECTOR_BRACKETS:
            j = find_matching_closer(expr, i)
            if j is None:
                raise ValueError("unmatched bracket after √")
            inner = normalize_sqrt_symbols(expr[i + 1 : j])
            return inner, j + 1

        start = i
        if expr[i].isdigit() or expr[i] == ".":
            i += 1
            while i < len(expr) and (expr[i].isdigit() or expr[i] == "."):
                i += 1
            if i < len(expr) and expr[i] in {"e", "E"}:
                j = i + 1
                if j < len(expr) and expr[j] in {"+", "-"}:
                    j += 1
                while j < len(expr) and expr[j].isdigit():
                    j += 1
                i = j
        elif expr[i].isalpha() or expr[i] in {"φ", "ϕ"}:
            i += 1
            while i < len(expr) and (expr[i].isalnum() or expr[i] in {"_", "φ", "ϕ"}):
                i += 1
        else:
            raise ValueError(f"unsupported token after √: {expr[i]!r}")
        return expr[start:i], i

    def parse_radical(i: int) -> Tuple[str, int]:
        # expr[i] must be '√'.
        operand, j = parse_radical_operand(i + 1)
        return f"sqrt({operand})", j

    out: List[str] = []
    i = 0
    while i < len(expr):
        if expr[i] == "√":
            converted, i = parse_radical(i)
            out.append(converted)
        else:
            out.append(expr[i])
            i += 1
    return "".join(out)


def normalize_expression(expr: str) -> str:
    expr = expr.strip()
    expr = expr.replace("−", "-").replace("－", "-")
    expr = expr.replace("＋", "+")
    expr = expr.replace("×", "*").replace("・", "*")
    expr = expr.replace("÷", "/")
    expr = expr.replace("Φ", "phi").replace("φ", "phi").replace("ϕ", "phi")
    expr = expr.replace("π", "pi")
    expr = expr.replace("［", "[").replace("］", "]")
    expr = expr.replace("（", "(").replace("）", ")")
    expr = expr.replace("｛", "{").replace("｝", "}")
    expr = insert_implicit_multiplication(expr)
    expr = normalize_sqrt_symbols(expr)
    # After radicals have been converted to sqrt(...), bracket characters used
    # for grouping inside coordinate expressions can safely become parentheses.
    expr = expr.replace("[", "(").replace("]", ")")
    expr = expr.replace("{", "(").replace("}", ")")
    expr = expr.replace("^", "**")
    expr = insert_implicit_multiplication(expr)
    return expr

_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)
_ALLOWED_UNARYOPS = (ast.UAdd, ast.USub)


def eval_expr(expr: str) -> float:
    """Evaluate a small arithmetic expression safely."""
    expr = normalize_expression(expr)
    tree = ast.parse(expr, mode="eval")

    def rec(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return rec(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return float(node.value)
            raise ValueError(f"unsupported literal in expression: {expr!r}")
        if isinstance(node, ast.Name):
            if node.id == "phi":
                return PHI
            if node.id == "pi":
                return math.pi
            raise ValueError(f"unknown name {node.id!r} in expression: {expr!r}")
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, _ALLOWED_UNARYOPS):
            value = rec(node.operand)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp) and isinstance(node.op, _ALLOWED_BINOPS):
            left = rec(node.left)
            right = rec(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.Pow):
                return left ** right
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "sqrt" and len(node.args) == 1 and not node.keywords:
                return math.sqrt(rec(node.args[0]))
            raise ValueError(f"only sqrt(x) calls are allowed: {expr!r}")
        raise ValueError(f"unsupported expression: {expr!r}")

    return rec(tree)


def expand_pm_expressions(exprs: Sequence[str], line_no: int) -> List[List[float]]:
    """Expand all ± occurrences independently across a four-coordinate tuple."""
    total_pm = sum(expr.count("±") for expr in exprs)
    vertices: List[List[float]] = []

    for signs in itertools.product(("+", "-"), repeat=total_pm):
        sign_iter = iter(signs)
        values: List[float] = []
        for expr in exprs:
            expanded = "".join(next(sign_iter) if ch == "±" else ch for ch in expr)
            try:
                values.append(eval_expr(expanded))
            except Exception as exc:
                raise ValueError(f"line {line_no}: could not evaluate {expanded!r}") from exc
        vertices.append(values)
    return vertices


def parse_crf_expression_vertices(text: str) -> Optional[FloatArray]:
    """Parse expression tuples such as <x,y,z,w>, [x,y,z,w], or x,y,z,w.

    Returns None when no expression tuples were found, so callers can fall back
    to raw numeric parsing.
    """
    vertices: List[List[float]] = []
    found = False
    for line_no, line in enumerate(text.splitlines(), start=1):
        clean = strip_comment(line)
        if not clean:
            continue
        bodies = extract_vector_bodies(clean)
        if not bodies:
            continue
        found = True
        for body in bodies:
            exprs = split_top_level_commas(body)
            if len(exprs) != 4:
                raise ValueError(f"line {line_no}: expected 4 coordinates, got {len(exprs)}")
            vertices.extend(expand_pm_expressions(exprs, line_no))
    if not found:
        return None
    if not vertices:
        raise ValueError("expression tuples were found, but no vertices were generated")
    return np.array(vertices, dtype=float)

def dedupe_vertices(vertices: FloatArray, eps: float) -> FloatArray:
    if eps <= 0:
        return vertices
    kept: List[FloatArray] = []
    # Rounding key handles most exact symbolic duplicates. The distance check
    # catches rare cases near rounding-cell boundaries.
    buckets: Dict[Tuple[int, int, int, int], List[int]] = {}
    inv = 1.0 / eps
    for p in vertices:
        key = tuple(int(round(float(x) * inv)) for x in p)
        duplicate = False
        for nearby in itertools.product((-1, 0, 1), repeat=4):
            k2 = tuple(key[i] + nearby[i] for i in range(4))
            for idx in buckets.get(k2, []):
                if float(np.linalg.norm(p - kept[idx])) <= eps:
                    duplicate = True
                    break
            if duplicate:
                break
        if duplicate:
            continue
        buckets.setdefault(key, []).append(len(kept))
        kept.append(np.array(p, dtype=float))
    return np.array(kept, dtype=float)


def read_vertices(path: str | Path, input_opt: Optional[InputOptions] = None) -> FloatArray:
    """Read 4D vertices from CRF text, raw text, or an OFF/4OFF vertex block."""
    input_opt = input_opt or InputOptions()
    text = Path(path).read_text(encoding="utf-8-sig")
    raw_lines = text.splitlines()
    meaningful = [strip_comment(line) for line in raw_lines]
    meaningful = [line for line in meaningful if line]
    if not meaningful:
        raise ValueError("input file is empty")

    first = meaningful[0].upper()
    if first in {"4OFF", "OFF"}:
        # Find the counts line after the header.
        counts_line_index = None
        counts = None
        for i, line in enumerate(meaningful[1:], start=1):
            nums = numbers_from_line(line)
            if len(nums) >= 1:
                counts_line_index = i
                counts = [int(round(x)) for x in nums]
                break
        if counts_line_index is None or counts is None:
            raise ValueError("OFF header was found, but the counts line was not found")
        num_vertices = counts[0]
        vertices: List[List[float]] = []
        for line in meaningful[counts_line_index + 1 :]:
            nums = numbers_from_line(line)
            if len(nums) >= 4:
                vertices.append(nums[:4])
                if len(vertices) == num_vertices:
                    break
        if len(vertices) != num_vertices:
            raise ValueError(f"expected {num_vertices} vertices, found {len(vertices)}")
        arr = np.array(vertices, dtype=float)
        return dedupe_vertices(arr, input_opt.dedupe_eps)

    expr_vertices = parse_crf_expression_vertices(text)
    if expr_vertices is not None:
        return dedupe_vertices(expr_vertices, input_opt.dedupe_eps)

    vertices = []
    for line_no, line in enumerate(raw_lines, start=1):
        clean = strip_comment(line)
        if not clean:
            continue
        nums = numbers_from_line(clean)
        if len(nums) < 4:
            raise ValueError(f"line {line_no}: expected at least 4 numbers, got {len(nums)}")
        vertices.append(nums[:4])
    if not vertices:
        raise ValueError("no vertices were found")
    return dedupe_vertices(np.array(vertices, dtype=float), input_opt.dedupe_eps)


def write_4off(path: str | Path, result: BuildResult) -> None:
    vertices = result.vertices
    faces = result.faces
    cells = result.cells
    edge_count = count_edges_used_by_faces(faces)

    def fmt(x: float) -> str:
        # Compact but stable enough for geometry data.
        if abs(x) < 1e-14:
            x = 0.0
        return f"{x:.12g}"

    out: List[str] = []
    out.append("4OFF")
    out.append("# Vertices, Faces, Edges, Cells")
    out.append(f"{len(vertices)} {len(faces)} {edge_count} {len(cells)}")
    out.append("")
    out.append("# Vertices")
    for p in vertices:
        out.append(" ".join(fmt(float(x)) for x in p))
    out.append("")
    out.append("# Faces")
    for face in faces:
        out.append(f"{len(face)} " + " ".join(str(i) for i in face))
    out.append("")
    out.append("# Cells")
    for cell in cells:
        out.append(f"{len(cell)} " + " ".join(str(i) for i in cell))
    out.append("")
    Path(path).write_text("\n".join(out), encoding="utf-8")


def scale_of(vertices: FloatArray) -> float:
    lo = vertices.min(axis=0)
    hi = vertices.max(axis=0)
    return max(1.0, float(np.linalg.norm(hi - lo)))


def squared_distances(vertices: FloatArray) -> FloatArray:
    diff = vertices[:, None, :] - vertices[None, :, :]
    return np.einsum("ijk,ijk->ij", diff, diff)


def build_edges(vertices: FloatArray, opt: BuildOptions) -> Tuple[List[Edge], Dict[Edge, int], List[List[int]], float]:
    n = len(vertices)
    if n < 2:
        raise ValueError("at least two vertices are required")

    d2 = squared_distances(vertices)
    mask = d2 > opt.abs_eps * opt.abs_eps
    if not np.any(mask):
        raise ValueError("all vertices appear to coincide")
    edge_len2 = float(np.min(d2[mask]))
    tol = max(opt.abs_eps * opt.abs_eps, opt.rel_eps * max(1.0, edge_len2))

    edges: List[Edge] = []
    adjacency: List[List[int]] = [[] for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            if abs(float(d2[i, j]) - edge_len2) <= tol:
                edge = (i, j)
                edges.append(edge)
                adjacency[i].append(j)
                adjacency[j].append(i)

    edge_index = {edge: k for k, edge in enumerate(edges)}
    return edges, edge_index, adjacency, math.sqrt(edge_len2)


def canonical_cycle(cycle: Sequence[int]) -> Tuple[int, ...]:
    """Canonical key for an unoriented polygon cycle."""
    c = list(cycle)
    n = len(c)
    rots = []
    for seq in (c, list(reversed(c))):
        for shift in range(n):
            rots.append(tuple(seq[shift:] + seq[:shift]))
    return min(rots)


def nearest_vertex(vertices: FloatArray, point: FloatArray, eps: float) -> Optional[int]:
    diff = vertices - point
    d2 = np.einsum("ij,ij->i", diff, diff)
    idx = int(np.argmin(d2))
    if float(d2[idx]) <= eps * eps:
        return idx
    return None


def rotate_edge(edge_len: float, u: FloatArray, q: FloatArray, angle: float) -> FloatArray:
    return edge_len * (math.cos(angle) * u + math.sin(angle) * q)


def generate_regular_face(
    vertices: FloatArray,
    a: int,
    b: int,
    c: int,
    sides: int,
    edge_len: float,
    point_eps: float,
    edge_set: set[Edge],
) -> Optional[Face]:
    """Generate the regular polygon determined by oriented consecutive vertices a-b-c."""
    p0 = vertices[a]
    e0 = vertices[b] - vertices[a]
    e1 = vertices[c] - vertices[b]
    u_norm = float(np.linalg.norm(e0))
    if u_norm == 0:
        return None
    u = e0 / u_norm

    phi_angle = 2.0 * math.pi / sides
    sin_phi = math.sin(phi_angle)
    if abs(sin_phi) < 1e-12:
        return None

    # e1 / edge_len should equal cos(phi_angle) * u + sin(phi_angle) * q.
    q = (e1 / edge_len - math.cos(phi_angle) * u) / sin_phi
    q_norm = float(np.linalg.norm(q))
    if q_norm < 1e-8:
        return None
    q = q / q_norm

    # q should be perpendicular to u; reject numerically unstable cases.
    if abs(float(np.dot(u, q))) > 1e-4:
        return None

    cycle = [a]
    pos = np.array(p0, dtype=float)
    for k in range(sides):
        if k > 0:
            idx = nearest_vertex(vertices, pos, point_eps)
            if idx is None:
                return None
            cycle.append(idx)
        step = rotate_edge(edge_len, u, q, k * phi_angle)
        pos = pos + step

    # After sides steps, we should be back at the first vertex.
    if float(np.linalg.norm(pos - p0)) > point_eps:
        return None

    if len(cycle) != sides or len(set(cycle)) != sides:
        return None

    # The second and third vertices must match the seed orientation.
    if cycle[1] != b or cycle[2] != c:
        return None

    # Consecutive pairs must be actual shortest-distance edges.
    for i in range(sides):
        x = cycle[i]
        y = cycle[(i + 1) % sides]
        if tuple(sorted((x, y))) not in edge_set:
            return None

    return tuple(cycle)


def build_faces(
    vertices: FloatArray,
    adjacency: List[List[int]],
    edges: List[Edge],
    edge_len: float,
    opt: BuildOptions,
) -> List[Face]:
    edge_set = set(edges)
    point_eps = opt.point_eps
    if point_eps is None:
        point_eps = max(opt.abs_eps, opt.rel_eps * max(1.0, edge_len)) * 20.0

    target_cos = {
        sides: math.cos(2.0 * math.pi / sides)
        for sides in range(opt.min_face_sides, opt.max_face_sides + 1)
    }

    faces_by_key: Dict[Tuple[int, ...], Face] = {}
    n = len(vertices)
    for b in range(n):
        for a in adjacency[b]:
            e0 = vertices[b] - vertices[a]
            for c in adjacency[b]:
                if c == a:
                    continue
                e1 = vertices[c] - vertices[b]
                cos_turn = float(np.dot(e0, e1) / (edge_len * edge_len))
                cos_turn = max(-1.0, min(1.0, cos_turn))
                for sides, cos_value in target_cos.items():
                    if abs(cos_turn - cos_value) > opt.angle_eps:
                        continue
                    face = generate_regular_face(
                        vertices, a, b, c, sides, edge_len, point_eps, edge_set
                    )
                    if face is None:
                        continue
                    key = canonical_cycle(face)
                    # Store the canonical orientation to keep output deterministic.
                    faces_by_key.setdefault(key, key)

    faces = list(faces_by_key.values())
    faces.sort(key=lambda f: (len(f), f))
    return faces


def face_edge_map(faces: Sequence[Face]) -> Dict[Edge, List[int]]:
    result: Dict[Edge, List[int]] = {}
    for fi, face in enumerate(faces):
        m = len(face)
        for i in range(m):
            edge = tuple(sorted((face[i], face[(i + 1) % m])))
            result.setdefault(edge, []).append(fi)
    return result


def hyperplane_from_points(points: FloatArray, rank_eps: float) -> Optional[Tuple[FloatArray, float]]:
    """Return n, d for the affine 3-plane dot(n, x) = d in 4D."""
    if len(points) < 4:
        return None
    base = points[0]
    a = points - base
    try:
        _, s, vh = np.linalg.svd(a, full_matrices=True)
    except np.linalg.LinAlgError:
        return None
    rank = int(np.sum(s > rank_eps))
    if rank != 3:
        return None
    normal = vh[-1]
    norm = float(np.linalg.norm(normal))
    if norm < 1e-12:
        return None
    normal = normal / norm
    d = float(np.dot(normal, base))
    return normal, d


def orient_as_supporting_plane(
    vertices: FloatArray,
    normal: FloatArray,
    d: float,
    plane_eps: float,
) -> Optional[Tuple[FloatArray, float]]:
    signed = vertices @ normal - d
    if float(np.max(signed)) <= plane_eps:
        return normal, d
    if float(np.min(signed)) >= -plane_eps:
        return -normal, -d
    return None


def same_plane(
    n1: FloatArray,
    d1: float,
    n2: FloatArray,
    d2: float,
    normal_eps: float,
    plane_eps: float,
) -> bool:
    return abs(float(np.dot(n1, n2)) - 1.0) <= normal_eps and abs(d1 - d2) <= plane_eps


def face_on_plane(vertices: FloatArray, face: Face, normal: FloatArray, d: float, plane_eps: float) -> bool:
    vals = vertices[list(face)] @ normal - d
    return bool(np.max(np.abs(vals)) <= plane_eps)


def build_cells(vertices: FloatArray, faces: Sequence[Face], opt: BuildOptions) -> List[Cell]:
    sc = scale_of(vertices)
    plane_eps = opt.plane_eps if opt.plane_eps is not None else max(opt.abs_eps, opt.rel_eps * sc) * 20.0
    rank_eps = max(opt.abs_eps, opt.rel_eps * sc) * 10.0
    normal_eps = max(1.0e-8, opt.angle_eps * 10.0)

    femap = face_edge_map(faces)
    planes: List[Tuple[FloatArray, float]] = []
    cells: List[Cell] = []

    for _, fs in femap.items():
        if len(fs) < 2:
            continue
        for i in range(len(fs)):
            for j in range(i + 1, len(fs)):
                f1, f2 = fs[i], fs[j]
                ids = sorted(set(faces[f1]) | set(faces[f2]))
                plane = hyperplane_from_points(vertices[ids], rank_eps)
                if plane is None:
                    continue
                oriented = orient_as_supporting_plane(vertices, plane[0], plane[1], plane_eps)
                if oriented is None:
                    continue
                n, d = oriented
                if any(same_plane(n, d, n0, d0, normal_eps, plane_eps) for n0, d0 in planes):
                    continue

                cell_faces = tuple(
                    fi for fi, face in enumerate(faces)
                    if face_on_plane(vertices, face, n, d, plane_eps)
                )
                if len(cell_faces) >= 4:
                    planes.append((n, d))
                    cells.append(cell_faces)

    cells = sorted(set(cells), key=lambda c: (len(c), c))
    return cells


def remove_unpaired_faces(faces: Sequence[Face], cells: Sequence[Cell]) -> Tuple[List[Face], List[Cell]]:
    usage = [0] * len(faces)
    for cell in cells:
        for fi in cell:
            usage[fi] += 1

    # In a valid convex 4-polytope boundary, each 2-face is shared by exactly two cells.
    keep = [u >= 2 for u in usage]
    remap = {}
    new_faces: List[Face] = []
    for old, face in enumerate(faces):
        if keep[old]:
            remap[old] = len(new_faces)
            new_faces.append(face)

    new_cells: List[Cell] = []
    for cell in cells:
        mapped = tuple(remap[fi] for fi in cell if fi in remap)
        # A tetrahedron has 4 faces; anything smaller is not a 3D cell.
        if len(mapped) >= 4:
            new_cells.append(mapped)

    # Deduplicate after face removal and sort deterministically.
    new_cells = sorted(set(new_cells), key=lambda c: (len(c), c))
    return new_faces, new_cells


def count_edges_used_by_faces(faces: Sequence[Face]) -> int:
    used = set()
    for face in faces:
        for i in range(len(face)):
            used.add(tuple(sorted((face[i], face[(i + 1) % len(face)]))))
    return len(used)


def build_complex(vertices: FloatArray, opt: BuildOptions) -> BuildResult:
    if vertices.ndim != 2 or vertices.shape[1] != 4:
        raise ValueError("vertices must be an N x 4 array")
    edges, _, adjacency, edge_len = build_edges(vertices, opt)
    faces = build_faces(vertices, adjacency, edges, edge_len, opt)
    cells = build_cells(vertices, faces, opt)
    if not opt.keep_unpaired_faces:
        faces, cells = remove_unpaired_faces(faces, cells)
    used_edges = sorted(set(tuple(sorted((face[i], face[(i + 1) % len(face)]))) for face in faces for i in range(len(face))))
    return BuildResult(vertices=vertices, edges=used_edges, faces=faces, cells=cells)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate faces and cells of a convex regular-faced polychoron from 4D vertices."
    )
    parser.add_argument("input", help="input text file: CRF <...> expression text, raw x y z w lines, or an existing 4OFF/OFF file")
    parser.add_argument("output", help="output 4OFF file")
    parser.add_argument("--max-face-sides", type=int, default=12, help="maximum number of sides of a regular face")
    parser.add_argument("--min-face-sides", type=int, default=3, help="minimum number of sides of a regular face")
    parser.add_argument("--rel-eps", type=float, default=1e-6, help="relative tolerance")
    parser.add_argument("--abs-eps", type=float, default=1e-8, help="absolute tolerance")
    parser.add_argument("--point-eps", type=float, default=None, help="vertex matching tolerance")
    parser.add_argument("--plane-eps", type=float, default=None, help="cell hyperplane tolerance")
    parser.add_argument("--angle-eps", type=float, default=1e-5, help="cosine tolerance for regular polygon turns")
    parser.add_argument("--dedupe-eps", type=float, default=1e-9, help="deduplicate input vertices within this distance; use 0 to disable")
    parser.add_argument(
        "--keep-unpaired-faces",
        action="store_true",
        help="do not delete faces that belong to fewer than two cells",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    input_opt = InputOptions(dedupe_eps=args.dedupe_eps)
    opt = BuildOptions(
        max_face_sides=args.max_face_sides,
        min_face_sides=args.min_face_sides,
        rel_eps=args.rel_eps,
        abs_eps=args.abs_eps,
        point_eps=args.point_eps,
        plane_eps=args.plane_eps,
        angle_eps=args.angle_eps,
        keep_unpaired_faces=args.keep_unpaired_faces,
    )
    vertices = read_vertices(args.input, input_opt)
    result = build_complex(vertices, opt)
    write_4off(args.output, result)

    print(f"vertices: {len(result.vertices)}")
    print(f"edges:    {len(result.edges)}")
    print(f"faces:    {len(result.faces)}")
    print(f"cells:    {len(result.cells)}")
    print(f"wrote:    {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
