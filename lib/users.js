import { query } from "./db.js";
import { HttpError, usuarioPublico } from "./auth.js";
import { hashSenha, iguais } from "./crypto.js";

const PERFIS = ["corretor", "gerente", "backoffice", "diretoria"];
const STATUS = ["convite_pendente", "ativo", "inativo", "bloqueado"];
const CAMPOS = ["nome", "email", "whatsapp", "perfil", "creci", "gerente", "status", "tokenConvite", "tokenConviteAt", "criadoPor", "criadoEm"];
const CONVITE_VALIDADE_MS = 7 * 24 * 3600 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Formato que a interface espera (sem hash; token de convite só para quem gerencia). */
export function paraInterface(row, { comToken }) {
  const d = { ...(row.data || {}) };
  if (!comToken) {
    delete d.tokenConvite;
    delete d.tokenConviteAt;
  }
  return { id: row.id, ...d, email: row.email, senha: null };
}

export async function listar({ completo }) {
  const { rows } = await query("SELECT id, email, data FROM users ORDER BY created_at");
  if (completo) return rows.map((r) => paraInterface(r, { comToken: true }));
  return rows
    .filter((r) => r.data?.status === "ativo")
    .map((r) => {
      const u = usuarioPublico(r);
      return { id: u.id, nome: u.nome, perfil: u.perfil, creci: u.creci, gerente: u.gerente, status: u.status };
    });
}

function limpar(u) {
  const d = {};
  for (const c of CAMPOS) if (u[c] !== undefined) d[c] = u[c] === "" ? "" : u[c];
  d.nome = String(d.nome || "").trim().slice(0, 120);
  d.email = String(d.email || "").trim().toLowerCase();
  if (!d.nome) throw new HttpError(400, "Nome é obrigatório.");
  if (!EMAIL_RE.test(d.email)) throw new HttpError(400, `E-mail inválido: ${d.email || "(vazio)"}`);
  if (!PERFIS.includes(d.perfil)) throw new HttpError(400, `Perfil inválido: ${d.perfil}`);
  if (!STATUS.includes(d.status)) throw new HttpError(400, `Status inválido: ${d.status}`);
  if (d.tokenConvite != null && !/^[0-9a-f]{32,96}$/.test(String(d.tokenConvite))) {
    throw new HttpError(400, "Token de convite inválido.");
  }
  return d;
}

/**
 * Recebe a lista completa (como a interface envia). Faz upsert; nunca apaga usuário nem toca em senha.
 * Garante que sempre reste pelo menos um administrador ativo.
 */
export async function salvarLista(lista, ator) {
  if (!Array.isArray(lista) || lista.length > 500) throw new HttpError(400, "Lista de usuários inválida.");
  const { rows: atuais } = await query("SELECT id, email, data FROM users");
  const porId = new Map(atuais.map((r) => [r.id, r]));
  const emails = new Set();
  const resultado = new Map(atuais.map((r) => [r.id, { ...r.data, email: r.email }]));

  for (const u of lista) {
    const id = String(u.id || "");
    if (!/^u_[a-z0-9_]{1,40}$/.test(id)) throw new HttpError(400, "ID de usuário inválido.");
    const d = limpar(u);
    if (emails.has(d.email)) throw new HttpError(400, `E-mail repetido: ${d.email}`);
    emails.add(d.email);
    const existente = porId.get(id);
    const conflito = atuais.find((r) => r.email.toLowerCase() === d.email && r.id !== id);
    if (conflito) throw new HttpError(400, `E-mail já cadastrado: ${d.email}`);
    if (!existente) {
      d.status = d.status === "ativo" ? "convite_pendente" : d.status; // ninguém nasce ativo sem definir senha
      d.criadoPor = ator.id;
      d.criadoEm = d.criadoEm || new Date().toISOString();
    }
    resultado.set(id, d);
  }

  const ativosDir = [...resultado.values()].filter((d) => d.perfil === "diretoria" && d.status === "ativo");
  if (ativosDir.length === 0) throw new HttpError(400, "Deve existir ao menos um administrador (diretoria) ativo.");

  for (const u of lista) {
    const d = resultado.get(u.id);
    const { email, ...resto } = d;
    if (porId.has(u.id)) {
      await query("UPDATE users SET email = $2, data = $3::jsonb, updated_at = now() WHERE id = $1", [
        u.id,
        email,
        JSON.stringify(resto),
      ]);
    } else {
      await query("INSERT INTO users (id, email, data) VALUES ($1, $2, $3::jsonb)", [u.id, email, JSON.stringify(resto)]);
    }
  }
}

export async function infoConvite(token) {
  const u = await acharPorToken(token);
  return u ? { nome: u.data.nome, email: u.email } : null;
}

async function acharPorToken(token) {
  if (!/^[0-9a-f]{32,96}$/.test(String(token || ""))) return null;
  const { rows } = await query("SELECT id, email, data, senha_hash FROM users WHERE data->>'tokenConvite' = $1", [token]);
  const row = rows[0];
  if (!row || !iguais(row.data.tokenConvite, token)) return null;
  if (!["convite_pendente", "ativo"].includes(row.data.status)) return null;
  const quando = Date.parse(row.data.tokenConviteAt || "") || 0;
  if (Date.now() - quando > CONVITE_VALIDADE_MS) return null;
  return row;
}

export async function aceitarConvite(token, senha) {
  if (typeof senha !== "string" || senha.length < 10) throw new HttpError(400, "A senha precisa ter pelo menos 10 caracteres.");
  if (senha.length > 200) throw new HttpError(400, "Senha muito longa.");
  const row = await acharPorToken(token);
  if (!row) throw new HttpError(400, "Convite inválido ou expirado. Peça um novo link à diretoria.");
  const hash = await hashSenha(senha);
  const data = { ...row.data, status: "ativo" };
  delete data.tokenConvite;
  delete data.tokenConviteAt;
  await query("UPDATE users SET data = $2::jsonb, senha_hash = $3, updated_at = now() WHERE id = $1", [
    row.id,
    JSON.stringify(data),
    hash,
  ]);
  return { id: row.id, senhaHash: hash };
}
