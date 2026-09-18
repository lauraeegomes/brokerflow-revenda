import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { req, cookieDe } from "./helpers.js";
import * as login from "@/app/api/login/route.js";
import * as cadastro from "@/app/api/cadastro/route.js";
import * as users from "@/app/api/users/route.js";
import * as invite from "@/app/api/invite/route.js";
import * as storage from "@/app/api/storage/route.js";

const post = (mod, path, opts) => mod.POST(req(path, { method: "POST", ...opts }));
const entrar = (email, senha) => post(login, "/api/login", { body: { email, senha } });
const kvLista = (cookie) => post(storage, "/api/storage", { cookie, body: { op: "list", prefix: "cap:" } });
const listaUsuarios = async (cookie) => (await (await users.GET(req("/api/users", { cookie }))).json()).users;
const put = (cookie, lista) => users.PUT(req("/api/users", { method: "PUT", cookie, body: { users: lista } }));
const dados = (extra = {}) => ({ nome: "Maria Corretora", email: "maria@teste.com", whatsapp: "(34) 99999-0000", creci: "12345", senha: "SenhaDaMaria123", ...extra });

let admin;
beforeAll(async () => {
  admin = cookieDe(await entrar("admin@teste.com", "SenhaDoAdmin123"));
});

describe("auto-cadastro", () => {
  it("cria conta aguardando aprovação; não entra até a diretoria ativar", async () => {
    const r = await post(cadastro, "/api/cadastro", { body: dados(), ip: "10.0.0.1" });
    expect(r.status).toBe(200);
    expect((await r.json()).mensagem).toMatch(/diretoria/i);

    const pendente = await entrar("maria@teste.com", "SenhaDaMaria123");
    expect(pendente.status).toBe(403);
    expect((await pendente.json()).error).toMatch(/aguardando aprovação/);
    expect(cookieDe(pendente)).toBe(""); // nenhuma sessão
    expect((await entrar("maria@teste.com", "senha-errada-123")).status).toBe(401);

    const m = (await listaUsuarios(admin)).find((u) => u.email === "maria@teste.com");
    expect(m).toMatchObject({ status: "aguardando_aprovacao", perfil: "corretor", creci: "12345" });
    expect(m.senha).toBeNull();
  });

  it("ignora tentativa de escolher perfil/status no cadastro", async () => {
    const r = await post(cadastro, "/api/cadastro", { body: { ...dados({ email: "esperto@teste.com" }), perfil: "diretoria", status: "ativo" }, ip: "10.0.0.2" });
    expect(r.status).toBe(200);
    const u = (await listaUsuarios(admin)).find((x) => x.email === "esperto@teste.com");
    expect(u).toMatchObject({ perfil: "corretor", status: "aguardando_aprovacao" });
    expect((await entrar("esperto@teste.com", "SenhaDaMaria123")).status).toBe(403);
  });

  it("e-mail já cadastrado recebe a mesma resposta e não duplica nem troca a senha", async () => {
    const r = await post(cadastro, "/api/cadastro", { body: dados({ senha: "OutraSenhaQualquer1" }), ip: "10.0.0.3" });
    expect(r.status).toBe(200);
    expect((await listaUsuarios(admin)).filter((u) => u.email === "maria@teste.com")).toHaveLength(1);
    expect((await entrar("maria@teste.com", "OutraSenhaQualquer1")).status).toBe(401);
    // e o admin existente também não é afetado
    await post(cadastro, "/api/cadastro", { body: dados({ email: "admin@teste.com", senha: "TentandoTomarConta1" }), ip: "10.0.0.4" });
    expect((await entrar("admin@teste.com", "TentandoTomarConta1")).status).toBe(401);
    expect((await entrar("admin@teste.com", "SenhaDoAdmin123")).status).toBe(200);
  });

  it("valida dados e origem", async () => {
    const ruim = (extra) => post(cadastro, "/api/cadastro", { body: dados({ email: "x@teste.com", ...extra }), ip: "10.0.0.5" });
    expect((await ruim({ senha: "curta" })).status).toBe(400);
    expect((await ruim({ nome: "A" })).status).toBe(400);
    expect((await ruim({ email: "sem-arroba" })).status).toBe(400);
    const fora = await post(cadastro, "/api/cadastro", { body: dados(), origin: "https://evil.example", ip: "10.0.0.6" });
    expect(fora.status).toBe(403);
  });

  it("limita cadastros por IP (429)", async () => {
    let ultimo;
    for (let i = 0; i < 6; i++) ultimo = await post(cadastro, "/api/cadastro", { body: dados({ email: `spam${i}@teste.com` }), ip: "10.9.9.9" });
    expect(ultimo.status).toBe(429);
  });

  it("depois que a diretoria ativa, a pessoa entra e usa o sistema", async () => {
    const lista = await listaUsuarios(admin);
    expect((await put(admin, lista.map((u) => (u.email === "maria@teste.com" ? { ...u, status: "ativo" } : u)))).status).toBe(200);
    const r = await entrar("maria@teste.com", "SenhaDaMaria123");
    expect(r.status).toBe(200);
    expect((await kvLista(cookieDe(r))).status).toBe(200);
  });
});

describe("redefinição de senha por link da diretoria", () => {
  it("o link mostra que é redefinição, troca a senha e derruba a sessão antiga", async () => {
    const antiga = cookieDe(await entrar("maria@teste.com", "SenhaDaMaria123"));
    expect((await kvLista(antiga)).status).toBe(200);

    const token = randomBytes(24).toString("hex");
    const lista = await listaUsuarios(admin);
    await put(admin, lista.map((u) => (u.email === "maria@teste.com" ? { ...u, tokenRedefinir: token, tokenRedefinirAt: new Date().toISOString() } : u)));
    const info = await (await invite.GET(req(`/api/invite?token=${token}`))).json();
    expect(info).toMatchObject({ email: "maria@teste.com", redefinir: true });

    expect((await post(invite, "/api/invite", { body: { token, senha: "NovaSenhaDaMaria456" } })).status).toBe(200);
    expect((await entrar("maria@teste.com", "SenhaDaMaria123")).status).toBe(401);
    expect((await entrar("maria@teste.com", "NovaSenhaDaMaria456")).status).toBe(200);
    expect((await kvLista(antiga)).status).toBe(401); // sessão anterior invalidada
    // o link só vale uma vez
    expect((await post(invite, "/api/invite", { body: { token, senha: "OutraSenhaMaisUma789" } })).status).toBe(400);
  });

  it("link expirado (mais de 7 dias) não funciona", async () => {
    const token = randomBytes(24).toString("hex");
    const lista = await listaUsuarios(admin);
    const velho = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    await put(admin, lista.map((u) => (u.email === "maria@teste.com" ? { ...u, tokenRedefinir: token, tokenRedefinirAt: velho } : u)));
    expect((await invite.GET(req(`/api/invite?token=${token}`))).status).toBe(404);
  });
});
