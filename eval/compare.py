#!/usr/bin/env python3
"""Compare Haiku vs Sonnet on the Saath bill test set.

Input: runs.json — a list of {file, tags, kind: "scan"|"audit", model, response}
  file  : storage path (or label) of the test file
  tags  : e.g. ["handwritten", "hi"] — the gate applies to "handwritten" and any Indian-language tag
  response : the JSON the edge function returned (scan → documents with amount/currency/date/category/doc_type;
             audit → documents with grand_total/gstin/visual_flags/date/doc_type)
Reference = Sonnet. Output: agreement rates, every disagreement, and the gate verdict.
"""
import json, sys
from collections import defaultdict

REF, CAND = "claude-sonnet-5-5", "claude-haiku-5-5"
INDIAN = {"hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "or", "ur", "indian"}
SCAN_FIELDS = ["amount", "currency", "date", "category", "doc_type"]
AUDIT_FIELDS = ["grand_total", "date", "doc_type", "gstin", "visual_flags"]


def amt(d, kind):
    v = d.get("amount" if kind == "scan" else "grand_total")
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def align(ref, cand, kind):
    """Pair documents: same pages first, then nearest amount, then order. Returns [(r, c)] with None for unmatched."""
    pairs, used = [], set()
    for r in ref:
        best, bscore = None, -1
        for j, c in enumerate(cand):
            if j in used:
                continue
            s = 0
            if set(r.get("pages") or []) & set(c.get("pages") or []):
                s += 2
            ra, ca = amt(r, kind), amt(c, kind)
            if ra is not None and ca is not None and abs(ra - ca) <= max(1, 0.002 * ra):
                s += 3
            if r.get("doc_type") == c.get("doc_type"):
                s += 1
            if s > bscore:
                best, bscore = j, s
        if best is not None and bscore > 0:
            used.add(best)
            pairs.append((r, cand[best]))
        else:
            pairs.append((r, None))
    for j, c in enumerate(cand):
        if j not in used:
            pairs.append((None, c))
    return pairs


def same(field, r, c, kind):
    if field in ("amount", "grand_total"):
        a, b = amt(r, kind), amt(c, kind)
        return a == b or (a is not None and b is not None and abs(a - b) <= 0.5)
    if field == "gstin":
        return (r.get("gstin") or "").replace(" ", "").upper() == (c.get("gstin") or "").replace(" ", "").upper()
    if field == "visual_flags":
        return sorted({v.get("kind") for v in r.get("visual_flags") or []}) == sorted({v.get("kind") for v in c.get("visual_flags") or []})
    return (r.get(field) or "") == (c.get(field) or "")


def main(path):
    runs = json.load(open(path))
    by = defaultdict(dict)
    meta = {}
    for x in runs:
        by[(x["file"], x["kind"])][x["model"]] = x["response"]
        meta[x["file"]] = x.get("tags", [])
    stats = defaultdict(lambda: [0, 0])  # field -> [agree, total]
    gate_fail, lines = [], []
    cost = defaultdict(float)
    for x in runs:
        cost[(x["kind"], x["model"])] += (x.get("cost_micro_usd") or 0) / 1e6
    for (f, kind), m in sorted(by.items()):
        if REF not in m or CAND not in m:
            lines.append(f"  ! {f} [{kind}] missing a model run: {sorted(m)}")
            continue
        r_docs = (m[REF] or {}).get("documents") or []
        c_docs = (m[CAND] or {}).get("documents") or []
        tags = meta.get(f, [])
        gated = "handwritten" in tags or bool(INDIAN & set(tags))
        stats[f"{kind}:doc_count"][1] += 1
        if len(r_docs) == len(c_docs):
            stats[f"{kind}:doc_count"][0] += 1
        else:
            lines.append(f"  ✗ {f} [{kind}] document count: sonnet {len(r_docs)} vs haiku {len(c_docs)}")
        fields = SCAN_FIELDS if kind == "scan" else AUDIT_FIELDS
        for r, c in align(r_docs, c_docs, kind):
            if r is None or c is None:
                lines.append(f"  ✗ {f} [{kind}] unmatched doc: sonnet={r and (r.get('doc_type'), amt(r, kind))} haiku={c and (c.get('doc_type'), amt(c, kind))}")
                if gated:
                    gate_fail.append((f, kind, "unmatched document"))
                continue
            for fld in fields:
                st = stats[f"{kind}:{fld}"]
                st[1] += 1
                if same(fld, r, c, kind):
                    st[0] += 1
                else:
                    rv = r.get(fld) if fld != "visual_flags" else sorted({v.get("kind") for v in r.get(fld) or []})
                    cv = c.get(fld) if fld != "visual_flags" else sorted({v.get("kind") for v in c.get(fld) or []})
                    lines.append(f"  ✗ {f} [{kind}] {fld}: sonnet={rv!r} haiku={cv!r}  ({', '.join(tags) or 'untagged'})")
                    if fld in ("amount", "grand_total") and gated:
                        gate_fail.append((f, kind, f"amount {rv} vs {cv}"))
    print("Agreement (Haiku vs Sonnet reference)")
    for k in sorted(stats):
        a, t = stats[k]
        print(f"  {k:28s} {a}/{t}  {100*a/t:5.1f}%" if t else f"  {k:28s} n/a")
    print("\nCost of the test runs (USD)")
    for (kind, model), usd in sorted(cost.items()):
        print(f"  {kind:6s} {model:20s} ${usd:.4f}")
    print("\nDisagreements")
    print("\n".join(lines) if lines else "  none")
    print("\nGate (handwritten / Indian-language amounts must match):", "PASS" if not gate_fail else "FAIL")
    for g in gate_fail:
        print("  -", *g)
    return 0 if not gate_fail else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "runs.json"))
