import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { req, cookieDe } from "./helpers.js";
import * as login from "@/app/api/login/route.js";
import * as me from "@/app/api/me/route.js";
import * as users from "@/app/api/users/route.js";
import * as invite from "@/app/api/invite/route.js";
import * as storage from "@/app/api/storage/route.js";

const post = (mod, path, opts) => mod.POST(req(path, { method: "POST", ...opts }));
const kv = (cookie, body) => post(storage, "/api/storage", { cookie, body });
const put = (cookie, lista) => users.PUT(req("/api/users", { method: "PUT", cookie, body: { users: lista } }));
const listaUsuarios = async (cookie) => (await (await users.GET(req("/api/users", { cookie }))).json()).users;

async function entrar(email, senha) {
  const r = await post(login, "/api/login", { body: { email, senha } });
  return { r, cookie: cookieDe(r) };
}

const cap = (extra = {}) => JSON.stringify({ id: "x", nome: "Imóvel", ...extra });
const tokens = {};
let admin;

describe("login", () => {
  it("rejeita senha errada e entra com a correta (cookie HttpOnly)", async () => {
    const ruim = await post(login, "/api/login", { body: { email: "admin@teste.com", senha: "errada-errada" } });
    expect(ruim.status).toBe(401);
    const { r, cookie } = await entrar("ADMIN@teste.com", "SenhaDoAdmin123");
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/^bf_session=/);
    admin = cookie;
    const j = await (await me.GET(req("/api/me", { cookie }))).json();
    expect(j.user.perfil).toBe("diretoria");
    expect(JSON.stringify(j)).not.toMatch(/senha_hash|scrypt|s1\$/);
  });

  it("bloqueia requisição de outra origem (CSRF) e sessão adulterada", async () => {
    const r = await post(login, "/api/login", { body: { email: "admin@teste.com", senha: "SenhaDoAdmin123" }, origin: "https://evil.example" });
    expect(r.status).toBe(403);
    const semOrigem = await post(storage, "/api/storage", { cookie: admin, body: { op: "list", prefix: "cap:" }, origin: null });
    expect(semOrigem.status).toBe(403);
    const forjado = admin.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await kv(forjado, { op: "list", prefix: "cap:" })).status).toBe(401);
    expect((await kv(undefined, { op: "list", prefix: "cap:" })).status).toBe(401);
  });

  it("limita tentativas de login por e-mail (429)", async () => {
    let ultimo;
    for (let i = 0; i < 10; i++) ultimo = await post(login, "/api/login", { body: { email: "alvo@teste.com", senha: "qualquer-coisa" } });
    expect(ultimo.status).toBe(429);
  });
});

describe("usuários e convites", () => {
  const novo = (id, nome, perfil, extra = {}) => ({ id, nome, email: `${id}@teste.com`, perfil, status: "ativo", ...extra });
  const conv = (t) => ({ tokenConvite: tokens[t], tokenConviteAt: new Date().toISOString() });

  it("só a diretoria altera usuários; novos nascem como convite pendente", async () => {
    const lista = await listaUsuarios(admin);
    for (const t of ["g1", "c1", "c2", "b1"]) tokens[t] = randomBytes(24).toString("hex");
    const nova = [
      ...lista,
      novo("u_g1", "Gerente Um", "gerente", conv("g1")),
      novo("u_c1", "Corretor Um", "corretor", { gerente: "u_g1", ...conv("c1") }),
      novo("u_c2", "Corretor Dois", "corretor", conv("c2")),
      novo("u_b1", "Backoffice Um", "backoffice", conv("b1")),
    ];
    const r = await put(admin, nova);
    expect(r.status).toBe(200);
    const salvos = (await r.json()).users;
    expect(salvos.find((u) => u.id === "u_c1").status).toBe("convite_pendente");
    expect(salvos.every((u) => u.senha === null)).toBe(true);
    // convite pendente não consegue entrar
    expect((await entrar("u_c1@teste.com", "qualquer-senha-123")).r.status).toBe(401);
  });

  it("convite: informa o destinatário, exige senha ≥10 e só vale uma vez", async () => {
    const info = await invite.GET(req(`/api/invite?token=${tokens.c1}`));
    expect((await info.json()).email).toBe("u_c1@teste.com");
    expect((await invite.GET(req(`/api/invite?token=${"a".repeat(48)}`))).status).toBe(404);
    expect((await post(invite, "/api/invite", { body: { token: tokens.c1, senha: "curta" } })).status).toBe(400);
    for (const t of ["g1", "c1", "c2", "b1"]) {
      const r = await post(invite, "/api/invite", { body: { token: tokens[t], senha: `Senha-${t}-12345` } });
      expect(r.status).toBe(200);
      expect(cookieDe(r)).toMatch(/^bf_session=/);
    }
    expect((await post(invite, "/api/invite", { body: { token: tokens.c1, senha: "OutraSenha12345" } })).status).toBe(400);
  });

  it("não-diretoria não altera usuários e enxerga só ativos sem dados sensíveis", async () => {
    const c1 = (await entrar("u_c1@teste.com", "Senha-c1-12345")).cookie;
    expect((await put(c1, [])).status).toBe(403);
    const lista = await listaUsuarios(c1);
    expect(lista.length).toBeGreaterThan(1);
    expect(JSON.stringify(lista)).not.toMatch(/tokenConvite|@teste\.com/);
  });

  it("não permite deixar o sistema sem diretoria ativa", async () => {
    const lista = await listaUsuarios(admin);
    const r = await put(admin, lista.map((u) => (u.perfil === "diretoria" ? { ...u, status: "inativo" } : u)));
    expect(r.status).toBe(400);
  });

  it("usuário inativado perde o acesso imediatamente", async () => {
    const c2 = (await entrar("u_c2@teste.com", "Senha-c2-12345")).cookie;
    expect((await kv(c2, { op: "list", prefix: "cap:" })).status).toBe(200);
    const lista = await listaUsuarios(admin);
    expect((await put(admin, lista.map((u) => (u.id === "u_c2" ? { ...u, status: "inativo" } : u)))).status).toBe(200);
    expect((await kv(c2, { op: "list", prefix: "cap:" })).status).toBe(401);
    expect((await entrar("u_c2@teste.com", "Senha-c2-12345")).r.status).toBe(401);
    // reativa para os próximos testes
    const l2 = await listaUsuarios(admin);
    await put(admin, l2.map((u) => (u.id === "u_c2" ? { ...u, status: "ativo" } : u)));
  });
});

