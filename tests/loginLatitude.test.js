import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { req, cookieDe } from "./helpers.js";
import { loginComLatitude } from "@/lib/latitudeAuth.js";
import * as loginLatitude from "@/app/api/login-latitude/route.js";
import * as login from "@/app/api/login/route.js";
import * as users from "@/app/api/users/route.js";
import * as storage from "@/app/api/storage/route.js";

const post = (mod, path, opts) => mod.POST(req(path, { method: "POST", ...opts }));
const entrar = (email, senha) => post(login, "/api/login", { body: { email, senha } });
const entrarLatitude = (email, senha, ip = "10.1.0.1") => post(loginLatitude, "/api/login-latitude", { body: { email, senha }, ip });
const kvLista = (cookie) => post(storage, "/api/storage", { cookie, body: { op: "list", prefix: "cap:" } });
const listaUsuarios = async (cookie) => (await (await users.GET(req("/api/users", { cookie }))).json()).users;
const put = (cookie, lista) => users.PUT(req("/api/users", { method: "PUT", cookie, body: { users: lista } }));

const UBERLANDIA = "45bdffcb-bb59-43a1-9edf-258c3aa5177e";
const OUTRA_EMPRESA = "11111111-1111-1111-1111-111111111111";

function respostaLatitude({ ok = true, empresaId = UBERLANDIA, roles = ["Corretor"], nomeCompleto = "Pedro Corretor", celular = "5534999990000", email = "pedro@teste.com" } = {}) {
  if (!ok) return new Response("", { status: 401 });
  return new Response(JSON.stringify({ success: true, data: { id: "lat-123", empresaId, email, nomeCompleto, celular, roles, jwt: { token: "x" } } }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

let admin;
beforeAll(async () => {
  admin = cookieDe(await entrar("admin@teste.com", "SenhaDoAdmin123"));
});

describe("loginComLatitude (lib)", () => {
  it("aceita só empresas My Broker e mapeia o cargo para o perfil do BrokerFlow", async () => {
    vi.stubGlobal("fetch", async (url, init) => {
      expect(String(url)).toBe("https://mcp.latitude.app.br/api/auth/login");
      expect(JSON.parse(init.body)).toEqual({ email: "x@x.com", senha: "s" });
      return respostaLatitude({ roles: ["Diretor"] });
    });
    const r = await loginComLatitude("x@x.com", "s");
    expect(r).toMatchObject({ empresaId: UBERLANDIA, perfilSugerido: "diretoria", nome: "Pedro Corretor" });
  });

  it("mapeia os cargos reais do Latitude para os 4 perfis do BrokerFlow", async () => {
    const perfilDe = async (roles) => {
      vi.stubGlobal("fetch", async () => respostaLatitude({ roles }));
      return (await loginComLatitude("x@x.com", "s")).perfilSugerido;
    };
    expect(await perfilDe(["Diretor"])).toBe("diretoria");
    expect(await perfilDe(["Gerente"])).toBe("gerente");
    expect(await perfilDe(["SecVendas"])).toBe("backoffice"); // Secretaria de Vendas
    expect(await perfilDe(["Corretor"])).toBe("corretor");
    // cargos que misturam gente de verdade com marketing/RH/suporte do Latitude: por segurança,
    // caem no menor privilégio até a diretoria promover manualmente quem precisar (decisão 2026-10-01).
    expect(await perfilDe(["Master"])).toBe("corretor");
    expect(await perfilDe(["AdmMatriz"])).toBe("corretor");
    // cargos raros/desconhecidos também caem no padrão seguro, nunca em algo privilegiado
    expect(await perfilDe(["GI"])).toBe("corretor");
    expect(await perfilDe(["Coordenador"])).toBe("corretor");
    expect(await perfilDe([])).toBe("corretor");
    expect(await perfilDe(undefined)).toBe("corretor");
    // mais de um cargo: vale o mais privilegiado
    expect(await perfilDe(["Corretor", "Diretor"])).toBe("diretoria");
    expect(await perfilDe(["Master", "Gerente"])).toBe("gerente");
  });

  it("recusa quando a empresa não é My Broker ou a senha está errada", async () => {
    vi.stubGlobal("fetch", async () => respostaLatitude({ empresaId: OUTRA_EMPRESA }));
    expect(await loginComLatitude("x@x.com", "s")).toBeNull();
    vi.stubGlobal("fetch", async () => respostaLatitude({ ok: false }));
    expect(await loginComLatitude("x@x.com", "errada")).toBeNull();
  });
});

describe("POST /api/login-latitude", () => {
  it("cria a conta na primeira vez, com o perfil sugerido pelo cargo, e entra direto", async () => {
    vi.stubGlobal("fetch", async () => respostaLatitude({ roles: ["Gerente"], email: "pedro@teste.com", nomeCompleto: "Pedro Corretor" }));
    const r = await entrarLatitude("pedro@teste.com", "senha-do-latitude");
    expect(r.status).toBe(200);
    const cookie = cookieDe(r);
    expect((await r.json()).user).toMatchObject({ perfil: "gerente", nome: "Pedro Corretor", status: "ativo" });
    expect((await kvLista(cookie)).status).toBe(200);
    const salvo = (await listaUsuarios(admin)).find((u) => u.nome === "Pedro Corretor");
    expect(salvo).toMatchObject({ perfil: "gerente", status: "ativo" });
  });

  it("na segunda vez reaproveita a mesma conta, sem duplicar", async () => {
    vi.stubGlobal("fetch", async () => respostaLatitude({ roles: ["Gerente"], email: "pedro@teste.com" }));
    await entrarLatitude("pedro@teste.com", "senha-do-latitude");
    expect((await listaUsuarios(admin)).filter((u) => u.nome === "Pedro Corretor")).toHaveLength(1);
  });

  it("credenciais erradas ou conta de outra imobiliária não entram", async () => {
    vi.stubGlobal("fetch", async () => respostaLatitude({ ok: false }));
    expect((await entrarLatitude("alguem@teste.com", "errada")).status).toBe(401);
    vi.stubGlobal("fetch", async () => respostaLatitude({ empresaId: OUTRA_EMPRESA, email: "outra@imobiliaria.com" }));
    expect((await entrarLatitude("outra@imobiliaria.com", "senha-valida-de-la")).status).toBe(401);
  });

  it("conta bloqueada ou inativa pela diretoria continua barrada mesmo com a senha certa do Latitude", async () => {
    vi.stubGlobal("fetch", async () => respostaLatitude({ email: "bloqueado@teste.com", nomeCompleto: "Bloqueado" }));
    await entrarLatitude("bloqueado@teste.com", "s"); // cria a conta
    const lista = await listaUsuarios(admin);
    await put(admin, lista.map((u) => (u.nome === "Bloqueado" ? { ...u, status: "bloqueado" } : u)));
    const r = await entrarLatitude("bloqueado@teste.com", "s");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/bloqueado/);
  });

  it("ativa sozinho um convite da diretoria que ainda não tinha senha definida", async () => {
    const lista = await listaUsuarios(admin);
    await put(admin, [...lista, { id: "u_convidado1", nome: "Convidado Pendente", email: "convidado@teste.com", perfil: "backoffice", status: "convite_pendente" }]);
    vi.stubGlobal("fetch", async () => respostaLatitude({ email: "convidado@teste.com", nomeCompleto: "Nome do Latitude", roles: ["Corretor"] }));
    const r = await entrarLatitude("convidado@teste.com", "senha-do-latitude");
    expect(r.status).toBe(200);
    const salvo = (await listaUsuarios(admin)).find((u) => u.id === "u_convidado1");
    expect(salvo.status).toBe("ativo");
    expect(salvo.perfil).toBe("backoffice"); // o perfil definido pela diretoria não é sobrescrito pelo cargo do Latitude
  });

  it("falha de rede com o Latitude vira 502, e a origem continua sendo checada", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("timeout");
    });
    expect((await entrarLatitude("x@x.com", "s")).status).toBe(502);
    const fora = await post(loginLatitude, "/api/login-latitude", { body: { email: "x@x.com", senha: "s" }, origin: "https://evil.example" });
    expect(fora.status).toBe(403);
  });

  it("limita tentativas por e-mail (429)", async () => {
    vi.stubGlobal("fetch", async () => respostaLatitude({ ok: false }));
    let ultimo;
    for (let i = 0; i < 10; i++) ultimo = await entrarLatitude("alvo-latitude@teste.com", "errada");
    expect(ultimo.status).toBe(429);
  });
});
