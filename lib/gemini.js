/**
 * Pesquisa na web via Gemini com "Grounding with Google Search".
 * Env: GEMINI_API_KEY (obrigatória p/ precificação), GEMINI_MODEL (padrão gemini-2.5-flash).
 */
export function geminiConfigurado() {
  return !!process.env.GEMINI_API_KEY;
}

export async function pesquisarNaWeb(prompt, { timeoutMs = 150_000 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("A pesquisa na web não está configurada (falta GEMINI_API_KEY).");
  const modelo = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Limite da pesquisa na web atingido. Tente novamente em alguns minutos.");
    if (res.status === 400 || res.status === 403) throw new Error("Chave da pesquisa na web inválida ou sem permissão.");
    throw new Error(`Pesquisa na web indisponível (HTTP ${res.status}). ${corpo.slice(0, 120)}`);
  }
  const j = await res.json();
  const cand = j.candidates?.[0];
  const texto = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
  const fontes = (cand?.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web)
    .filter(Boolean)
    .map((w) => ({ uri: w.uri, title: w.title }));
  return { texto, fontes };
}
