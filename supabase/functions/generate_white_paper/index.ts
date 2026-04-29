// GEOPERF Edge Function — Génère le livre blanc HTML d'un report
// Trigger: POST {report_id} (et optionnel : {model, top_n})
// Output : {ok, report_id, html_url, sections, stats}
//
// Pipeline interne :
//   1. SELECT consolidated companies + sources depuis DB
//   2. Build chart data (geo distribution, visibility pyramid, llm bars)
//   3. Call OpenRouter (Sonnet 4.6 par défaut) pour la synthèse
//   4. Render HTML inline (template editorial complet)
//   5. Upload sur Storage white-papers/<report_id>.html
//   6. UPDATE reports.html_url
//   7. Return {ok, html_url, sections}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============== TYPES ==============
interface Company {
  rank_consolidated: number;
  name: string;
  domain?: string;
  country?: string;
  employees_range?: string;
  best_description?: string;
  cited_by: Record<string, boolean>;
  visibility_score: number;
  avg_position?: number;
  source_count?: number;
  sources?: Array<{ url: string; title?: string; publisher?: string; from_llm?: string }>;
}

interface ConsolidatedPayload {
  report_id: string;
  category: string;
  year: number;
  providers_used: string[];
  companies: Company[];
  stats: {
    total_unique_companies: number;
    cited_by_4_llms: number;
    cited_by_3_llms: number;
    cited_by_2_llms: number;
    cited_by_1_llm: number;
  };
}

// ============== CHARTS ==============
const PALETTE = ["#042C53", "#0C447C", "#EF9F27", "#5F5E5A", "#888780", "#1D9E75", "#993C1D", "#534AB7"];

