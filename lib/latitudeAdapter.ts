/**
 * Adaptador BrokerFlow → Latitude (v2, validado ao vivo em 2026-09-18).
 *
 * Cria um IMÓVEL (rascunho completo) no Latitude a partir de uma captação
 * aprovada do BrokerFlow. Sem dependências: usa só `fetch`/`FormData` do Node 18+.
 *
 * Onde colocar no projeto Next.js do BrokerFlow: `src/lib/brokerflow/latitudeAdapter.ts`
 * (só servidor — nunca importar em componente client; as credenciais vêm de env vars).
 *
 * Env vars:
 *   LATITUDE_EMAIL, LATITUDE_SENHA, LATITUDE_EMPRESA_ID   (obrigatórias)
 *   LATITUDE_API_URL   (opcional, padrão https://mcp.latitude.app.br/api)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMO O LATITUDE FUNCIONA (tudo testado contra produção; detalhes na memória
 * do projeto, arquivo latitude_lead_api_quirks.md):
 *
 *  1. POST /propertydraft/initialize            → cria o rascunho (id == imovelId)
 *  2. POST /propertydraft/{id}/step/{n}         → cada etapa só grava os SEUS campos
 *       0 finalidade/tipo/operação (Venda=2)   1 endereço (address.lat/long, cep)
 *       2 características + PROPRIETÁRIOS      3 financeiro + corretor de captação
 *       5 links (título do anúncio)            (4 e 6 sem campos conhecidos)
 *     O body é o rascunho INTEIRO devolvido pela chamada anterior + as mudanças.
 *  3. POST /propertydraft/upload-image          → foto (multipart), 1 chamada por foto
 *  4. POST /propertydraft/save-imovel/{id}      → PUBLICA o imóvel  ⚠ NÃO TESTADO
 *
 * Proprietário = referência a um cadastro compartilhado de PESSOA. O Latitude
 * NÃO bloqueia duplicatas ao criar pessoa (testado: 2 POSTs idênticos geraram
 * 2 pessoas), então este adaptador PROCURA antes (GET /pessoas/dropdown?nome=…,
 * comparando o telefone que vem na descrição) e só cria se não achar.
 *
 * O QUE NÃO FUNCIONA / FICA PENDENTE (vai em `camposIncompletos`):
 *  - Nome da rua: o Latitude quer um `logradouroId` do catálogo dele; só o CEP,
 *    número, complemento e coordenadas são enviados.
 *  - Coordenadas: o BrokerFlow guarda CEP, não lat/long. `geocodificar()` tenta
 *    BrasilAPI v2 / Nominatim; se falhar o imóvel fica sem coordenadas.
 *  - Descrição comercial: ainda não achei o campo dela no rascunho; não é enviada.
 *  - Publicação (`publicar: true`) chama save-imovel, NUNCA testado (publicaria
 *    um imóvel real). Padrão é NÃO publicar: o backoffice revisa e publica no
 *    Latitude. Teste a primeira publicação real com alguém acompanhando.
 */

const BASE = process.env.LATITUDE_API_URL ?? "https://mcp.latitude.app.br/api";

// ─── IDs fixos do Latitude (confirmados ao vivo, Uberlândia) ──────────────
export const FINALIDADE = {
  RESIDENCIAL: "e092dd4c-e587-4284-83bf-d881dd741690",
  COMERCIAL: "d1a87f1d-ca04-45f4-8d12-9fb1ae8c3311",
  RURAL: "576fbd06-0479-4441-9376-bbabc56e0582",
} as const;

export const OPERACAO = { LOCACAO: 1, VENDA: 2, VENDA_E_LOCACAO: 3 } as const;

/** chave = `${cat}:${subcat ?? ""}` — espelha o buildPrompt() do BrokerFlow. */
const TIPO_IMOVEL: Record<string, { finalidade: string; id: string }> = {
  "casa:rua": { finalidade: FINALIDADE.RESIDENCIAL, id: "120b5e79-4c38-4318-918e-976b226b29d4" },
  "casa:": { finalidade: FINALIDADE.RESIDENCIAL, id: "120b5e79-4c38-4318-918e-976b226b29d4" },
  "casa:condo": { finalidade: FINALIDADE.RESIDENCIAL, id: "151a296a-983d-401c-949d-046418de2f54" },
  "terreno:": { finalidade: FINALIDADE.RESIDENCIAL, id: "9f677db8-7df4-4d5d-8660-104b8d7e4cf6" },
  "terreno:condo": { finalidade: FINALIDADE.RESIDENCIAL, id: "98026795-f26e-4551-a2c4-f0aab6e5b3f7" },
  "apartamento:": { finalidade: FINALIDADE.RESIDENCIAL, id: "c337bde6-5bfc-4c74-8b51-291782ffc69f" },
  "comercial:": { finalidade: FINALIDADE.COMERCIAL, id: "54cb3a93-25d6-47fd-868c-fb0ff1227240" }, // CASA COMERCIAL (aproximação)
  "rural:": { finalidade: FINALIDADE.RURAL, id: "59a2205e-5d35-4aa5-9bf1-136b33ffc674" }, // CHÁCARA (aproximação)
};

