import { describe, it, expect } from "vitest";
import { processarPesquisa, paraNumero, extrairJson } from "@/lib/pricing.js";

const c = (preco, area, host = "zapimoveis.com.br", extra = {}) => ({
  fonte: host, descricao: "x", preco, area_m2: area, link: `https://${host}/imovel/${preco}`, similaridade: "alta", ...extra,
});
const fontes = [{ title: "zapimoveis.com.br" }, { title: "vivareal.com.br" }];

describe("paraNumero", () => {
  it("entende formatos brasileiros", () => {
    expect(paraNumero("R$ 1.890.000,00")).toBe(1890000);
    expect(paraNumero("850.000")).toBe(850000);
    expect(paraNumero("850.50")).toBe(850.5);
    expect(paraNumero(1200)).toBe(1200);
    expect(paraNumero("abc")).toBeNull();
  });
});

describe("extrairJson", () => {
  it("lê JSON dentro de cercas de markdown e texto", () => {
    expect(extrairJson('texto ```json\n{"a":1}\n``` fim')).toEqual({ a: 1 });
    expect(extrairJson("sem json")).toBeNull();
  });
});

describe("processarPesquisa", () => {
  it("recalcula os cenários: média × 0,85 / 0,90 / 0,95 (a IA pode errar a conta)", () => {
    const r = processarPesquisa(
      { comparaveis: [c(900000, 100), c(1000000, 100), c(1100000, 100)], sugestao_preco_recomendado: 1 },
      fontes,
    );
    expect(r.sugestao_preco_recomendado).toBe(900000); // média 1.000.000 × 0,90
    expect(r.sugestao_preco_agressivo).toBe(850000);
    expect(r.sugestao_preco_otimista).toBe(950000);
    expect(r.sugestao_preco_agressivo).toBeLessThan(r.sugestao_preco_recomendado);
    expect(r.sugestao_preco_recomendado).toBeLessThan(r.sugestao_preco_otimista);
    expect(r.preco_m2_medio).toBe(10000);
  });

  it("descarta comparável sem link real (regra anti-invenção)", () => {
    const r = processarPesquisa({ comparaveis: [c(900000, 100), { ...c(5000000, 100), link: "" }, { ...c(6000000, 100), link: "sem-url" }] }, fontes);
    expect(r.comparaveis).toHaveLength(1);
  });

  it("retorna null quando não há comparáveis utilizáveis", () => {
    expect(processarPesquisa({ comparaveis: [] }, fontes)).toBeNull();
    expect(processarPesquisa({ comparaveis: [{ preco: 0, area_m2: 0, link: "https://a.com" }] }, fontes)).toBeNull();
    expect(processarPesquisa(null, fontes)).toBeNull();
  });

  it("remove valores fora da curva de preço/m² quando há amostra suficiente", () => {
    const comps = [c(1000000, 100), c(1020000, 100), c(980000, 100), c(1010000, 100), c(9000000, 100)];
    const r = processarPesquisa({ comparaveis: comps }, fontes);
    expect(r.comparaveis.find((x) => x.preco === 9000000)).toBeUndefined();
    expect(r.sugestao_preco_recomendado).toBeLessThan(1000000);
    expect(r.analise).toMatch(/fora da curva/);
  });

  it("prefere comparáveis confirmados nas fontes pesquisadas quando há ao menos 3", () => {
    const comps = [c(1000000, 100), c(1010000, 100), c(990000, 100), c(3000000, 100, "site-inventado.com")];
    const r = processarPesquisa({ comparaveis: comps }, fontes);
    expect(r.comparaveis.every((x) => x.verificado)).toBe(true);
    expect(r.comparaveis).toHaveLength(3);
  });

  it("aceita preço/área como texto e inclui a referência por m² na análise", () => {
    const r = processarPesquisa({ comparaveis: [c("R$ 900.000,00", "100 m²")], analise: "ok" }, fontes, "120");
    expect(r.comparaveis[0].preco).toBe(900000);
    expect(r.analise).toMatch(/Referência por m²/);
    expect(r.analise).toMatch(/120 m²/);
  });
});
