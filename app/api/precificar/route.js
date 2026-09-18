import { api, exigirUsuario, permitir, HttpError } from "@/lib/auth.js";
import { auditar } from "@/lib/db.js";
import { pesquisar } from "@/lib/pesquisaWeb.js";
import { extrairJson, processarPesquisa, REGRAS_PESQUISA } from "@/lib/pricing.js";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const erro = (status, message) =>
  Response.json({ type: "error", error: { type: "api_error", message } }, { status });

/**
 * Precificação com pesquisa em referências da web (não usa a base do Latitude).
 * Entrada: { prompt, area } — o `prompt` é o mesmo do protótipo (regras + formato JSON).
 * Saída no formato "mensagem" que a interface já sabe ler; os números dos cenários são recalculados aqui.
 */
export const POST = api(async (request) => {
  const user = await exigirUsuario(request);
  if (!(await permitir(`preco:${user.id}`, 40, 3600))) {
    throw new HttpError(429, "Limite de precificações por hora atingido. Tente mais tarde.");
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Requisição inválida.");
  }
  const prompt = String(body?.prompt || "");
  if (prompt.length < 50 || prompt.length > 20_000) throw new HttpError(400, "Pedido de precificação inválido.");

  let pesquisa;
  try {
    pesquisa = await pesquisar(prompt + REGRAS_PESQUISA);
  } catch (e) {
    await auditar(user.id, "precificacao_erro", { erro: String(e?.message || e).slice(0, 200) });
    return erro(502, e?.message || "Falha na pesquisa na web.");
  }

  const bruto = extrairJson(pesquisa.texto);
  const final = processarPesquisa(bruto, pesquisa.fontes, body?.area);
  if (!final) {
    await auditar(user.id, "precificacao_sem_comparaveis", { fontes: pesquisa.fontes.length });
    return erro(
      422,
      "Não encontrei anúncios comparáveis com link para este imóvel. Revise bairro/tipo/área ou adicione comparáveis manualmente.",
    );
  }
  await auditar(user.id, "precificacao", { comparaveis: final.comparaveis.length });
  return Response.json({
    id: "msg_" + Date.now().toString(36),
    type: "message",
    role: "assistant",
    model: pesquisa.modelo,
    content: [{ type: "text", text: JSON.stringify(final) }],
    stop_reason: "end_turn",
  });
});
