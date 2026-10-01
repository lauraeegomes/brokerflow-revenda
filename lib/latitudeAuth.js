/**
 * Login direto com as credenciais do Latitude (mesmo e-mail/senha que a pessoa já usa no CRM).
 * Evita duplicar senha: o BrokerFlow nunca guarda nem valida essa senha, só repassa ao Latitude.
 *
 * IMPORTANTE: `mcp.latitude.app.br/auth/login` é da plataforma Latitude inteira (várias imobiliárias).
 * Credenciais corretas de OUTRA empresa também autenticam ali — por isso, depois do login, conferimos
 * que `empresaId` é uma das empresas My Broker permitidas antes de aceitar.
 */

const BASE = "https://mcp.latitude.app.br/api";

const EMPRESAS_PERMITIDAS = (
  process.env.LATITUDE_EMPRESAS_PERMITIDAS ||
  // My Broker Uberlândia, My Broker Santa Mônica — ver lib/latitudeAdapter.ts / memória do projeto.
  "45bdffcb-bb59-43a1-9edf-258c3aa5177e,617cac75-2853-4ad9-84bd-27c32cfa317f"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function perfilDeRoles(roles) {
  const r = (roles || []).map((x) => String(x).toLowerCase());
  if (r.some((x) => x.includes("diretor"))) return "diretoria";
  if (r.some((x) => x.includes("gerente"))) return "gerente";
  if (r.some((x) => x.includes("backoffice") || x.includes("secretaria"))) return "backoffice";
  return "corretor";
}

/**
 * Tenta logar no Latitude com e-mail/senha. Retorna os dados da pessoa quando é uma conta
 * My Broker válida, ou `null` quando a senha está errada, a conta é de outra empresa, ou o
 * Latitude não respondeu (nesses casos o chamador decide a mensagem).
 */
export async function loginComLatitude(email, senha) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const d = j?.data;
  if (!d?.id || !d?.empresaId) return null;
  if (!EMPRESAS_PERMITIDAS.includes(String(d.empresaId).toLowerCase())) return null;
  return {
    latitudeId: d.id,
    empresaId: d.empresaId,
    email: String(d.email || email).trim().toLowerCase(),
    nome: d.nomeCompleto || "",
    whatsapp: d.celular || "",
    perfilSugerido: perfilDeRoles(d.roles),
  };
}
