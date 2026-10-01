import { describe, it, expect, beforeAll } from "vitest";
import { req, cookieDe } from "./helpers.js";
import * as login from "@/app/api/login/route.js";
import * as cadastro from "@/app/api/cadastro/route.js";
import * as users from "@/app/api/users/route.js";
import * as storage from "@/app/api/storage/route.js";

const post = (mod, path, opts) => mod.POST(req(path, { method: "POST", ...opts }));
const entrar = (email, senha) => post(login, "/api/login", { body: { email, senha } });
const kvLista = (cookie) => post(storage, "/api/storage", { cookie, body: { op: "list", prefix: "cap:" } });
const listaUsuarios = async (cookie) => (await (await users.GET(req("/api/users", { cookie }))).json()).users;
const dados = (extra = {}) => ({ nome: "Maria Corretora", email: "maria@teste.com", whatsapp: "(34) 99999-0000", senha: "SenhaDaMaria123", ...extra });

let admin;
beforeAll(async () => {
  admin = cookieDe(await entrar("admin@teste.com", "SenhaDoAdmin123"));
});

describe("auto-cadastro", () => {
  it("cria a conta já ativa e entra na hora, sem aprovação da diretoria", async () => {
    const r = await post(cadastro, "/api/cadastro", { body: dados(), ip: "10.0.0.1" });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    const cookie = cookieDe(r);
    expect((await r.json()).user).toMatchObject({ perfil: "corretor", status: "ativo" });
    expect((await kvLista(cookie)).status).toBe(200); // já usa o sistema, sem passo extra

    const m = (await listaUsuarios(admin)).find((u) => u.email === "maria@teste.com");
    expect(m).toMatchObject({ status: "ativo", perfil: "corretor" });
    expect(m.creci).toBe(""); // campo removido do formulário de auto-cadastro
    expect(m.senha).toBeNull();

    // e a senha escolhida já vale no login normal
    expect((await entrar("maria@teste.com", "SenhaDaMaria123")).status).toBe(200);
  });

  it("ignora tentativa de escolher perfil/status no cadastro", async () => {
    const r = await post(cadastro, "/api/cadastro", { body: { ...dados({ email: "esperto@teste.com" }), perfil: "diretoria", status: "ativo" }, ip: "10.0.0.2" });
    expect(r.status).toBe(200);
    const u = (await listaUsuarios(admin)).find((x) => x.email === "esperto@teste.com");
    expect(u.perfil).toBe("corretor");
  });

  it("e-mail já cadastrado recebe 409 e não duplica nem derruba a conta existente", async () => {
    const r = await post(cadastro, "/api/cadastro", { body: dados({ senha: "OutraSenhaQualquer1" }), ip: "10.0.0.3" });
    expect(r.status).toBe(409);
    expect(r.headers.get("set-cookie")).toBeNull();
    expect((await listaUsuarios(admin)).filter((u) => u.email === "maria@teste.com")).toHaveLength(1);
    expect((await entrar("maria@teste.com", "OutraSenhaQualquer1")).status).toBe(401);
    // tentar "roubar" a conta do admin também falha e não afeta a senha original
    const r2 = await post(cadastro, "/api/cadastro", { body: dados({ email: "admin@teste.com", senha: "TentandoTomarConta1" }), ip: "10.0.0.4" });
    expect(r2.status).toBe(409);
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
});
