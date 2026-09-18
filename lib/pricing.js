/**
 * Precificação: pós-processamento da pesquisa web. Funções puras (testadas em tests/pricing.test.js).
 * Regras de negócio do BrokerFlow (docs/regras-de-negocio.md do protótipo):
 *   Agressivo = média × 0,85 · Recomendado = média × 0,90 · Otimista = média × 0,95
 * onde "média" é a média dos PREÇOS PEDIDOS dos comparáveis. A IA pode errar a conta, então ela é refeita aqui.
 */

export function paraNumero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").replace(/R\$|\s|m²|m2/gi, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function extrairJson(texto) {
  const limpo = String(texto || "").replace(/```json|```/g, "");
  const m = limpo.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function hostDe(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const mediana = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const arred100 = (v) => Math.round(v / 100) * 100;
const brl = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @param bruto   JSON devolvido pelo modelo (comparaveis, analise...)
 * @param fontes  [{uri, title}] — fontes que o buscador realmente consultou (grounding)
 * @param areaImovel área do imóvel captado (m²), opcional
 * @returns objeto no formato que a interface espera, ou null se não há comparáveis utilizáveis
 */
export function processarPesquisa(bruto, fontes = [], areaImovel = null) {
  if (!bruto || !Array.isArray(bruto.comparaveis)) return null;

  const dominiosFontes = new Set(
    fontes.map((f) => String(f.title || "").toLowerCase().replace(/^www\./, "")).filter(Boolean),
  );
  const confere = (host) =>
    !!host && [...dominiosFontes].some((d) => host === d || host.endsWith("." + d) || d.endsWith("." + host));

  let comps = bruto.comparaveis
    .map((c) => {
      const preco = paraNumero(c.preco);
      const area = paraNumero(c.area_m2);
      const link = /^https?:\/\//i.test(String(c.link || "")) ? String(c.link) : "";
      return {
        ...c,
        preco,
        area_m2: area,
        preco_m2: preco && area ? Math.round(preco / area) : null,
        link,
        verificado: !!link && (dominiosFontes.size === 0 ? true : confere(hostDe(link))),
      };
    })
    .filter((c) => c.preco > 0 && c.area_m2 > 0 && c.link);

  // Sem link real não há comparável (regra anti-invenção). Se há ≥3 verificados, descarta os não verificados.
  const verificados = comps.filter((c) => c.verificado);
  if (verificados.length >= 3) comps = verificados;

  // Remove valores fora da curva (preço/m² muito distante da mediana), quando há amostra suficiente.
  let descartados = 0;
  if (comps.length >= 5) {
    const med = mediana(comps.map((c) => c.preco_m2));
    const dentro = comps.filter((c) => c.preco_m2 >= med * 0.5 && c.preco_m2 <= med * 1.8);
    descartados = comps.length - dentro.length;
    comps = dentro;
  }
  if (comps.length === 0) return null;

  const media = comps.reduce((s, c) => s + c.preco, 0) / comps.length;
  const m2s = comps.map((c) => c.preco_m2);
  const m2Medio = Math.round(m2s.reduce((s, v) => s + v, 0) / m2s.length);

  const agressivo = arred100(media * 0.85);
  const recomendado = arred100(media * 0.9);
  const otimista = arred100(media * 0.95);

  let analise = String(bruto.analise || "").trim();
  const notas = [];
  notas.push(`Base: ${comps.length} comparáveis com link (${comps.filter((c) => c.verificado).length} confirmados nas fontes pesquisadas); média dos preços pedidos ${brl(media)}.`);
  if (descartados) notas.push(`${descartados} anúncio(s) fora da curva de preço/m² foram desconsiderados.`);
  const area = paraNumero(areaImovel);
  if (area > 0) notas.push(`Referência por m²: ${brl(m2Medio)}/m² × ${area} m² = ${brl(m2Medio * area)} (preço pedido; aplique o desconto do cenário escolhido).`);
  analise = [analise, notas.join(" ")].filter(Boolean).join("\n\n");

  return {
    comparaveis: comps.map((c) => ({
      fonte: c.fonte || hostDe(c.link),
      descricao: c.descricao || c.titulo || "",
      area_m2: c.area_m2,
      preco: c.preco,
      preco_m2: c.preco_m2,
      link: c.link,
      similaridade: ["alta", "média", "baixa"].includes(String(c.similaridade).toLowerCase())
        ? String(c.similaridade).toLowerCase()
        : "média",
      data_referencia: c.data_referencia || "",
      verificado: c.verificado,
    })),
    preco_m2_minimo: Math.min(...m2s),
    preco_m2_medio: m2Medio,
    preco_m2_maximo: Math.max(...m2s),
    sugestao_preco_agressivo: agressivo,
    sugestao_preco_recomendado: recomendado,
    sugestao_preco_otimista: otimista,
    tempo_medio_venda: bruto.tempo_medio_venda || "",
    desconto_medio: "10% (faixa 8–12%)",
    liquidez: bruto.liquidez || "",
    analise,
    fontes_consultadas: [...new Set([...(bruto.fontes_consultadas || []), ...comps.map((c) => hostDe(c.link))].filter(Boolean))],
  };
}

export const REGRAS_PESQUISA = `

INSTRUÇÕES ADICIONAIS OBRIGATÓRIAS (pesquisa na web):
- Use a busca do Google para consultar anúncios REAIS em portais (ZAP Imóveis, VivaReal, QuintoAndar, OLX, Imovelweb, Chaves na Mão) e em sites de imobiliárias da região.
- Devolva de 5 a 10 comparáveis. Cada comparável precisa do campo "link" com a URL da página do anúncio que você de fato consultou. Sem link real, NÃO inclua o comparável.
- "preco" e "area_m2" devem ser NÚMEROS (sem R$, sem pontos de milhar).
- Não invente fonte, link, valor ou data. Se achar menos de 3 anúncios reais, devolva só os que achou.
- Responda somente o JSON pedido.`;
