import { api, exigirUsuario, permitir, HttpError } from "@/lib/auth.js";
import { auditar } from "@/lib/db.js";
import { insightChat, prepararImagem } from "@/lib/insight.js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Compatível com o formato da API de mensagens da Anthropic, mas quem responde é a IA do Latitude (Insight).
 * O protótipo continua chamando "https://api.anthropic.com/v1/messages"; o navegador redireciona para cá.
 * Usada para: descrição comercial do anúncio e análise de fotos. (A precificação com pesquisa na web é /api/precificar.)
 */
export const POST = api(async (request) => {
  const user = await exigirUsuario(request);
  if (!(await permitir(`ia:${user.id}`, 300, 3600))) {
    throw new HttpError(429, "Limite de uso da IA atingido nesta hora. Tente novamente mais tarde.");
  }
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Requisição inválida.");
  }
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const ultima = msgs[msgs.length - 1];
  if (!ultima || ultima.role !== "user") throw new HttpError(400, "Mensagem ausente.");
  if (Array.isArray(body.tools) && body.tools.length) {
    throw new HttpError(400, "Pesquisa na web não está disponível nesta rota (use /api/precificar).");
  }

  let texto = "";
  const imagens = [];
  if (typeof ultima.content === "string") texto = ultima.content;
  else if (Array.isArray(ultima.content)) {
    for (const b of ultima.content) {
      if (b?.type === "text") texto += (texto ? "\n" : "") + String(b.text || "");
      else if (b?.type === "image" && b.source?.type === "base64" && b.source.data) {
        if (imagens.length >= 4) continue;
        imagens.push(await prepararImagem(b.source.data, b.source.media_type));
      }
    }
  }
  if (!texto.trim() && imagens.length === 0) throw new HttpError(400, "Mensagem vazia.");
  if (texto.length > 40_000) throw new HttpError(413, "Mensagem longa demais.");

  let resposta;
  try {
    resposta = await insightChat({ message: texto, images: imagens });
  } catch (e) {
    await auditar(user.id, "ia_erro", { erro: String(e?.message || e).slice(0, 200) });
    return Response.json(
      { type: "error", error: { type: "api_error", message: e?.message || "Falha na IA do Latitude." } },
      { status: 502 },
    );
  }
  return Response.json({
    id: "msg_" + Date.now().toString(36),
    type: "message",
    role: "assistant",
    model: "latitude-insight",
    content: [{ type: "text", text: resposta }],
    stop_reason: "end_turn",
  });
});
