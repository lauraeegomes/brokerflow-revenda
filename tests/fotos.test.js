import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { req, cookieDe } from "./helpers.js";
import { dataUrlParaBytes, captIdDoCaminho } from "@/lib/fotos.js";
import * as login from "@/app/api/login/route.js";
import * as storage from "@/app/api/storage/route.js";
import * as upload from "@/app/api/fotos/upload/route.js";
import * as ver from "@/app/api/fotos/ver/route.js";

const post = (mod, path, opts) => mod.POST(req(path, { method: "POST", ...opts }));
const entrar = (email, senha) => post(login, "/api/login", { body: { email, senha } });
const kvSet = (cookie, key, value) => post(storage, "/api/storage", { cookie, body: { op: "set", key, value } });

// JPEG 1x1 válido — suficiente pra passar pela checagem de formato.
const JPEG_1PX =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

function respostaStorage(ok = true, status = ok ? 200 : 500) {
  return new Response(ok ? corpoJpegFake() : "erro", { status });
}
function corpoJpegFake() {
  return Buffer.from(JPEG_1PX.split(",")[1], "base64");
}

afterEach(() => vi.unstubAllGlobals());

let c1;
beforeAll(async () => {
  c1 = cookieDe(await entrar("admin@teste.com", "SenhaDoAdmin123")); // dono da captação nos testes
});

describe("dataUrlParaBytes / captIdDoCaminho", () => {
  it("decodifica um data:URL válido e rejeita o resto", () => {
    const d = dataUrlParaBytes(JPEG_1PX);
    expect(d.mime).toBe("image/jpeg");
    expect(d.bytes.length).toBeGreaterThan(0);
    expect(dataUrlParaBytes("nao-e-data-url")).toBeNull();
    expect(dataUrlParaBytes("data:text/plain;base64,aGk=")).toBeNull();
  });

  it("só aceita caminhos no formato cap/<id>/<arquivo>.<ext>", () => {
    expect(captIdDoCaminho("cap/abc123/def456.jpg")).toBe("abc123");
    expect(captIdDoCaminho("cap/../../etc/passwd.jpg")).toBeNull();
    expect(captIdDoCaminho("outraCoisa/x.jpg")).toBeNull();
    expect(captIdDoCaminho("cap/abc/x.exe")).toBeNull();
  });
});

describe("POST /api/fotos/upload", () => {
  it("sobe a foto e devolve um caminho dentro da captação", async () => {
    vi.stubGlobal("fetch", async (url, init) => {
      expect(String(url)).toContain("/storage/v1/object/brokerflow-fotos/cap/cap1/");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("image/jpeg");
      return respostaStorage(true);
    });
    const r = await post(upload, "/api/fotos/upload", { cookie: c1, body: { captId: "cap1", dataUrl: JPEG_1PX } });
    expect(r.status).toBe(200);
    const { path } = await r.json();
    expect(path).toMatch(/^cap\/cap1\/[a-f0-9]+\.jpg$/);
  });

  it("exige sessão, caminho válido e formato de imagem correto", async () => {
    expect((await post(upload, "/api/fotos/upload", { body: { captId: "cap1", dataUrl: JPEG_1PX } })).status).toBe(401);
    expect((await post(upload, "/api/fotos/upload", { cookie: c1, body: { captId: "../etc", dataUrl: JPEG_1PX } })).status).toBe(400);
    expect((await post(upload, "/api/fotos/upload", { cookie: c1, body: { captId: "cap1", dataUrl: "nao-e-imagem" } })).status).toBe(400);
  });

  it("deixa criar fotos numa captação nova (ainda sem registro salvo), mas bloqueia dono errado depois de salva", async () => {
    vi.stubGlobal("fetch", async () => respostaStorage(true));
    // captação "cap-nova" nunca foi salva — qualquer usuário logado pode começar a subir fotos pra ela
    expect((await post(upload, "/api/fotos/upload", { cookie: c1, body: { captId: "cap-nova", dataUrl: JPEG_1PX } })).status).toBe(200);

    // depois que existe um dono (registro salvo), outro corretor não pode subir foto nela
    await kvSet(c1, "cap:cap2", JSON.stringify({ id: "cap2" }));
    const c2 = cookieDe(await post(await import("@/app/api/cadastro/route.js"), "/api/cadastro", {
      body: { nome: "Outro Corretor", email: "outro.fotos@teste.com", whatsapp: "", senha: "SenhaOutraPessoa1" },
    }));
    expect((await post(upload, "/api/fotos/upload", { cookie: c2, body: { captId: "cap2", dataUrl: JPEG_1PX } })).status).toBe(403);
  });
});

describe("GET /api/fotos/ver", () => {
  it("serve a foto só pra quem pode ver a captação dona dela", async () => {
    await kvSet(c1, "cap:capver", JSON.stringify({ id: "capver" }));
    vi.stubGlobal("fetch", async () => respostaStorage(true));

    const ok = await ver.GET(req("/api/fotos/ver?path=cap%2Fcapver%2Fx.jpg", { cookie: c1 }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");

    const semSessao = await ver.GET(req("/api/fotos/ver?path=cap%2Fcapver%2Fx.jpg"));
    expect(semSessao.status).toBe(401);

    const caminhoInvalido = await ver.GET(req("/api/fotos/ver?path=../../etc/passwd", { cookie: c1 }));
    expect(caminhoInvalido.status).toBe(400);

    const captacaoInexistente = await ver.GET(req("/api/fotos/ver?path=cap%2Fnaoexiste%2Fx.jpg", { cookie: c1 }));
    expect(captacaoInexistente.status).toBe(404);
  });
});