function computeGeoDistribution(companies: Company[]) {
  const counter: Record<string, number> = {};
  for (const c of companies) {
    const k = c.country || "Inconnu";
    counter[k] = (counter[k] || 0) + 1;
  }
  const total = Object.values(counter).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const sorted = Object.entries(counter).sort((a, b) => b[1] - a[1]);
  const slices = [];
  let cumulative = 0;
  const cx = 100, cy = 100, r = 80;
  for (let i = 0; i < sorted.length; i++) {
    const [label, count] = sorted[i];
    const fraction = count / total;
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    const endAngle = (cumulative + fraction) * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;
    const path = `M ${cx},${cy} L ${x1.toFixed(2)},${y1.toFixed(2)} A ${r},${r} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    slices.push({ label, count, color: PALETTE[i % PALETTE.length], path });
    cumulative += fraction;
  }
  return slices;
}

function computeVisibilityPyramid(stats: ConsolidatedPayload["stats"]) {
  const layerData = [
    ["Cites par 4/4 LLM", stats.cited_by_4_llms, "#042C53"],
    ["Cites par 3/4 LLM", stats.cited_by_3_llms, "#0C447C"],
    ["Cites par 2/4 LLM", stats.cited_by_2_llms, "#5F5E5A"],
    ["Cites par 1/4 LLM", stats.cited_by_1_llm, "#888780"],
  ] as const;
  const chartWidth = 560;
  const offset = 20;
  const layerH = 40;
  const spacing = 8;
  const maxC = Math.max(1, ...layerData.map(([, c]) => Number(c)));
  return layerData.map(([label, count, color], i) => {
    const ratio = (count as number) / maxC;
    const width = Math.max(120, Math.round(80 + ratio * (chartWidth - 80)));
    const x = offset + (chartWidth - width) / 2;
    const y = 20 + i * (layerH + spacing);
    return { label, count, color, x: Math.round(x * 100) / 100, y, width };
  });
}

function computeLLMBars(companies: Company[], providers: string[]) {
  const counts: Record<string, number> = Object.fromEntries(providers.map(p => [p, 0]));
  for (const c of companies) {
    for (const p of providers) {
      if (c.cited_by?.[p]) counts[p]++;
    }
  }
  const pretty: Record<string, [string, string]> = {
    perplexity: ["Perplexity", "Sonar Pro"],
    openai:     ["GPT-4o",     "OpenAI"],
    google:     ["Gemini 2.5", "Google"],
    anthropic:  ["Sonnet 4.6", "Anthropic"],
  };
  const maxC = Math.max(1, ...Object.values(counts));
  const barMaxH = 130;
  const bars = [];
  let x = 60;
  for (const p of providers) {
    const count = counts[p];
    const height = Math.round((count / maxC) * barMaxH);
    const y = 160 - height;
    const [label, provider] = pretty[p] || [p, ""];
    bars.push({
      x, y, height, count, label, provider,
      color: count === maxC ? "#042C53" : count > 0 ? "#0C447C" : "#888780",
    });
    x += 120;
  }
  return bars;
}

function aggregateSources(companies: Company[], maxN = 30) {
  const map = new Map<string, { url: string; title?: string; publisher?: string; citations: number }>();
  for (const c of companies) {
    for (const s of (c.sources || [])) {
      if (!s?.url) continue;
      if (!map.has(s.url)) map.set(s.url, { url: s.url, title: s.title, publisher: s.publisher, citations: 0 });
      map.get(s.url)!.citations++;
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (b.citations - a.citations) || (a.publisher || "").localeCompare(b.publisher || ""))
    .slice(0, maxN);
}

// ============== HTML TEMPLATE ==============
function renderHTML(ctx: any): string {
  const { report, sections, stats, companies, charts, sources } = ctx;
  const llmKeys = ["perplexity", "openai", "google", "anthropic"];
  const llmLabels = ["PXTY", "GPT", "GEM", "CLD"];

  const css = `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: 'Inter', -apple-system, sans-serif; color: #2C2C2A; line-height: 1.6; font-size: 10.5pt; }
@page { size: A4 portrait; margin: 22mm 18mm 24mm 18mm; }
@page :first { margin: 0; }
h1, h2, h3, h4, .serif { font-family: 'Source Serif Pro', Georgia, serif; color: #042C53; font-weight: 500; letter-spacing: -0.3px; }
h1 { font-size: 32pt; line-height: 1.1; margin-bottom: 12mm; }
h2 { font-size: 20pt; line-height: 1.2; margin: 12mm 0 4mm; padding-bottom: 3mm; border-bottom: 0.5px solid #042C53; }
h3 { font-size: 14pt; line-height: 1.3; margin: 7mm 0 3mm; }
h4 { font-size: 11pt; line-height: 1.3; margin: 5mm 0 2mm; }
p { margin-bottom: 3mm; }
ul, ol { margin: 0 0 3mm 5mm; }
li { margin-bottom: 1.5mm; }
.mono { font-family: 'IBM Plex Mono', monospace; font-size: 9pt; }
.caps { letter-spacing: 2.5px; text-transform: uppercase; font-size: 9pt; color: #0C447C; font-weight: 500; }
.subtle { color: #5F5E5A; font-size: 9.5pt; }
.cover { page-break-after: always; width: 210mm; height: 297mm; background: #042C53; color: #FFFFFF; padding: 28mm 24mm; position: relative; display: flex; flex-direction: column; justify-content: space-between; }
.cover .mid { flex: 1; display: flex; flex-direction: column; justify-content: center; }
.cover .logo-mark { width: 16mm; height: 16mm; background: #FFFFFF; color: #042C53; display: inline-flex; align-items: center; justify-content: center; font-family: 'Source Serif Pro', serif; font-size: 28pt; font-weight: 500; position: relative; }
.cover .logo-mark::after { content: ""; position: absolute; top: 2mm; right: 2mm; width: 2.5mm; height: 2.5mm; background: #EF9F27; border-radius: 50%; }
.cover .label { font-size: 10pt; letter-spacing: 4px; text-transform: uppercase; opacity: 0.75; margin-top: 6mm; }
.cover h1 { color: #FFFFFF; font-size: 44pt; line-height: 1.1; max-width: 150mm; }
.cover h1 .dot { color: #EF9F27; }
.cover .subtitle { font-family: 'Source Serif Pro', serif; font-size: 18pt; opacity: 0.85; margin-top: 8mm; max-width: 150mm; font-weight: 400; }
.cover .meta { display: flex; gap: 12mm; margin-top: 14mm; font-size: 11pt; }
.cover .meta div { border-left: 0.5px solid rgba(255,255,255,0.4); padding-left: 4mm; }
.cover .meta .lbl { font-size: 8pt; opacity: 0.6; letter-spacing: 1.5px; text-transform: uppercase; display: block; margin-bottom: 1mm; }
.cover .footer { display: flex; justify-content: space-between; align-items: flex-end; font-size: 9pt; opacity: 0.7; }
.cover .wordmark-bot { font-family: 'Source Serif Pro', serif; font-size: 18pt; letter-spacing: -0.6px; }
.toc { background: #F1EFE8; padding: 8mm 10mm; margin: 6mm 0 10mm; border-left: 3px solid #042C53; }
.toc ol { list-style: none; margin: 4mm 0 0; counter-reset: tocitem; }
.toc ol li { counter-increment: tocitem; display: flex; justify-content: space-between; font-family: 'Source Serif Pro', serif; font-size: 11.5pt; padding: 1.5mm 0; border-bottom: 0.5px dotted rgba(4,44,83,0.2); }
.toc ol li::before { content: counter(tocitem, decimal-leading-zero) " · "; color: #EF9F27; font-family: 'IBM Plex Mono', monospace; font-size: 10pt; margin-right: 4mm; }
.exec-block { background: #F1EFE8; border-left: 3px solid #EF9F27; padding: 6mm 8mm; margin: 6mm 0; font-family: 'Source Serif Pro', serif; font-size: 13pt; line-height: 1.55; color: #042C53; }
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin: 6mm 0; }
.kpi-card { background: #F1EFE8; padding: 5mm; text-align: center; page-break-inside: avoid; }
.kpi-card .num { font-family: 'Source Serif Pro', serif; font-size: 28pt; font-weight: 500; color: #042C53; line-height: 1; }
.kpi-card .lbl { font-size: 9pt; color: #5F5E5A; margin-top: 2mm; letter-spacing: 0.5px; }
.kpi-card.featured { background: #042C53; color: #FFFFFF; }
.kpi-card.featured .num, .kpi-card.featured .lbl { color: #FFFFFF; }
.chart-section { display: grid; grid-template-columns: 90mm 1fr; gap: 8mm; margin: 6mm 0; page-break-inside: avoid; }
.chart-svg { width: 100%; height: auto; max-height: 75mm; }
.chart-caption { font-size: 9pt; color: #5F5E5A; text-align: center; margin-top: 2mm; font-style: italic; }
.legend { display: flex; flex-wrap: wrap; gap: 4mm; margin-top: 3mm; font-size: 9pt; }
.legend-item { display: flex; align-items: center; gap: 1.5mm; }
.legend-swatch { width: 3mm; height: 3mm; display: inline-block; }
.company-card { display: grid; grid-template-columns: 14mm 1fr 38mm; gap: 5mm; padding: 5mm 0; border-bottom: 0.5px solid rgba(4,44,83,0.15); page-break-inside: avoid; }
.company-card .rank-num { font-family: 'Source Serif Pro', serif; font-size: 28pt; font-weight: 500; color: #042C53; line-height: 1; text-align: center; }
.company-card .body .name { font-family: 'Source Serif Pro', serif; font-size: 14pt; font-weight: 500; color: #042C53; margin-bottom: 1mm; }
.company-card .body .domain { font-family: 'IBM Plex Mono', monospace; font-size: 9pt; color: #0C447C; margin-bottom: 2mm; }
.company-card .body .one-liner { font-size: 10pt; margin-bottom: 2mm; }
.company-card .body .meta-row { display: flex; gap: 3mm; font-size: 8.5pt; color: #5F5E5A; margin-bottom: 2mm; flex-wrap: wrap; }
.company-card .body .notes { font-size: 9pt; color: #5F5E5A; font-style: italic; }
.company-card .visibility { text-align: right; font-size: 9pt; color: #0C447C; }
.company-card .visibility .pill { display: inline-block; background: #042C53; color: #FFFFFF; padding: 1.5mm 3.5mm; font-family: 'IBM Plex Mono', monospace; font-size: 9pt; margin-bottom: 2mm; font-weight: 500; }
.company-card .visibility .pill.score-1 { background: #888780; }
.company-card .visibility .pill.score-2 { background: #5F5E5A; }
.company-card .visibility .pill.score-3 { background: #0C447C; }
.company-card .visibility .pill.score-4 { background: #042C53; }
.company-card .visibility .llm-grid { display: inline-grid; grid-template-columns: repeat(4, 7mm); gap: 1mm; margin-top: 1mm; font-family: 'IBM Plex Mono', monospace; font-size: 7pt; text-align: center; }
.company-card .visibility .llm-grid div { padding: 1mm 0; background: #F1EFE8; color: #888780; }
.company-card .visibility .llm-grid div.cited { background: #042C53; color: #FFFFFF; }
.company-card .visibility .ai-note { font-size: 8.5pt; color: #5F5E5A; margin-top: 2mm; line-height: 1.4; }
.insight { border-left: 3px solid #EF9F27; border-top: 0.5px solid #042C53; border-right: 0.5px solid #042C53; border-bottom: 0.5px solid #042C53; padding: 6mm 7mm; margin: 4mm 0; page-break-inside: avoid; }
.insight .title { font-family: 'Source Serif Pro', serif; font-size: 13pt; font-weight: 500; color: #042C53; margin-bottom: 2mm; }
.sources-table { width: 100%; border-collapse: collapse; margin: 4mm 0; font-size: 9pt; }
.sources-table th { text-align: left; padding: 2mm 3mm; background: #042C53; color: #FFFFFF; font-size: 9pt; font-weight: 500; }
.sources-table td { padding: 2mm 3mm; border-bottom: 0.5px solid rgba(4,44,83,0.15); }
.sources-table tr:nth-child(even) td { background: #F8F7F2; }
.sources-table .url { font-family: 'IBM Plex Mono', monospace; font-size: 8pt; color: #0C447C; word-break: break-all; }
.glossary-item { margin-bottom: 4mm; page-break-inside: avoid; }
.glossary-item .term { font-family: 'Source Serif Pro', serif; font-size: 12pt; font-weight: 500; color: #042C53; margin-bottom: 1mm; }
.faq-item { margin: 4mm 0; padding: 4mm 0; border-bottom: 0.5px solid rgba(4,44,83,0.15); page-break-inside: avoid; }
.faq-item .q { font-family: 'Source Serif Pro', serif; font-size: 12pt; font-weight: 500; color: #042C53; margin-bottom: 2mm; }
.faq-item .q::before { content: "Q. "; color: #EF9F27; font-weight: 600; }
.faq-item .a::before { content: "A. "; color: #0C447C; font-weight: 600; }
.about-box { background: #042C53; color: #FFFFFF; padding: 8mm 10mm; margin: 12mm 0 8mm; }
.about-box h3, .about-box p { color: #FFFFFF; }
.legal-footer { font-size: 8pt; color: #888780; text-align: center; border-top: 0.5px solid rgba(4,44,83,0.2); padding-top: 4mm; margin-top: 8mm; }
.page-break { page-break-before: always; }
h2, h3 { page-break-after: avoid; }`;

  const escape = (s: any) => String(s || "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c] || c));

  // Cover
  let html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${escape(report.title)} — Geoperf</title><link href="https://fonts.googleapis.com/css2?family=Source+Serif+Pro:wght@400;500;600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet"><style>${css}</style></head><body>`;

  html += `<section class="cover">
    <div><div class="logo-mark">G</div><div class="label">${escape(report.serie_label)}</div></div>
    <div class="mid">
      <h1>${escape(report.title)}<span class="dot">.</span></h1>
      <div class="subtitle">${escape(report.subtitle)}</div>
      <div class="meta">
        <div><span class="lbl">Période</span>${escape(report.period)}</div>
        <div><span class="lbl">LLM analysés</span>${report.llms_count} modèles</div>
        <div><span class="lbl">Sociétés étudiées</span>${report.companies_count}</div>
        <div><span class="lbl">Sources web</span>${report.total_sources}</div>
      </div>
    </div>
    <div><div style="display:flex;justify-content:space-between;align-items:flex-end;font-size:9pt;opacity:0.7;">
      <div><div class="wordmark-bot">Ge<span style="color:#EF9F27">·</span>perf</div><div style="font-size:8pt;opacity:0.7;letter-spacing:2px;margin-top:2mm;">G E O P E R F . C O M</div></div>
      <div style="text-align:right;">Édition ${escape(report.edition_label)}<br><span class="mono">${escape(report.report_id_short)}</span></div>
    </div></div>
  </section>`;

  // TOC
  html += `<section><div class="caps">Sommaire</div><h2>Plan du rapport</h2><div class="toc"><ol>
    <li><span>Résumé exécutif</span><span class="pg">02</span></li>
    <li><span>Méthodologie</span><span class="pg">03</span></li>
    <li><span>Vue d'ensemble du secteur</span><span class="pg">04</span></li>
    <li><span>Analyse de visibilité IA</span><span class="pg">05</span></li>
    <li><span>Top ${report.top_n} sociétés</span><span class="pg">06</span></li>
    <li><span>Insights &amp; recommandations</span><span class="pg">08</span></li>
    <li><span>Sources web mobilisées</span><span class="pg">09</span></li>
    <li><span>Glossaire &amp; FAQ</span><span class="pg">10</span></li>
    <li><span>À propos de Geoperf</span><span class="pg">11</span></li>
  </ol></div></section>`;

  // Exec summary
  html += `<section class="page-break"><div class="caps">Section 01</div><h2>Résumé exécutif</h2>
    <div class="exec-block">${escape(sections.executive_summary)}</div>
    <h3>Chiffres clés</h3>
    <div class="kpi-grid">
      <div class="kpi-card featured"><div class="num">${report.companies_count}</div><div class="lbl">Sociétés identifiées</div></div>
      <div class="kpi-card"><div class="num">${stats.cited_by_4_llms + stats.cited_by_3_llms}</div><div class="lbl">Top tier (3-4 LLM)</div></div>
      <div class="kpi-card"><div class="num">${report.total_sources}</div><div class="lbl">Sources web</div></div>
      <div class="kpi-card"><div class="num">${report.llms_count}</div><div class="lbl">LLM interrogés</div></div>
    </div>
  </section>`;

  // Methodology
  const llmCards = report.llm_list.map((l: any) => `<div class="kpi-card"><div class="num" style="font-size:14pt;line-height:1.2;">${escape(l.label)}</div><div class="lbl">${escape(l.provider)}</div></div>`).join("");
  html += `<section class="page-break"><div class="caps">Section 02</div><h2>Méthodologie</h2>
    <p>${escape(sections.methodology)}</p>
    <h3>Modèles LLM interrogés</h3><div class="kpi-grid">${llmCards}</div>
    <h3>Pipeline de traitement</h3>
    <ol style="margin-left:6mm;">
      <li><strong>Extraction parallèle</strong> : chaque modèle reçoit le même prompt structuré.</li>
      <li><strong>Consolidation</strong> : dédoublonnage par domaine racine et nom normalisé.</li>
      <li><strong>Scoring</strong> : visibilité (0-${report.llms_count}), position moyenne, sources distinctes.</li>
      <li><strong>Stockage</strong> : réponses brutes conservées dans Supabase pour audit.</li>
      <li><strong>Synthèse</strong> : génération automatisée des sections du livre blanc.</li>
    </ol>
    <h3>Limites de l'étude</h3>
    <p class="subtle">Cette étude reflète une perception à un instant donné. Les LLM mettent à jour leur base de connaissances régulièrement. Geoperf publie une mise à jour semestrielle.</p>
  </section>`;

  // Sector overview + geo chart
  let geoChart = "";
  if (charts.geo_distribution.length > 0) {
    const slices = charts.geo_distribution.map((s: any) => `<path d="${s.path}" fill="${s.color}" stroke="#FFFFFF" stroke-width="0.5"/>`).join("");
    const legend = charts.geo_distribution.map((s: any) => `<div class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span><span>${escape(s.label)} <strong>(${s.count})</strong></span></div>`).join("");
    geoChart = `<h3>Répartition géographique</h3><div class="chart-section">
      <div><svg class="chart-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${slices}<circle cx="100" cy="100" r="35" fill="#FFFFFF"/><text x="100" y="98" font-family="serif" font-size="20" font-weight="500" fill="#042C53" text-anchor="middle">${report.companies_count}</text><text x="100" y="112" font-family="sans-serif" font-size="7" fill="#5F5E5A" text-anchor="middle" letter-spacing="1">SOCIÉTÉS</text></svg><div class="chart-caption">Distribution par pays de siège</div></div>
      <div><h4>Concentration géographique</h4><div class="legend">${legend}</div><p class="subtle" style="margin-top:4mm;">La concentration géographique reflète à la fois la réalité du marché et le biais de présence numérique des sources web indexées.</p></div>
    </div>`;
  }
  html += `<section class="page-break"><div class="caps">Section 03</div><h2>Vue d'ensemble du secteur</h2><p>${escape(sections.sector_overview)}</p>${geoChart}</section>`;

  // AI visibility analysis
  let pyramidSvg = "";
  if (charts.visibility_pyramid?.length) {
    const layers = charts.visibility_pyramid.map((l: any) => `<rect x="${l.x}" y="${l.y}" width="${l.width}" height="40" fill="${l.color}" stroke="#FFFFFF" stroke-width="1"/><text x="${l.x + l.width / 2}" y="${l.y + 18}" font-family="serif" font-size="16" font-weight="500" fill="#FFFFFF" text-anchor="middle">${l.count}</text><text x="${l.x + l.width / 2}" y="${l.y + 32}" font-family="sans-serif" font-size="9" fill="#FFFFFF" text-anchor="middle" opacity="0.85">${escape(l.label)}</text>`).join("");
    pyramidSvg = `<h3>Pyramide de visibilité</h3><svg class="chart-svg" viewBox="0 0 600 240" xmlns="http://www.w3.org/2000/svg" style="max-height:80mm;">${layers}</svg><div class="chart-caption">Pyramide inversée : plus la base est large, plus la perception est dispersée.</div>`;
  }
  let llmBarsSvg = "";
  if (charts.llm_generosity?.length) {
    const bars = charts.llm_generosity.map((b: any) => `<rect x="${b.x}" y="${b.y}" width="80" height="${b.height}" fill="${b.color}"/><text x="${b.x + 40}" y="${b.y - 5}" font-family="serif" font-size="14" font-weight="500" fill="#042C53" text-anchor="middle">${b.count}</text><text x="${b.x + 40}" y="180" font-family="sans-serif" font-size="9" fill="#2C2C2A" text-anchor="middle" font-weight="500">${escape(b.label)}</text><text x="${b.x + 40}" y="192" font-family="sans-serif" font-size="7" fill="#5F5E5A" text-anchor="middle">${escape(b.provider)}</text>`).join("");
    llmBarsSvg = `<h3>Générosité par LLM</h3><svg class="chart-svg" viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg" style="max-height:65mm;">${bars}<line x1="40" y1="160" x2="560" y2="160" stroke="#5F5E5A" stroke-width="0.5"/></svg><div class="chart-caption">Nombre de sociétés citées par chaque LLM.</div>`;
  }
  html += `<section class="page-break"><div class="caps">Section 04 — La section différenciante</div><h2>Analyse de visibilité IA</h2>
    <p style="font-size:10pt;color:#5F5E5A;margin-bottom:6mm;">Distribution des sociétés par nombre de LLM citants — sur ${report.companies_count} sociétés uniques.</p>
    <div class="kpi-grid">
      <div class="kpi-card featured"><div class="num">${stats.cited_by_4_llms}</div><div class="lbl">Cités par 4/4 LLM</div></div>
      <div class="kpi-card"><div class="num">${stats.cited_by_3_llms}</div><div class="lbl">Cités par 3/4 LLM</div></div>
      <div class="kpi-card"><div class="num">${stats.cited_by_2_llms}</div><div class="lbl">Cités par 2/4 LLM</div></div>
      <div class="kpi-card"><div class="num">${stats.cited_by_1_llm}</div><div class="lbl">Cité par 1/4 LLM</div></div>
    </div>
    <p>${escape(sections.ai_visibility_analysis)}</p>
    ${pyramidSvg}${llmBarsSvg}
  </section>`;

  // Top companies
  const companyCards = (sections.top_companies_summary || []).map((c: any, i: number) => {
    const co = companies[i] || {};
    const cells = llmKeys.map((k, idx) => `<div class="${co.cited_by?.[k] ? "cited" : ""}">${llmLabels[idx]}</div>`).join("");
    const meta = [];
    if (co.employees_range) meta.push(`<span>${escape(co.employees_range)} salariés</span>`);
    if (co.source_count) meta.push(`<span>${co.source_count} sources</span>`);
    if (co.avg_position != null) meta.push(`<span>position moy. ${co.avg_position}</span>`);
    return `<div class="company-card">
      <div><div class="rank-num">${String(c.rank).padStart(2, "0")}</div>${co.country ? `<div style="font-size:8pt;color:#5F5E5A;margin-top:1mm;text-align:center;">${escape(co.country)}</div>` : ""}</div>
      <div class="body">
        <div class="name">${escape(c.name)}</div>
        ${co.domain ? `<div class="domain">${escape(co.domain)}</div>` : ""}
        <div class="one-liner">${escape(c.one_liner)}</div>
        <div class="meta-row">${meta.join("")}</div>
        <div class="notes">${escape(c.context_note)}</div>
      </div>
      <div class="visibility">
        <div class="pill score-${co.visibility_score}">IA ${co.visibility_score}/${report.llms_count}</div>
        <div class="llm-grid">${cells}</div>
        <div class="ai-note">${escape(c.ai_visibility_note)}</div>
      </div>
    </div>`;
  }).join("");
  html += `<section class="page-break"><div class="caps">Section 05</div><h2>Top ${report.top_n} sociétés</h2>
    <p style="font-size:10pt;color:#5F5E5A;margin-bottom:4mm;">Classement consolidé. Score IA = nb LLM citants. Grille à droite : case sombre = cité, case claire = non.</p>
    <div class="company-list">${companyCards}</div>
  </section>`;

  // Insights
  const insightsHtml = (sections.insights_and_recommendations || []).map((i: any) =>
    `<div class="insight"><div class="title">${escape(i.title)}</div><div class="body">${escape(i.body)}</div></div>`
  ).join("");
  html += `<section class="page-break"><div class="caps">Section 06</div><h2>Insights &amp; recommandations</h2>${insightsHtml}</section>`;

  // Sources
  if (sources.length > 0) {
    const rows = sources.map((s: any) => `<tr><td><strong>${escape(s.publisher || "—")}</strong></td><td><div>${escape(s.title || "Source non titrée")}</div><div class="url">${escape(s.url)}</div></td><td style="text-align:center;font-family:'IBM Plex Mono',monospace;font-size:9pt;">${s.citations}×</td></tr>`).join("");
    html += `<section class="page-break"><div class="caps">Section 07</div><h2>Sources web mobilisées</h2>
      <p style="font-size:10pt;color:#5F5E5A;margin-bottom:4mm;">Liste consolidée des sources citées par les LLM.</p>
      <table class="sources-table"><thead><tr><th style="width:35mm;">Éditeur</th><th>Titre</th><th style="width:18mm;text-align:center;">Cité par</th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
  }

  // Glossary + FAQ
  html += `<section class="page-break"><div class="caps">Section 08 — Annexe A</div><h2>Glossaire</h2>
    <div class="glossary-item"><div class="term">LLM (Large Language Model)</div><div>Modèle d'IA entraîné sur de vastes corpus de texte. Exemples : ChatGPT, Gemini, Claude, Perplexity.</div></div>
    <div class="glossary-item"><div class="term">GEO (Generative Engine Optimization)</div><div>Discipline marketing visant à optimiser la visibilité d'une marque dans les LLM. Successeur du SEO.</div></div>
    <div class="glossary-item"><div class="term">Score de visibilité IA</div><div>Indicateur Geoperf 0-${report.llms_count} : nombre de LLM ayant cité la société.</div></div>
    <div class="glossary-item"><div class="term">Cohérence inter-LLM</div><div>Stabilité du classement à travers les LLM. Position #2 chez tous = perception consolidée.</div></div>
    <div class="glossary-item"><div class="term">Position moyenne</div><div>Moyenne des rangs attribués par les LLM citants. Plus c'est bas, mieux c'est.</div></div>
    <h2 style="margin-top:14mm;">FAQ</h2>
    <div class="faq-item"><div class="q">Pourquoi 4 LLM et pas 1 seul ?</div><div class="a">Chaque LLM a son corpus. Interroger 4 modèles isole les sociétés universellement reconnues vs perceptions singulières.</div></div>
    <div class="faq-item"><div class="q">Comment améliorer mon score de visibilité ?</div><div class="a">Présence Bloomberg/FT/Reuters, Wikipédia, contenu corporate, Forrester/Gartner. Geoperf propose des audits.</div></div>
    <div class="faq-item"><div class="q">Mise à jour ?</div><div class="a">Geoperf publie une édition semestrielle de chaque étude.</div></div>
    <div class="faq-item"><div class="q">Pourquoi des grands acteurs absents ?</div><div class="a">Une absence reflète l'absence dans la perception spontanée des LLM, pas du marché. C'est précisément le signal d'alerte.</div></div>
    <div class="faq-item"><div class="q">Étude sur ma catégorie ?</div><div class="a">Oui, sur mesure. Délai 7 jours ouvrés. contact@geoperf.com.</div></div>
  </section>`;

  // About
  html += `<section class="page-break"><div class="caps">Section 09</div><h2>À propos de Geoperf</h2>
    <div class="about-box"><h3>Notre mission</h3><p>${escape(sections.about_geoperf)}</p></div>
    <h3>Contact</h3><p><strong>Site :</strong> geoperf.com<br><strong>Email :</strong> contact@geoperf.com<br><strong>LinkedIn :</strong> linkedin.com/company/geoperf</p>
    <h3>Audits sur mesure</h3><p>Diagnostic complet, comparaison concurrentielle, plan d'action GEO. Réservez sur geoperf.com/contact.</p>
    <div class="legal-footer">
      Geoperf est un produit de Jourdechance SAS · SIREN 838 114 619 · RCS Nanterre · 31 rue Diaz, 92100 Boulogne-Billancourt<br>
      Étude générée le ${escape(report.generated_at_human)} · ID : ${escape(report.report_id)}<br>
      Reproduction interdite. Données issues des LLM interrogés.
    </div>
  </section>`;

  html += `</body></html>`;
  return html;
}

// ============== OPENROUTER SYNTHESIS ==============
async function callOpenRouter(consolidated: ConsolidatedPayload, openRouterKey: string, model = "anthropic/claude-sonnet-4.6"): Promise<any> {
  const compactCompanies = consolidated.companies.map(c => ({
    r: c.rank_consolidated,
    n: c.name,
    ctry: c.country,
    viz: c.visibility_score,
    cited: Object.entries(c.cited_by || {}).filter(([, v]) => v).map(([k]) => k),
    desc: (c.best_description || "").substring(0, 150),
  }));

  const systemPrompt = "Tu rédiges des études sectorielles institutionnelles pour Geoperf (style FT/Forrester). Sortie : JSON STRICT démarrant par {.";
  const userPrompt = `Étude ${consolidated.category} ${consolidated.year} pour livre blanc 12+ pages.

Données: ${consolidated.stats.total_unique_companies} sociétés. Stats: ${JSON.stringify(consolidated.stats)}

${JSON.stringify(compactCompanies)}

JSON STRICT (commence par {):
{
  "executive_summary": "250-300 mots, OUVRE sur LE chiffre marquant. Style FT.",
  "methodology": "200-250 mots: 4 LLM via OpenRouter, dédoublonnage, scoring 0-4.",
  "sector_overview": "350-400 mots vue secteur ${consolidated.category}: dynamiques, géographie, enjeux 2026.",
  "ai_visibility_analysis": "500-600 mots: pyramide visibilité, analyse par LLM, biais géographique, conséquence pour CMO.",
  "top_companies_summary": [{"rank":1,"name":"...","one_liner":"max 25 mots","ai_visibility_note":"1 phrase","context_note":"1 phrase"}, ...${consolidated.companies.length} items],
  "insights_and_recommendations": [{"title":"...","body":"100-150 mots"}, ...5 items],
  "about_geoperf": "100-120 mots, mentionne Jourdechance SAS SIREN 838 114 619"
}

Aucun chiffre hors données fournies.`;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://geoperf.com",
      "X-Title": "GEOPERF Edge Function Synthesis",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 8000,
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`OpenRouter error: ${JSON.stringify(data.error)}`);
  let txt = data.choices[0].message.content;
  // Strip markdown fences
  txt = txt.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  const startIdx = txt.indexOf("{");
  if (startIdx > 0) txt = txt.substring(startIdx);
  const endIdx = txt.lastIndexOf("}");
  if (endIdx >= 0) txt = txt.substring(0, endIdx + 1);
  const sections = JSON.parse(txt);
  return { sections, cost: data.usage?.cost || 0, tokens: data.usage };
}

// ============== MAIN HANDLER ==============
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json();
    const reportId: string = body.report_id;
    const model: string = body.model || "anthropic/claude-sonnet-4.6";
    const topN: number = body.top_n || 50;
    if (!reportId) return new Response(JSON.stringify({ error: "report_id required" }), { status: 400 });

    // Init Supabase client (service role)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Fetch consolidated payload
    const { data: rcData, error: rcErr } = await supabase
      .from("report_companies")
      .select("rank, cited_by, visibility_score, avg_position_in_lists, source_count, companies(nom, nom_normalise, domain, country, employees_range, description)")
      .eq("report_id", reportId)
      .order("rank");
    if (rcErr) throw new Error(`DB fetch error: ${rcErr.message}`);
    if (!rcData || rcData.length === 0) throw new Error(`No companies for report ${reportId}`);

    const { data: reportRow } = await supabase.from("reports").select("sous_categorie").eq("id", reportId).single();

    // Build consolidated structure
    const companies: Company[] = rcData.map((rc: any) => ({
      rank_consolidated: rc.rank,
      name: rc.companies.nom,
      domain: rc.companies.domain,
      country: rc.companies.country,
      employees_range: rc.companies.employees_range,
      best_description: rc.companies.description,
      cited_by: rc.cited_by,
      visibility_score: rc.visibility_score,
      avg_position: rc.avg_position_in_lists,
      source_count: rc.source_count,
      sources: [], // Sources fetched separately if needed (skip for v1)
    }));

    const stats = {
      total_unique_companies: companies.length,
      cited_by_4_llms: companies.filter(c => c.visibility_score === 4).length,
      cited_by_3_llms: companies.filter(c => c.visibility_score === 3).length,
      cited_by_2_llms: companies.filter(c => c.visibility_score === 2).length,
      cited_by_1_llm:  companies.filter(c => c.visibility_score === 1).length,
    };

    const consolidated: ConsolidatedPayload = {
      report_id: reportId,
      category: reportRow?.sous_categorie || "Étude sectorielle",
      year: 2026,
      providers_used: ["perplexity", "openai", "google", "anthropic"],
      companies,
      stats,
    };

    // 2. Call OpenRouter for synthesis
    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY")!;
    const { sections, cost, tokens } = await callOpenRouter(consolidated, openRouterKey, model);

    // 3. Compute charts
    const charts = {
      geo_distribution: computeGeoDistribution(companies),
      visibility_pyramid: computeVisibilityPyramid(stats),
      llm_generosity: computeLLMBars(companies, consolidated.providers_used),
    };

    // 4. Build context
    const llmPretty: Record<string, { label: string; provider: string }> = {
      perplexity: { label: "Sonar Pro", provider: "Perplexity" },
      openai:     { label: "GPT-4o",    provider: "OpenAI" },
      google:     { label: "Gemini 2.5", provider: "Google" },
      anthropic:  { label: "Sonnet 4.6", provider: "Anthropic" },
    };
    const now = new Date();
    const ctx = {
      report: {
        title: consolidated.category,
        subtitle: "État de la visibilité des acteurs majeurs dans les LLM en 2026.",
        serie_label: "LLM Visibility Research",
        period: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
        edition_label: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
        generated_at_human: now.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
        report_id: reportId,
        report_id_short: reportId.substring(0, 8).toUpperCase(),
        llms_count: consolidated.providers_used.length,
        llm_list: consolidated.providers_used.map(p => llmPretty[p]).filter(Boolean),
        companies_count: stats.total_unique_companies,
        top_n: Math.min(topN, sections.top_companies_summary?.length || companies.length),
        total_sources: 0, // skipped for v1
      },
      sections,
      stats,
      companies,
      charts,
      sources: [], // skipped for v1
    };

    // 5. Render HTML
    const html = renderHTML(ctx);

    // 6. Upload to Storage
    const fileName = `${reportId}.html`;
    const { error: uploadErr } = await supabase.storage
      .from("white-papers")
      .upload(fileName, html, {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });
    if (uploadErr) throw new Error(`Storage upload error: ${uploadErr.message}`);

    // 7. Create signed URL (24h validity)
    const { data: urlData, error: urlErr } = await supabase.storage
      .from("white-papers")
      .createSignedUrl(fileName, 60 * 60 * 24);
    if (urlErr) throw new Error(`Signed URL error: ${urlErr.message}`);
    const htmlUrl = urlData.signedUrl;

    // 8. Update report
    await supabase.from("reports").update({
      html_url: htmlUrl,
      total_cost_usd: cost,
      completed_at: new Date().toISOString(),
      status: "ready",
    }).eq("id", reportId);

    return new Response(JSON.stringify({
      ok: true,
      report_id: reportId,
      html_url: htmlUrl,
      sections_keys: Object.keys(sections),
      stats,
      cost_usd: cost,
      tokens,
      html_size_bytes: html.length,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[ERROR]", e);
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
