import { query } from "./db.js";

// Esquema isolado: não altera tabelas nem fluxos da precificação.
let pending;
export async function prepararPlacas() {
  if (!pending) pending = (async () => {
    await query(`CREATE TABLE IF NOT EXISTS placas_imoveis (
      codigo text PRIMARY KEY,
      agencia text NOT NULL CHECK (agencia IN ('santa_monica','zona_sul')),
      valor numeric(15,2),
      bairro text,
      titulo text,
      imagem_url text,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS placas_vinculos (
      placa_id text PRIMARY KEY,
      codigo_imovel text NOT NULL REFERENCES placas_imoveis(codigo) ON DELETE RESTRICT,
      atualizado_por text,
      atualizado_em timestamptz NOT NULL DEFAULT now()
    )`);
    await query("ALTER TABLE placas_imoveis ENABLE ROW LEVEL SECURITY");
    await query("ALTER TABLE placas_vinculos ENABLE ROW LEVEL SECURITY");
  })().catch(e => { pending = null; throw e; });
  return pending;
}
export function validarCodigo(x) {
  const value = String(x ?? "").trim();
  return /^[0-9]{1,12}$/.test(value) ? value : null;
}
export function validarPlaca(x) {
  const value = String(x ?? "").trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}