// ─── Tipos públicos ───────────────────────────────────────────────────────
export type FotoInput = { nome: string; bytes: Uint8Array; mime?: string };

export type LatitudeImovelInput = {
  captureId: string;
  cat: string; // "casa" | "terreno" | "apartamento" | ...
  subcat?: string | null; // "rua" | "condo"
  titulo?: string | null;
  valorVenda?: number | null;
  valorIptu?: number | null;
  valorCondominio?: number | null;
  aceitaPermuta?: boolean | null;
  area?: number | null; // privativa / total
  areaConstruida?: number | null;
  areaTerreno?: number | null;
  quartos?: number | null;
  suites?: number | null;
  banheiros?: number | null;
  vagas?: number | null;
  anoConstrucao?: number | null;
  cep?: string | null;
  numero?: string | null;
  complemento?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  proprietario: { nome: string; telefone: string; email?: string | null; cpf?: string | null };
  corretorId?: string | null; // GUID do corretor no Latitude
  fotos?: FotoInput[];
};

export type LatitudeResultado = {
  imovelId: string;
  pessoaId: string;
  pessoaCriada: boolean;
  fotosEnviadas: number;
  publicado: boolean;
  camposIncompletos: string[];
};

export class LatitudeError extends Error {
  status: number;
  path: string;
  corpo: string;
  constructor(status: number, path: string, corpo: string) {
    super(`Latitude ${status} em ${path}: ${corpo.slice(0, 300)}`);
    this.status = status;
    this.path = path;
    this.corpo = corpo;
  }
}

// ─── Utilidades ───────────────────────────────────────────────────────────
const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** "R$ 1.200,50" | "1200.5" | "1.200" | 1200 → número (ou null). */
export function paraNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").replace(/R\$|\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const int = (v: unknown) => {
  const n = paraNumero(v);
  return n == null ? null : Math.round(n);
};

// ─── HTTP + auth ──────────────────────────────────────────────────────────
let cache: { token: string; ate: number } | null = null;

async function token(): Promise<string> {
  if (cache && cache.ate > Date.now()) return cache.token;
  const email = process.env.LATITUDE_EMAIL;
  const senha = process.env.LATITUDE_SENHA;
  if (!email || !senha) throw new Error("LATITUDE_EMAIL / LATITUDE_SENHA não configurados.");
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha }),
  });
  if (!r.ok) throw new LatitudeError(r.status, "/auth/login", await r.text());
  const j = (await r.json()) as { data?: { jwt?: { token?: string } } };
  const t = j.data?.jwt?.token;
  if (!t) throw new Error("Login Latitude sem token na resposta.");
  cache = { token: t, ate: Date.now() + 6 * 24 * 3600 * 1000 }; // token vale ~7 dias
  return t;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function lat(method: string, path: string, body?: unknown, form?: FormData): Promise<Json> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token()}`,
    Accept: "application/json",
  };
  if (!form) headers["Content-Type"] = "application/json";
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const txt = await r.text();
  if (!r.ok) throw new LatitudeError(r.status, path, txt);
  return txt ? JSON.parse(txt) : null;
}

// ─── Proprietário (Pessoa) ────────────────────────────────────────────────
function foneDaDescricao(desc: string): string {
  const m = /Fone:\s*([^|)]*)/i.exec(desc);
  return digitos(m?.[1]);
}

/** Procura pessoa pelo nome + telefone. Retorna o id ou null. */
export async function acharPessoa(nome: string, telefone: string): Promise<string | null> {
  const q = nome.trim();
  if (q.length < 2) return null;
  const alvo = digitos(telefone).slice(-9);
  if (alvo.length < 8) return null;
  const lista = (await lat("GET", `/pessoas/dropdown?nome=${encodeURIComponent(q)}&Tipo=1`)) as Json[];
  for (const p of lista ?? []) {
    if (foneDaDescricao(String(p.descricao ?? "")).endsWith(alvo)) return String(p.id);
  }
  return null;
}

async function garantirPessoa(
  captureId: string,
  p: LatitudeImovelInput["proprietario"],
): Promise<{ id: string; criada: boolean }> {
  const existente = await acharPessoa(p.nome, p.telefone);
  if (existente) return { id: existente, criada: false };
  let fone = digitos(p.telefone);
  if (fone.startsWith("55") && fone.length >= 12) fone = fone.slice(2);
  const r = await lat("POST", "/pessoas/pessoa-fisica", {
    nome: p.nome.trim(),
    tipo: 1,
    email: p.email || undefined,
    cpf: p.cpf ? digitos(p.cpf) : undefined,
    observacao: `Criado via BrokerFlow Revenda (captação ${captureId})`,
    ignoreDuplicate: false,
    proprietario: true,
    telefones: [{ numero: fone, ddi: "55", principal: true }],
  });
  return { id: String(r.pessoaId), criada: true };
}

// ─── Geocodificação (melhor esforço) ──────────────────────────────────────
export async function geocodificar(cep?: string | null): Promise<{ latitude: number; longitude: number } | null> {
  const c = digitos(cep);
  if (c.length !== 8) return null;
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${c}`);
    if (r.ok) {
      const j = (await r.json()) as Json;
      const lat = Number(j?.location?.coordinates?.latitude);
      const lng = Number(j?.location?.coordinates?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { latitude: lat, longitude: lng };
    }
  } catch {
    /* ignora: geocodificação é opcional */
  }
  return null;
}

