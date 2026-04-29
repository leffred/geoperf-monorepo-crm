#!/usr/bin/env python3
"""GEOPERF render — Jinja2 + charts + sources aggregation."""

import argparse
import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

PALETTE = [
    "#042C53", "#0C447C", "#EF9F27", "#5F5E5A",
    "#888780", "#1D9E75", "#993C1D", "#534AB7",
]


def compute_geo_distribution(companies):
    countries = Counter(c.get("country") or "Inconnu" for c in companies)
    total = sum(countries.values())
    if total == 0:
        return []
    sorted_countries = sorted(countries.items(), key=lambda x: -x[1])
    slices = []
    cumulative = 0.0
    cx, cy, r = 100, 100, 80
    for i, (label, count) in enumerate(sorted_countries):
        fraction = count / total
        start_angle = cumulative * 2 * math.pi - math.pi / 2
        end_angle = (cumulative + fraction) * 2 * math.pi - math.pi / 2
        x1 = cx + r * math.cos(start_angle)
        y1 = cy + r * math.sin(start_angle)
        x2 = cx + r * math.cos(end_angle)
        y2 = cy + r * math.sin(end_angle)
        large_arc = 1 if fraction > 0.5 else 0
        path = f"M {cx},{cy} L {x1:.2f},{y1:.2f} A {r},{r} 0 {large_arc} 1 {x2:.2f},{y2:.2f} Z"
        slices.append({
            "label": label,
            "count": count,
            "fraction": round(fraction * 100, 1),
            "color": PALETTE[i % len(PALETTE)],
            "path": path,
        })
        cumulative += fraction
    return slices


def compute_visibility_pyramid(stats, llms_count=4):
    layer_data = [
        ("Cites par 4/4 LLM", stats.get("cited_by_4_llms", 0), "#042C53"),
        ("Cites par 3/4 LLM", stats.get("cited_by_3_llms", 0), "#0C447C"),
        ("Cites par 2/4 LLM", stats.get("cited_by_2_llms", 0), "#5F5E5A"),
        ("Cites par 1/4 LLM", stats.get("cited_by_1_llm", 0), "#888780"),
    ]
    chart_width = 560
    chart_x_offset = 20
    layer_height = 40
    layer_spacing = 8
    max_count = max((c for _, c, _ in layer_data), default=1) or 1
    layers = []
    for i, (label, count, color) in enumerate(layer_data):
        ratio = count / max_count
        width = max(120, int(80 + ratio * (chart_width - 80)))
        x = chart_x_offset + (chart_width - width) / 2
        y = 20 + i * (layer_height + layer_spacing)
        layers.append({
            "label": label, "count": count, "color": color,
            "x": round(x, 2), "y": y, "width": width,
        })
    return layers


def compute_llm_generosity(companies, providers):
    counts = {p: 0 for p in providers}
    for c in companies:
        for p in providers:
            if c.get("cited_by", {}).get(p):
                counts[p] += 1
    pretty = {
        "perplexity": ("Perplexity", "Sonar Pro"),
        "openai":     ("GPT-4o",     "OpenAI"),
        "google":     ("Gemini 2.5", "Google"),
        "anthropic":  ("Sonnet 4.6", "Anthropic"),
    }
    max_c = max(counts.values()) if counts else 1
    if max_c == 0:
        max_c = 1
    bar_max_height = 130
    bars = []
    x = 60
    for p in providers:
        count = counts[p]
        height = int((count / max_c) * bar_max_height)
        y = 160 - height
        label, provider = pretty.get(p, (p, ""))
        bars.append({
            "x": x, "y": y, "height": height, "count": count,
            "label": label, "provider": provider,
            "color": "#042C53" if count == max_c else "#0C447C" if count > 0 else "#888780",
        })
        x += 120
    return bars


