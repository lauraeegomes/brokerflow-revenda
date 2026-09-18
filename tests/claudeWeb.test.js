import { describe, it, expect, vi, afterEach } from "vitest";
import { lerResposta, pesquisarNaWebClaude } from "@/lib/claudeWeb.js";
import { pesquisar } from "@/lib/pesquisaWeb.js";

const resposta = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_WORKSPACE_ID;
});

describe("lerResposta", () => {
  it("junta o texto e usa como fonte só as páginas devolvidas pela busca", () => {
    const r = lerResposta([
      { type: "text", text: "Olá " },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://www.zapimoveis.com.br/a", title: "x" }] },
      { type: "text", text: "mundo" },
    ]);
    expect(r.texto).toBe("Olá mundo");
    expect(r.fontes).toEqual([{ uri: "https://www.zapimoveis.com.br/a", title: "zapimoveis.com.br" }]);
  });
});

describe("pesquisarNaWebClaude", () => {
  it("sem chave, avisa que não está configurado", async () => {
    await expect(pesquisarNaWebClaude("x")).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("continua quando a API devolve pause_turn e envia o workspace quando configurado", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-teste";
    process.env.ANTHROPIC_WORKSPACE_ID = "wrkspc_teste";
    const chamadas = [];
    vi.stubGlobal("fetch", async (url, init) => {
      chamadas.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return chamadas.length === 1
        ? resposta({ stop_reason: "pause_turn", content: [{ type: "web_search_tool_result", content: [{ url: "https://vivareal.com.br/x" }] }] })
        : resposta({ stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":1}' }] });
    });
    const r = await pesquisarNaWebClaude("pergunta");
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].headers["anthropic-workspace-id"]).toBe("wrkspc_teste");
    expect(chamadas[0].body.tools[0].name).toBe("web_search");
    expect(chamadas[1].body.messages).toHaveLength(2); // a vez devolvida foi reenviada
    expect(r.texto).toBe('{"ok":1}');
    expect(r.fontes[0].title).toBe("vivareal.com.br");
  });

  it("traduz erros da API para mensagens claras", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-teste";
    const falha = (status, corpo) => vi.stubGlobal("fetch", async () => resposta(corpo, status));
    falha(401, "{}");
    await expect(pesquisarNaWebClaude("x")).rejects.toThrow(/inválida/);
    falha(429, "{}");
    await expect(pesquisarNaWebClaude("x")).rejects.toThrow(/Limite/);
    falha(400, '{"error":{"message":"Your credit balance is too low"}}');
    await expect(pesquisarNaWebClaude("x")).rejects.toThrow(/sem saldo/);
    falha(400, '{"error":{"message":"must include the anthropic-workspace-id header"}}');
    await expect(pesquisarNaWebClaude("x")).rejects.toThrow(/workspace/);
  });
});

describe("pesquisar (escolha do buscador)", () => {
  it("usa Claude quando há ANTHROPIC_API_KEY, senão Gemini, senão erro", async () => {
    await expect(pesquisar("x")).rejects.toThrow(/não está configurada/);
    process.env.GEMINI_API_KEY = "g";
    vi.stubGlobal("fetch", async (url) => {
      expect(String(url)).toContain("generativelanguage");
      return resposta({ candidates: [{ content: { parts: [{ text: "gem" }] } }] });
    });
    expect((await pesquisar("x")).modelo).toBe("gemini-web");
    process.env.ANTHROPIC_API_KEY = "sk-ant-teste";
    vi.stubGlobal("fetch", async (url) => {
      expect(String(url)).toContain("api.anthropic.com");
      return resposta({ stop_reason: "end_turn", content: [{ type: "text", text: "cla" }] });
    });
    expect((await pesquisar("x")).modelo).toBe("claude-web");
  });
});
