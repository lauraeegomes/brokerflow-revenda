import { randomBytes } from "node:crypto";
import { HttpError } from "./auth.js";

/**
 * Fotos das captações ficam no Supabase Storage (bucket privado "brokerflow-fotos"), não dentro
 * do registro da captação — é o que permite passar de ~15 fotos sem esbarrar no limite de 4 MB
 * por registro do `kv`. Só este servidor fala com o bucket (chave service_role, nunca exposta ao
 * cliente); o cliente sobe/lê fotos através das rotas /api/fotos/*, que conferem a mesma permissão
 * de quem pode ver a captação.
 */

const BUCKET = "brokerflow-fotos";
const MAX_BYTES = 8_000_000; // folga sobre os ~900px/qualidade 0.72 que o app já usa (tipicamente 150–400 KB)

function base() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados.");
  return { url: url.replace(/\/$/, ""), key };
}

function caminhoValido(path) {
  // cap/<captId>/<id>.<ext> — captId e nome do arquivo já validados em quem gera o caminho.
  return typeof path === "string" && /^cap\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/.test(path);
}

/** Decodifica um data:URL (o formato que o app já usa para fotos) em {mime, bytes}. */
export function dataUrlParaBytes(u) {
  const m = /^data:(image\/(jpeg|jpg|png|webp));base64,([\s\S]+)$/i.exec(String(u || ""));
  if (!m) return null;
  return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[3], "base64") };
}

const EXT_DE = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Sobe uma foto (data:URL) para o bucket. Retorna o caminho salvo, pronto para gravar na captação. */
export async function subirFoto(captId, dataUrl) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(captId || ""))) throw new HttpError(400, "Código da captação inválido.");
  const d = dataUrlParaBytes(dataUrl);
  if (!d) throw new HttpError(400, "Formato de imagem inválido.");
  if (d.bytes.length > MAX_BYTES) throw new HttpError(413, "Foto grande demais.");
  const ext = EXT_DE[d.mime];
  if (!ext) throw new HttpError(400, "Tipo de imagem não suportado.");
  const path = `cap/${captId}/${randomBytes(10).toString("hex")}.${ext}`;

  const { url, key } = base();
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": d.mime, "x-upsert": "false" },
    body: d.bytes,
  });
  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    throw new HttpError(502, `Falha ao enviar a foto (HTTP ${r.status}). ${corpo.slice(0, 150)}`);
  }
  return path;
}

/** Baixa os bytes de uma foto do bucket (uso interno: rota de leitura e envio ao Latitude). */
export async function baixarFoto(path) {
  if (!caminhoValido(path)) throw new HttpError(400, "Caminho de foto inválido.");
  const { url, key } = base();
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (!r.ok) return null;
  const mime = r.headers.get("content-type") || "image/jpeg";
  return { mime, bytes: Buffer.from(await r.arrayBuffer()) };
}

/** O captId dono de uma foto, a partir do caminho — usado para checar permissão antes de servir/apagar. */
export function captIdDoCaminho(path) {
  const m = caminhoValido(path) && /^cap\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}

export async function apagarFoto(path) {
  if (!caminhoValido(path)) return;
  const { url, key } = base();
  await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  }).catch(() => {});
}