// ─── Fluxo principal ──────────────────────────────────────────────────────
export async function enviarParaLatitude(
  input: LatitudeImovelInput,
  opts: { publicar?: boolean } = {},
): Promise<LatitudeResultado> {
  const empresaId = process.env.LATITUDE_EMPRESA_ID;
  if (!empresaId) throw new Error("LATITUDE_EMPRESA_ID não configurado.");
  const pendentes: string[] = [
    "logradouro (nome da rua) — exige logradouroId do catálogo do Latitude",
    "descrição comercial — campo no rascunho ainda não identificado",
  ];

  const chave = `${input.cat}:${input.subcat ?? ""}`;
  const tipo = TIPO_IMOVEL[chave] ?? TIPO_IMOVEL[`${input.cat}:`];
  if (!tipo) {
    throw new Error(`Sem mapeamento de tipo Latitude para cat="${input.cat}" subcat="${input.subcat ?? ""}".`);
  }

  // proprietário primeiro: se falhar, nem cria rascunho
  const pessoa = await garantirPessoa(input.captureId, input.proprietario);

  let draft: Json = await lat("POST", "/propertydraft/initialize", { empresaId });
  const id = String(draft.id);
  const etapa = async (n: number, mudancas: Record<string, unknown>) => {
    draft = await lat("POST", `/propertydraft/${id}/step/${n}`, { ...draft, ...mudancas });
  };

  try {
    // 0 — dados iniciais
    await etapa(0, { finalidadeId: tipo.finalidade, tipoImovelId: tipo.id, operacaoImobiliaria: OPERACAO.VENDA });

    // 1 — endereço (só o que o Latitude aceita sem catálogo)
    let coord = input.latitude != null && input.longitude != null
      ? { latitude: input.latitude, longitude: input.longitude }
      : await geocodificar(input.cep);
    await etapa(1, {
      address: {
        ...draft.address,
        ...(coord ?? {}),
        coordenadaConfirmada: !!coord,
        numero: input.numero ?? null,
        complemento: input.complemento ?? null,
      },
      logradouro: { ...draft.logradouro, cep: digitos(input.cep) || null },
    });
    if (!coord) pendentes.push("coordenadas (lat/long) — não informadas e a geocodificação por CEP falhou");

    // 2 — características (objeto sempre completo: este passo dá 500 se vier incompleto)
    await etapa(2, {
      characteristic: {
        ...draft.characteristic,
        areaTotal: input.area ?? null,
        areaConstruida: input.areaConstruida ?? input.area ?? null,
        areaPrivada: input.area ?? null,
        quantidadeQuartos: int(input.quartos),
        quantidadeSuites: int(input.suites),
        quantidadeBanheiros: int(input.banheiros),
        vagasGaragem: int(input.vagas),
        anoConstrucao: int(input.anoConstrucao),
      },
      // proprietários são gravados nesta etapa (2), não na 3 — testado
      owners: [
        {
          pessoaId: pessoa.id,
          percentual: 100,
          nome: input.proprietario.nome,
          email: input.proprietario.email ?? "",
          telefone: digitos(input.proprietario.telefone),
          tipo: "PF",
        },
      ],
    });

    // 3 — financeiro + corretor de captação
    await etapa(3, {
      finance: {
        ...draft.finance,
        valorVenda: input.valorVenda ?? null,
        valorIptu: input.valorIptu ?? null,
        valorCondominio: input.valorCondominio ?? null,
        condominioIsento: input.valorCondominio == null ? null : input.valorCondominio === 0,
        aceitaPermuta: input.aceitaPermuta == null ? null : input.aceitaPermuta ? "S" : "N", // é um CHAR, não boolean
      },
      lead: { ...draft.lead, corretorCaptacaoId: input.corretorId ?? null },
    });
    if (!input.corretorId) pendentes.push("corretor de captação (corretorId não informado)");

    // 5 — título do anúncio
    await etapa(5, { links: { ...draft.links, tituloAmigavel: input.titulo ?? null } });

    // fotos (por último: os passos acima reenviam o rascunho inteiro)
    let enviadas = 0;
    for (const [i, f] of (input.fotos ?? []).entries()) {
      const form = new FormData();
      form.append("PropertyDraftId", id);
      form.append("File", new Blob([f.bytes as BlobPart], { type: f.mime ?? "image/jpeg" }), f.nome);
      form.append("Publicavel", "true");
      form.append("Destaque", i === 0 ? "true" : "false");
      form.append("SuperDestaque", "false");
      form.append("Descricao", f.nome);
      form.append("Ordem", String(i));
      await lat("POST", "/propertydraft/upload-image", undefined, form);
      enviadas++;
    }
    if (!input.fotos?.length) pendentes.push("fotos — nenhuma foto informada");

    let publicado = false;
    if (opts.publicar) {
      await lat("POST", `/propertydraft/save-imovel/${id}`); // ⚠ nunca testado ao vivo
      publicado = true;
    }

    return { imovelId: id, pessoaId: pessoa.id, pessoaCriada: pessoa.criada, fotosEnviadas: enviadas, publicado, camposIncompletos: pendentes };
  } catch (e) {
    // não deixa rascunho pela metade: desativa (exclusão lógica) e propaga o erro
    await descartarRascunho(id).catch(() => {});
    throw e;
  }
}

