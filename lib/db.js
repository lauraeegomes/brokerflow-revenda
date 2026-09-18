import { Pool } from "pg";

/**
 * Banco de dados.
 *  - Produção/Vercel: Postgres via DATABASE_URL (Supabase, use a "connection string" do pooler).
 *  - Desenvolvimento/testes: PGlite (Postgres real em WASM, salvo em .data/pglite) quando não há DATABASE_URL.
 * Todas as tabelas têm RLS ligado e nenhuma policy: a API pública do Supabase (anon key) não enxerga nada;
 * só este servidor (conexão direta) acessa os dados.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  senha_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS kv (
  key text PRIMARY KEY,
  value text NOT NULL,
  owner_id text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kv_owner_idx ON kv (owner_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket text NOT NULL,
  window_start bigint NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id text,
  action text NOT NULL,
  detail jsonb
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
`;

async function abrir() {
  const url = process.env.DATABASE_URL;
  let conn;
  if (url) {
    const local = /@(localhost|127\.0\.0\.1)/.test(url);
    const pool = new Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
    conn = { kind: "pg", query: (t, p) => pool.query(t, p), exec: (t) => pool.query(t) };
  } else {
    if (process.env.VERCEL || (process.env.NODE_ENV === "production" && !process.env.ALLOW_PGLITE)) {
      throw new Error("DATABASE_URL não configurada.");
    }
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = process.env.PGLITE_DIR === "memory" ? undefined : process.env.PGLITE_DIR || ".data/pglite";
    if (dir) (await import("node:fs")).mkdirSync(dir, { recursive: true });
    const db = dir ? new PGlite(dir) : new PGlite();
    await db.waitReady;
    conn = { kind: "pglite", query: (t, p) => db.query(t, p), exec: (t) => db.exec(t) };
  }
  await conn.exec(SCHEMA);
  await criarAdminInicial(conn);
  return conn;
}

/** Cria o primeiro administrador se ainda não existe nenhum usuário (ADMIN_EMAIL + ADMIN_PASSWORD). */
async function criarAdminInicial(conn) {
  const { rows } = await conn.query("SELECT count(*)::int AS n FROM users");
  if (rows[0].n > 0) return;
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const senha = process.env.ADMIN_PASSWORD || "";
  if (!email || senha.length < 10) return; // sem admin configurado: o login avisa
  const { hashSenha } = await import("./crypto.js");
  const data = {
    nome: process.env.ADMIN_NAME || "Administrador",
    email,
    perfil: "diretoria",
    status: "ativo",
    creci: "",
    whatsapp: "",
    gerente: "",
    criadoEm: new Date().toISOString(),
  };
  await conn.query("INSERT INTO users (id, email, data, senha_hash) VALUES ($1, $2, $3::jsonb, $4)", [
    "u_admin",
    email,
    JSON.stringify(data),
    await hashSenha(senha),
  ]);
}

export function db() {
  if (!globalThis.__bfDb) globalThis.__bfDb = abrir().catch((e) => { globalThis.__bfDb = null; throw e; });
  return globalThis.__bfDb;
}

export async function query(text, params) {
  const conn = await db();
  return conn.query(text, params);
}

export async function auditar(userId, action, detail) {
  try {
    await query("INSERT INTO audit_log (user_id, action, detail) VALUES ($1, $2, $3::jsonb)", [
      userId || null,
      action,
      JSON.stringify(detail ?? {}),
    ]);
  } catch (e) {
    console.error("audit:", e?.message);
  }
}
