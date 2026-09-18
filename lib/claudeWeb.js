/**
 * Pesquisa na web via Claude (Anthropic) com a ferramenta `web_search`.
 * Env: ANTHROPIC_API_KEY, ANTHROPIC_MODEL (padrão claude-sonnet-5),
 *      ANTHROPIC_WORKSPACE_ID (só se a chave não for vinculada a um workspace).
 */
export function claudeConfigurado() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const hostDe = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** Junta o texto e as fontes (páginas realmente devolvidas pela busca) de uma resposta da API. */
export function lerResposta(content) {
  let texto = "";
  const fontes = [];
  for (const b of content || []) {
    if (b.type === "text") texto += b.text || "";
    else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r?.url) fontes.push({ uri: r.url, title: hostDe(r.url) });
    }
  }
  return { texto: texto.trim(), fontes };
}

export async function pesquisarNaWebClaude(prompt, { timeoutMs = 150_000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("A pesquisa na web não está configurada (falta ANTHROPIC_API_KEY).");
  const headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
  if (process.env.ANTHROPIC_WORKSPACE_ID) headers["anthropic-workspace-id"] = process.env.ANTHROPIC_WORKSPACE_ID;
  const modelo = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const limite = Date.now() + timeoutMs;

  const messages = [{ role: "user", content: prompt }];
  const todas = [];
  // "pause_turn": a busca é longa e a API devolve a vez; basta reenviar para continuar (no máximo 3 vezes).
  for (let volta = 0; volta < 4; volta++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelo,
        max_tokens: 6000,
        temperature: 0.2,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8, user_location: { type: "approximate", country: "BR", timezone: "America/Sao_Paulo" } }],
        messages,
      }),
      signal: AbortSignal.timeout(Math.max(5_000, limite - Date.now())),
    });
    if (!res.ok) {
      const corpo = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Limite da pesquisa na web atingido. Tente novamente em alguns minutos.");
      if (res.status === 401 || res.status === 403) throw new Error("Chave da pesquisa na web inválida ou sem permissão.");
      if (res.status === 400 && /credit|balance/i.test(corpo)) throw new Error("A conta de IA da pesquisa está sem saldo.");
      if (res.status === 400 && /workspace/i.test(corpo)) throw new Error("A chave da pesquisa exige o ID do workspace (ANTHROPIC_WORKSPACE_ID).");
      throw new Error(`Pesquisa na web indisponível (HTTP ${res.status}). ${corpo.slice(0, 120)}`);
    }
    const j = await res.json();
    todas.push(...(j.content || []));
    if (j.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: j.content });
  }
  return lerResposta(todas);
}
