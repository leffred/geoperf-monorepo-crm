#!/usr/bin/env bash
# GEOPERF — Test rapide multi-LLM via OpenRouter
# Usage : OR_KEY=sk-or-... ./prompts/phase1/_test_openrouter.sh "Mon prompt"
# Si OR_KEY non fourni, lit depuis Supabase Vault (project qfdvdcvqknoqfxetttch).

set -euo pipefail

PROMPT="${1:-Listez les 3 plus grandes sociétés d'asset management en 2026 (nom, site, pays, AUM en milliards USD). JSON strict.}"

if [ -z "${OR_KEY:-}" ]; then
  echo "Variable OR_KEY non définie. Récupère-la via Supabase MCP execute_sql:" >&2
  echo "  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='openrouter_api_key';" >&2
  exit 1
fi

MODELS=(
  "perplexity/sonar-pro"           # Web search natif, sources fraîches
  "openai/gpt-4o-search-preview"   # GPT-4o avec web search
  "google/gemini-2.5-pro"          # Gemini, cutoff fin 2024
  "anthropic/claude-sonnet-4.6"    # Claude, cutoff début 2025
)

for MODEL in "${MODELS[@]}"; do
  echo "=== $MODEL ==="
  START=$(date +%s%N)
  RESP=$(curl -s https://openrouter.ai/api/v1/chat/completions \
    -H "Authorization: Bearer $OR_KEY" \
    -H "Content-Type: application/json" \
    -H "HTTP-Referer: https://geoperf.com" \
    -H "X-Title: GEOPERF Phase 1 Test" \
    -d "{
      \"model\": \"$MODEL\",
      \"messages\": [{\"role\":\"user\",\"content\":$(printf '%s' "$PROMPT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}],
      \"max_tokens\": 1500,
      \"temperature\": 0.2
    }")
  END=$(date +%s%N)
  DUR_MS=$(( (END - START) / 1000000 ))

  echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d:
    print('ERROR:', d['error'])
else:
    msg = d['choices'][0]['message']['content']
    usage = d.get('usage', {})
    cost = usage.get('cost', 0)
    print(f'tokens: {usage.get(\"prompt_tokens\")}/{usage.get(\"completion_tokens\")} | cost: \${cost:.5f} | duration: ${DUR_MS}ms')
    print('--- response ---')
    print(msg)
"
  echo ""
done