def aggregate_sources(companies, max_sources=30):
    src_map = {}
    for c in companies:
        for s in c.get("sources", []) or []:
            if not isinstance(s, dict):
                continue
            url = s.get("url")
            if not url:
                continue
            if url not in src_map:
                src_map[url] = {
                    "url": url,
                    "title": s.get("title"),
                    "publisher": s.get("publisher"),
                    "citations": 0,
                }
            src_map[url]["citations"] += 1
    sorted_sources = sorted(src_map.values(), key=lambda x: (-x["citations"], x.get("publisher") or ""))
    return sorted_sources[:max_sources]


def count_total_sources(companies):
    seen = set()
    for c in companies:
        for s in c.get("sources", []) or []:
            if isinstance(s, dict) and s.get("url"):
                seen.add(s["url"])
    return len(seen)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--consolidated", type=Path, required=True)
    ap.add_argument("--sections", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--report-id", required=True)
    ap.add_argument("--title")
    ap.add_argument("--subtitle", default="Etat de la visibilite des acteurs majeurs dans les LLM en 2026.")
    ap.add_argument("--period", default=None)
    ap.add_argument("--top-n", type=int, default=50)
    ap.add_argument("--template-dir", type=Path, default=Path(__file__).parent)
    ap.add_argument("--template-name", default="template.html.j2")
    args = ap.parse_args()

    consolidated = json.loads(args.consolidated.read_text(encoding="utf-8"))
    sections = json.loads(args.sections.read_text(encoding="utf-8"))

    title = args.title or consolidated.get("category", "Etude sectorielle")
    period = args.period or datetime.utcnow().strftime("%B %Y")
    generated_at = datetime.utcnow()

    llm_pretty = {
        "perplexity": {"label": "Sonar Pro",  "provider": "Perplexity"},
        "openai":     {"label": "GPT-4o",     "provider": "OpenAI"},
        "google":     {"label": "Gemini 2.5", "provider": "Google"},
        "anthropic":  {"label": "Sonnet 4.6", "provider": "Anthropic"},
    }
    providers = consolidated.get("providers_used", [])
    llm_list = [llm_pretty[p] for p in providers if p in llm_pretty]

    top_companies_summary = sections.get("top_companies_summary", [])[:args.top_n]
    companies_data = consolidated["companies"][:args.top_n]
    stats = consolidated.get("stats", {})

    charts = {
        "geo_distribution": compute_geo_distribution(companies_data),
        "visibility_pyramid": compute_visibility_pyramid(stats, llms_count=len(providers)),
        "llm_generosity": compute_llm_generosity(companies_data, providers),
    }

    sources_aggregated = aggregate_sources(companies_data)
    total_sources = count_total_sources(companies_data)

    context = {
        "report": {
            "title": title,
            "subtitle": args.subtitle,
            "serie_label": "LLM Visibility Research",
            "period": period,
            "edition_label": generated_at.strftime("%B %Y"),
            "generated_at_human": generated_at.strftime("%d %B %Y"),
            "report_id": args.report_id,
            "report_id_short": args.report_id[:8].upper(),
            "llms_count": len(llm_list),
            "llm_list": llm_list,
            "companies_count": stats.get("total_unique_companies", len(companies_data)),
            "top_n": min(args.top_n, len(top_companies_summary)),
            "total_sources": total_sources,
        },
        "sections": {**sections, "top_companies_summary": top_companies_summary},
        "stats": stats,
        "companies_data": companies_data,
        "charts": charts,
        "sources_aggregated": sources_aggregated,
    }

    env = Environment(
        loader=FileSystemLoader(str(args.template_dir)),
        autoescape=select_autoescape(["html", "j2"]),
    )
    template = env.get_template(args.template_name)
    html = template.render(**context)
    args.output.write_text(html, encoding="utf-8")
    print(f"[OK] HTML rendered to {args.output} ({len(html)} chars)")
    print(f"     Charts: geo={len(charts['geo_distribution'])} slices, pyramid={len(charts['visibility_pyramid'])} layers, llm_bars={len(charts['llm_generosity'])}")
    print(f"     Sources aggregated: {len(sources_aggregated)} unique URLs")


if __name__ == "__main__":
    main()
