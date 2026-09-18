import { query } from "./db.js";
import { HttpError } from "./auth.js";

/**
 * Armazenamento chave→valor (substitui o `window.storage` do protótipo) com permissões no servidor.
 *  - cap:<id>   captações            - prec:<código>  precificações compartilhadas
 *  - auth:<código>  autorizações do proprietário
 * (`auth:users` e `auth:session` do protótipo NÃO existem mais: usuários e sessões vivem em tabelas próprias.)
 */

const KEY_RE = /^(cap|prec|auth):[A-Za-z0-9_-]{1,80}$/;
const PREFIX_RE = /^(cap|prec|auth):[A-Za-z0-9_-]{0,80}$/;
const MAX_BYTES = 4_400_000; // abaixo do limite de 4,5 MB de corpo das funções da Vercel

// Campos que só o servidor define (o cliente não consegue forjar o envio ao Latitude nem o dono do registro).
const SO_SERVIDOR = ["ownerId", "latStatus", "latitudeImovelId", "latitudeSentAt", "latitudePendencias", "latLock"];
// Campos da validação de qualidade: só backoffice/diretoria alteram.
const SO_VALIDADORES = ["validStatus", "validObs"];

const VE_TUDO = ["diretoria", "backoffice"];

function chaveValida(key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) throw new HttpError(400, "Chave inválida.");
}

async function equipeDe(user) {
  if (user.perfil !== "gerente") return new Set();
  const { rows } = await query("SELECT id FROM users WHERE data->>'gerente' = $1", [user.id]);
  return new Set(rows.map((r) => r.id));
}

function visivel(user, ownerId, equipe) {
  if (VE_TUDO.includes(user.perfil)) return true;
  if (ownerId && ownerId === user.id) return true;
  return user.perfil === "gerente" && !!ownerId && equipe.has(ownerId);
}

export async function kvGet(user, key) {
  chaveValida(key);
  const { rows } = await query("SELECT key, value, owner_id FROM kv WHERE key = $1", [key]);
  const row = rows[0];
  if (!row) return null;
  if (!visivel(user, row.owner_id, await equipeDe(user))) throw new HttpError(403, "Sem permissão para este registro.");
  return row.value;
}

export async function kvList(user, prefix) {
  if (typeof prefix !== "string" || !PREFIX_RE.test(prefix)) throw new HttpError(400, "Prefixo inválido.");
  const { rows } = await query(
    "SELECT key, owner_id FROM kv WHERE left(key, $2) = $1 ORDER BY updated_at DESC LIMIT 500",
    [prefix, prefix.length],
  );
  const equipe = await equipeDe(user);
  return rows.filter((r) => visivel(user, r.owner_id, equipe)).map((r) => r.key);
}

export async function kvSet(user, key, value) {
  chaveValida(key);
  if (typeof value !== "string") throw new HttpError(400, "Valor inválido.");
  if (Buffer.byteLength(value) > MAX_BYTES) {
    throw new HttpError(413, "Registro grande demais (limite ~4,4 MB). Remova algumas fotos e tente de novo.");
  }
  let rec;
  try {
    rec = JSON.parse(value);
  } catch {
    throw new HttpError(400, "O valor precisa ser JSON.");
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) throw new HttpError(400, "O valor precisa ser um objeto JSON.");

  const { rows } = await query("SELECT value, owner_id FROM kv WHERE key = $1", [key]);
  const atual = rows[0];
  if (atual && !visivel(user, atual.owner_id, await equipeDe(user))) {
    throw new HttpError(403, "Sem permissão para alterar este registro.");
  }
  const dono = atual?.owner_id || user.id;

  if (key.startsWith("cap:")) {
    let prev = {};
    try {
      prev = atual ? JSON.parse(atual.value) : {};
    } catch {
      prev = {};
    }
    for (const k of SO_SERVIDOR) {
      if (prev[k] !== undefined) rec[k] = prev[k];
      else delete rec[k];
    }
    if (!VE_TUDO.includes(user.perfil)) {
      for (const k of SO_VALIDADORES) {
        if (prev[k] !== undefined) rec[k] = prev[k];
        else delete rec[k];
      }
    }
    rec.ownerId = dono;
  }

  await query(
    `INSERT INTO kv (key, value, owner_id, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(rec), dono, user.id],
  );
}

export async function kvDelete(user, key) {
  chaveValida(key);
  if (user.perfil !== "diretoria") throw new HttpError(403, "Somente a diretoria pode excluir registros.");
  await query("DELETE FROM kv WHERE key = $1", [key]);
}

/** Uso interno do servidor (rota do Latitude): lê/atualiza sem passar pelas proteções de campo. */
export async function kvLerInterno(key) {
  const { rows } = await query("SELECT value, owner_id, updated_at FROM kv WHERE key = $1", [key]);
  return rows[0] || null;
}

export async function kvGravarInterno(key, rec, dono, userId) {
  await query(
    `INSERT INTO kv (key, value, owner_id, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(rec), dono, userId],
  );
}

export { visivel, equipeDe };
