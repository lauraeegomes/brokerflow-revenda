import crypto from "node:crypto";
import { tokenLatitude, LATITUDE_BASE } from "./latitudeAdapter.ts";

/**
 * IA do Latitude ("Insight"): POST /api/insight/chat com resposta em streaming (SSE).
 * Serve para gerar texto (descrição do anúncio) e analisar imagens (fotos). Não tem acesso à web.
 */
export async function insightChat({ message, images = [], timeoutMs = 120_000 }) {
  const token = await tokenLatitude();
  const res = await fetch(`${LATITUDE_BASE}/insight/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    body: JSON.stringify({
      message,
      conversationId: crypto.randomUUID(), // conversa nova a cada chamada: sem memória cruzada entre captações
      images: images.length ? images : undefined,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) throw new Error(`IA do Latitude indisponível (HTTP ${res.status}).`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let texto = "";
  let erro = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const bloco = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const linha = bloco.split("\n").find((l) => l.startsWith("data:"));
      if (!linha) continue;
      let ev;
      try {
        ev = JSON.parse(linha.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === "delta") texto += ev.delta ?? "";
      else if (ev.type === "error") erro = ev.error || "erro";
    }
  }
  if (!texto.trim()) {
    throw new Error(erro ? "A IA do Latitude está indisponível no momento. Tente novamente em instantes." : "A IA não retornou resposta.");
  }
  return texto.trim();
}

/** Reduz a imagem (lado maior 1280px, JPEG) antes de enviar: mais rápido e cabe no limite de corpo. */
export async function prepararImagem(base64, mediaType) {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(Buffer.from(base64, "base64"))
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { mediaType: "image/jpeg", base64: out.toString("base64") };
  } catch {
    return { mediaType: mediaType || "image/jpeg", base64 };
  }
}
