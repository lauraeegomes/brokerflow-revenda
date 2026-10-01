import crypto from "node:crypto";
import { query } from "./db.js";
import { verificarSenha, verificacaoFalsa } from "./crypto.js";

export const COOKIE = "bf_session";
const TTL = 12 * 3600; // 12 horas

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function segredo() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV !== "production") return "dev-only-secret-dev-only-secret-0000";
  throw new Error("SESSION_SECRET ausente ou curto (mínimo 32 caracteres).");
}

const assinar = (payload) => crypto.createHmac("sha256", segredo()).update(payload).digest("base64url");

/** O token carrega um "carimbo" da senha: trocar a senha derruba as sessões antigas. */
const carimbo = (senhaHash) => crypto.createHash("sha256").update(String(senhaHash || "")).digest("hex").slice(0, 12);

export function criarSessao(userId, senhaHash) {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, e: Math.floor(Date.now() / 1000) + TTL, h: carimbo(senhaHash) }),
  ).toString("base64url");
  return `${payload}.${assinar(payload)}`;
}

function lerSessao(token) {
  if (!token || typeof token !== "string") return null;
  const [p, s] = token.split(".");
  if (!p || !s) return null;
  const esperado = Buffer.from(assinar(p));
  const recebido = Buffer.from(s);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, "base64url").toString());
    if (!d.u || d.e < Date.now() / 1000) return null;
    return d;
  } catch {
    return null;
  }
}

export function cookieSessao(valor, maxAge = TTL) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export const cookieLimpo = () => cookieSessao("", 0);

export function usuarioPublico(row) {
  const d = row.data || {};
  return {
    id: row.id,
    nome: d.nome || "",
    email: row.email,
    perfil: d.perfil || "corretor",
    creci: d.creci || "",
    whatsapp: d.whatsapp || "",
    gerente: d.gerente || "",
    status: d.status || "ativo",
  };
}

/** Usuário logado a partir do valor do cookie (ou null). Confere no banco: status ativo e carimbo da senha. */
export async function usuarioDoToken(token) {
  const s = lerSessao(token);
  if (!s) return null;
  const { rows } = await query("SELECT id, email, data, senha_hash FROM users WHERE id = $1", [s.u]);
  const row = rows[0];
  if (!row || row.data?.status !== "ativo") return null;
  if (carimbo(row.senha_hash) !== s.h) return null;
  return usuarioPublico(row);
}

export function mesmaOrigem(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origem = request.headers.get("origin");
  if (!origem) return false;
  try {
    return new URL(origem).host === (request.headers.get("host") || new URL(request.url).host);
  } catch {
    return false;
  }
}

export async function exigirUsuario(request, perfis) {
  if (!mesmaOrigem(request)) throw new HttpError(403, "Origem inválida.");
  const user = await usuarioDoToken(request.cookies.get(COOKIE)?.value);
  if (!user) throw new HttpError(401, "Sessão expirada. Entre novamente.");
  if (perfis && !perfis.includes(user.perfil)) throw new HttpError(403, "Sem permissão para esta ação.");
  return user;
}

/** Envolve um handler de rota: converte HttpError em resposta JSON. */
export function api(fn) {
  return async (request, ctx) => {
    try {
      return await fn(request, ctx);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "Erro interno." }, { status: 500 });
    }
  };
}

/** Limite por janela: retorna true se ainda pode. */
export async function permitir(bucket, max, janelaSeg) {
  const w = Math.floor(Date.now() / 1000 / janelaSeg);
  const { rows } = await query(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [bucket, w],
  );
  if (Math.random() < 0.02) {
    query("DELETE FROM rate_limits WHERE window_start < $1", [w - 200]).catch(() => {});
  }
  return rows[0].count <= max;
}

export async function entrar(email, senha) {
  const { rows } = await query("SELECT id, email, data, senha_hash FROM users WHERE lower(email) = lower($1)", [
    String(email || "").trim(),
  ]);
  const row = rows[0];
  if (!row || !row.senha_hash) {
    await verificacaoFalsa(senha);
    return null;
  }
  const ok = await verificarSenha(senha, row.senha_hash);
  if (!ok || row.data?.status !== "ativo") return null;
  return { user: usuarioPublico(row), token: criarSessao(row.id, row.senha_hash) };
}
