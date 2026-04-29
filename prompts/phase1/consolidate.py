#!/usr/bin/env python3
"""
GEOPERF — Consolidation cross-LLM des extractions Phase 1

Input  : 4 fichiers JSON (perplexity.json, openai.json, google.json, anthropic.json)
Output : 1 JSON consolidé prêt pour (a) la synthèse Opus 4.7 et (b) l'insertion en base.

Usage :
    python consolidate.py \\
        --perplexity perplexity.json \\
        --openai openai.json \\
        --google google.json \\
        --anthropic anthropic.json \\
        --output consolidated.json \\
        --report-id <uuid>

Le JSON consolidé a la structure suivante :

{
  "report_id": "<uuid>",
  "category": "...",
  "year": 2026,
  "providers_used": ["perplexity", "openai", "google", "anthropic"],
  "companies": [
    {
      "rank_consolidated": 1,
      "name": "BlackRock",
      "name_normalized": "blackrock",
      "domain": "blackrock.com",
      "country": "United States",
      "city": "New York",
      "employees_range": "50000+",
      "best_description": "...",
      "key_metric": {"name": "AUM", "value": "11500", "unit": "billion USD", "as_of_year": 2024},
      "cited_by": {"perplexity": true, "openai": true, "google": true, "anthropic": true},
      "visibility_score": 4,
      "ranks_per_llm": {"perplexity": 1, "openai": 1, "google": 1, "anthropic": 1},
      "avg_position": 1.0,
      "source_count": 8,
      "sources": [{"url": "...", "title": "...", "publisher": "...", "from_llm": "perplexity"}, ...],
      "confidence_per_llm": {"openai": "high", "google": "high", "anthropic": "high"}
    }
  ],
  "stats": {
    "total_unique_companies": 67,
    "cited_by_4_llms": 12,
    "cited_by_3_llms": 18,
    "cited_by_2_llms": 22,
    "cited_by_1_llm": 15
  }
}
"""

import argparse
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse


# ============== NORMALISATION ==============

LEGAL_SUFFIXES = [
    "inc", "incorporated", "corp", "corporation", "company", "co",
    "ltd", "limited", "llc", "llp", "lp",
    "sa", "s.a.", "sas", "s.a.s.", "sarl", "s.a.r.l.",
    "ag", "gmbh", "kg", "kgaa", "ohg", "gbr",
    "plc", "spa", "s.p.a.", "srl", "s.r.l.",
    "bv", "b.v.", "nv", "n.v.",
    "ab", "as", "oy", "aps",
    "group", "holding", "holdings", "international", "global", "worldwide",
]


def normalize_company_name(name: str) -> str:
    """Normalise un nom de société pour le dédoublonnage cross-LLM."""
    if not name:
        return ""
    # Lowercase + retire accents
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower()
    # Retire ponctuation (sauf - et &)
    s = re.sub(r"[^\w\s\-&]", " ", s)
    # Collapse spaces
    s = re.sub(r"\s+", " ", s).strip()
    # Retire suffixes légaux
    tokens = s.split()
    while tokens and tokens[-1].rstrip(".") in LEGAL_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def normalize_domain(domain: str) -> str:
    """Normalise un domaine (retire www, lowercase, strip path)."""
    if not domain:
        return ""
    d = domain.lower().strip()
    if d.startswith("http"):
        d = urlparse(d).netloc
    if d.startswith("www."):
        d = d[4:]
    d = d.split("/")[0].split("?")[0]
    return d


def domain_root(domain: str) -> str:
    """Extrait la racine du domaine (ex: 'corp.blackrock.com' -> 'blackrock.com')."""
    d = normalize_domain(domain)
    parts = d.split(".")
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return d


# ============== MATCHING ==============

def match_key(name: str, domain: str) -> str:
    """Clé de dédoublonnage. Priorité : domaine racine. Fallback : nom normalisé."""
    d = domain_root(domain)
    if d:
        return f"d:{d}"
    n = normalize_company_name(name)
    return f"n:{n}" if n else ""