/** Exclusão lógica do rascunho (ativo=false). NÃO mexe em imóvel já publicado. */
export async function descartarRascunho(id: string): Promise<void> {
  await lat("DELETE", `/propertydraft/${id}`);
}

// ─── Conversão a partir do protótipo/BrokerFlow (campos `f.*`) ────────────
export function deBrokerFlow(a: {
  captureId: string;
  cat: string;
  subcat?: string | null;
  titulo?: string | null;
  precoFinal?: unknown;
  f: Record<string, unknown>;
  corretorId?: string | null;
  fotos?: FotoInput[];
}): LatitudeImovelInput {
  const f = a.f;
  const permuta = String(f.permuta ?? "").toLowerCase();
  return {
    captureId: a.captureId,
    cat: a.cat,
    subcat: a.subcat ?? null,
    titulo: a.titulo ?? null,
    valorVenda: paraNumero(a.precoFinal) ?? paraNumero(f.preco_pedido),
    valorIptu: paraNumero(f.iptu),
    valorCondominio: paraNumero(f.condo),
    aceitaPermuta: permuta ? /^(s|sim|true|1)/.test(permuta) : null,
    area: paraNumero(f.area),
    areaTerreno: paraNumero(f.area_terreno),
    quartos: int(f.quartos),
    suites: int(f.suites),
    banheiros: int(f.banhos),
    vagas: int(f.vagas),
    cep: (f.cep_imovel as string) ?? null,
    numero: (f.numero as string) ?? null,
    proprietario: {
      nome: String(f.prop_nome ?? ""),
      telefone: String(f.prop_fone ?? ""),
      email: (f.prop_email as string) ?? null,
      cpf: (f.prop_cpf as string) ?? null,
    },
    corretorId: a.corretorId ?? null,
    fotos: a.fotos,
  };
}

// ─── Exportações auxiliares (usadas pelas rotas do BrokerFlow) ────────────
export const tokenLatitude = token;
export const LATITUDE_BASE = BASE;

/** Acha o corretor no Latitude pelo nome (todas as palavras do nome informado precisam constar). */
export async function acharCorretor(nome: string): Promise<string | null> {
  const partes = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 1);
  if (partes.length === 0) return null;
  const lista = (await lat("GET", `/brokers?name=${encodeURIComponent(nome.trim().split(/\s+/)[0])}`)) as Json[];
  const candidatos = (lista ?? []).filter((b) => {
    if (b.excluido) return false;
    const n = String(b.nome ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return partes.every((p) => n.includes(p));
  });
  return candidatos.length === 1 ? String(candidatos[0].id) : null;
}