describe("armazenamento (permissões por perfil)", () => {
  let c1, c2, g1, b1;
  beforeAll(async () => {
    c1 = (await entrar("u_c1@teste.com", "Senha-c1-12345")).cookie;
    c2 = (await entrar("u_c2@teste.com", "Senha-c2-12345")).cookie;
    g1 = (await entrar("u_g1@teste.com", "Senha-g1-12345")).cookie;
    b1 = (await entrar("u_b1@teste.com", "Senha-b1-12345")).cookie;
  });

  it("corretor grava e lê o próprio; o outro corretor não vê nem altera", async () => {
    expect((await kv(c1, { op: "set", key: "cap:a1", value: cap({ id: "a1" }) })).status).toBe(200);
    expect((await (await kv(c1, { op: "get", key: "cap:a1" })).json()).value).toContain("a1");
    expect((await kv(c2, { op: "get", key: "cap:a1" })).status).toBe(403);
    expect((await kv(c2, { op: "set", key: "cap:a1", value: cap({ nome: "sequestrado" }) })).status).toBe(403);
    expect((await (await kv(c2, { op: "list", prefix: "cap:" })).json()).keys).toEqual([]);
    expect((await (await kv(c1, { op: "list", prefix: "cap:" })).json()).keys).toEqual(["cap:a1"]);
  });

  it("gerente vê a equipe (c1) mas não o corretor de fora (c2); backoffice e diretoria veem tudo", async () => {
    await kv(c2, { op: "set", key: "cap:a2", value: cap({ id: "a2" }) });
    expect((await (await kv(g1, { op: "list", prefix: "cap:" })).json()).keys).toEqual(["cap:a1"]);
    expect((await kv(g1, { op: "get", key: "cap:a2" })).status).toBe(403);
    for (const c of [b1, admin]) expect((await (await kv(c, { op: "list", prefix: "cap:" })).json()).keys.sort()).toEqual(["cap:a1", "cap:a2"]);
  });

  it("campos de servidor não podem ser forjados; validação só por backoffice/diretoria", async () => {
    const forjado = cap({ id: "a1", ownerId: "u_admin", latStatus: "concluido", latitudeImovelId: "999", validStatus: "aprovado" });
    await kv(c1, { op: "set", key: "cap:a1", value: forjado });
    const salvo = JSON.parse((await (await kv(c1, { op: "get", key: "cap:a1" })).json()).value);
    expect(salvo.ownerId).toBe("u_c1");
    expect(salvo.latStatus).toBeUndefined();
    expect(salvo.latitudeImovelId).toBeUndefined();
    expect(salvo.validStatus).toBeUndefined();
    // backoffice pode validar, mas não forjar o envio ao Latitude
    await kv(b1, { op: "set", key: "cap:a1", value: cap({ id: "a1", validStatus: "aprovado", latStatus: "concluido" }) });
    const v = JSON.parse((await (await kv(b1, { op: "get", key: "cap:a1" })).json()).value);
    expect(v.validStatus).toBe("aprovado");
    expect(v.latStatus).toBeUndefined();
    expect(v.ownerId).toBe("u_c1"); // o dono não muda quando outro perfil edita
  });

  it("valida chave, tipo e tamanho; só a diretoria exclui", async () => {
    expect((await kv(c1, { op: "set", key: "users:x", value: "{}" })).status).toBe(400);
    expect((await kv(c1, { op: "set", key: "cap:../x", value: "{}" })).status).toBe(400);
    expect((await kv(c1, { op: "set", key: "cap:z", value: "não é json" })).status).toBe(400);
    expect((await kv(c1, { op: "set", key: "cap:z", value: "[1]" })).status).toBe(400);
    expect((await kv(c1, { op: "set", key: "cap:z", value: JSON.stringify({ f: "x".repeat(4_500_000) }) })).status).toBe(413);
    expect((await kv(c1, { op: "delete", key: "cap:a1" })).status).toBe(403);
    expect((await kv(admin, { op: "delete", key: "cap:a1" })).status).toBe(200);
    expect((await (await kv(admin, { op: "get", key: "cap:a1" })).json()).value).toBeNull();
  });
});