# ============== AGRÉGATION ==============

def aggregate_companies(llm_outputs: dict) -> list:
    """
    llm_outputs = {"perplexity": {...json...}, "openai": {...}, "google": {...}, "anthropic": {...}}
    Returns: liste de sociétés consolidées avec metrics cross-LLM.
    """
    by_key = defaultdict(lambda: {
        "names_seen": [],
        "domains_seen": [],
        "countries": [],
        "cities": [],
        "employees_ranges": [],
        "descriptions": [],
        "key_metrics": [],
        "cited_by": {},
        "ranks_per_llm": {},
        "confidence_per_llm": {},
        "sources": [],
    })

    for provider, payload in llm_outputs.items():
        if not payload:
            continue
        companies = payload.get("companies", [])
        for c in companies:
            name = (c.get("name") or "").strip()
            domain = (c.get("domain") or "").strip()
            key = match_key(name, domain)
            if not key:
                continue
            entry = by_key[key]
            entry["names_seen"].append(name)
            if domain:
                entry["domains_seen"].append(normalize_domain(domain))
            if c.get("country"):
                entry["countries"].append(c["country"])
            if c.get("city"):
                entry["cities"].append(c["city"])
            if c.get("employees_range"):
                entry["employees_ranges"].append(c["employees_range"])
            if c.get("description"):
                entry["descriptions"].append((provider, c["description"]))
            if c.get("key_metric"):
                entry["key_metrics"].append((provider, c["key_metric"]))
            entry["cited_by"][provider] = True
            if c.get("rank") is not None:
                entry["ranks_per_llm"][provider] = c["rank"]
            if c.get("confidence"):
                entry["confidence_per_llm"][provider] = c["confidence"]
            for s in c.get("sources", []) or []:
                # Tolère sources sous forme de string OU d'objet {url, title, publisher}
                if isinstance(s, str) and s.strip():
                    entry["sources"].append({"url": s, "title": None, "publisher": None, "from_llm": provider})
                elif isinstance(s, dict) and s.get("url"):
                    entry["sources"].append({**s, "from_llm": provider})

    # Build consolidated list
    consolidated = []
    all_providers = set(llm_outputs.keys())
    for key, entry in by_key.items():
        # Pick canonical name (most frequent, ties broken by first-seen)
        name_counts = defaultdict(int)
        for n in entry["names_seen"]:
            name_counts[n] += 1
        canonical_name = max(name_counts.items(), key=lambda x: (x[1], -entry["names_seen"].index(x[0])))[0]

        # Pick canonical domain (most frequent)
        canonical_domain = ""
        if entry["domains_seen"]:
            dom_counts = defaultdict(int)
            for d in entry["domains_seen"]:
                dom_counts[domain_root(d)] += 1
            canonical_domain = max(dom_counts.items(), key=lambda x: x[1])[0]

        # Pick best description (priorité : Perplexity, sinon GPT, sinon Claude, sinon Gemini)
        priority = ["perplexity", "openai", "anthropic", "google"]
        best_desc = ""
        for p in priority:
            for src, d in entry["descriptions"]:
                if src == p:
                    best_desc = d
                    break
            if best_desc:
                break

        # Pick best key_metric (priorité Perplexity)
        best_metric = None
        for p in priority:
            for src, m in entry["key_metrics"]:
                if src == p and m:
                    best_metric = m
                    break
            if best_metric:
                break

        # Cited_by complet (fill False for missing providers)
        cited_by_full = {p: bool(entry["cited_by"].get(p)) for p in all_providers}
        visibility_score = sum(cited_by_full.values())

        # Average position (parmi LLM qui ont cité avec un rang)
        ranks = [r for r in entry["ranks_per_llm"].values() if r is not None]
        avg_position = round(sum(ranks) / len(ranks), 2) if ranks else None

        # Source count = nombre d'URLs distinctes
        source_urls = set(s["url"] for s in entry["sources"] if s.get("url"))
        source_count = len(source_urls)

        consolidated.append({
            "name": canonical_name,
            "name_normalized": normalize_company_name(canonical_name),
            "domain": canonical_domain,
            "country": entry["countries"][0] if entry["countries"] else None,
            "city": entry["cities"][0] if entry["cities"] else None,
            "employees_range": entry["employees_ranges"][0] if entry["employees_ranges"] else None,
            "best_description": best_desc,
            "key_metric": best_metric,
            "cited_by": cited_by_full,
            "visibility_score": visibility_score,
            "ranks_per_llm": entry["ranks_per_llm"],
            "avg_position": avg_position,
            "source_count": source_count,
            "sources": entry["sources"],
            "confidence_per_llm": entry["confidence_per_llm"],
        })

    # Sort by visibility (DESC) then by avg_position (ASC, lower = better)
    def sort_key(c):
        return (-c["visibility_score"], c["avg_position"] if c["avg_position"] is not None else 999)
    consolidated.sort(key=sort_key)

    # Assign rank_consolidated
    for i, c in enumerate(consolidated, start=1):
        c["rank_consolidated"] = i

    return consolidated


# ============== STATS ==============

def compute_stats(consolidated: list) -> dict:
    counts = defaultdict(int)
    for c in consolidated:
        counts[c["visibility_score"]] += 1
    return {
        "total_unique_companies": len(consolidated),
        "cited_by_4_llms": counts[4],
        "cited_by_3_llms": counts[3],
        "cited_by_2_llms": counts[2],
        "cited_by_1_llm": counts[1],
    }


# ============== MAIN ==============

def main():
    p = argparse.ArgumentParser(description="Consolidate 4-LLM extractions for GEOPERF Phase 1")
    p.add_argument("--perplexity", type=Path, help="JSON output from Perplexity")
    p.add_argument("--openai", type=Path, help="JSON output from OpenAI GPT-4o")
    p.add_argument("--google", type=Path, help="JSON output from Google Gemini")
    p.add_argument("--anthropic", type=Path, help="JSON output from Anthropic Claude")
    p.add_argument("--output", type=Path, required=True, help="Path for consolidated JSON")
    p.add_argument("--report-id", required=True, help="Supabase report UUID")
    p.add_argument("--category", help="Override category from inputs")
    p.add_argument("--year", type=int, default=2026)
    args = p.parse_args()

    llm_outputs = {}
    sources = {
        "perplexity": args.perplexity,
        "openai": args.openai,
        "google": args.google,
        "anthropic": args.anthropic,
    }
    for provider, path in sources.items():
        if path and path.exists():
            with open(path, "r", encoding="utf-8") as f:
                llm_outputs[provider] = json.load(f)
        else:
            print(f"[WARN] {provider}: file missing or not provided, skipping", file=sys.stderr)

    if not llm_outputs:
        print("[ERROR] No LLM input files provided", file=sys.stderr)
        sys.exit(1)

    consolidated = aggregate_companies(llm_outputs)
    stats = compute_stats(consolidated)

    category = args.category
    if not category:
        for payload in llm_outputs.values():
            if payload and payload.get("metadata", {}).get("category"):
                category = payload["metadata"]["category"]
                break

    output = {
        "report_id": args.report_id,
        "category": category,
        "year": args.year,
        "providers_used": list(llm_outputs.keys()),
        "companies": consolidated,
        "stats": stats,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"[OK] Consolidated {stats['total_unique_companies']} unique companies into {args.output}")
    print(f"     Cited by 4 LLMs: {stats['cited_by_4_llms']} | 3: {stats['cited_by_3_llms']} | 2: {stats['cited_by_2_llms']} | 1: {stats['cited_by_1_llm']}")


if __name__ == "__main__":
    main()
