import crypto from "node:crypto";

/** Hash de senha com scrypt: "s1$<salt>$<hash>" (base64). */
export function hashSenha(senha) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(senha), salt, 64, { N: 16384, r: 8, p: 1 }, (err, dk) => {
      if (err) return reject(err);
      resolve(`s1$${salt.toString("base64")}$${dk.toString("base64")}`);
    });
  });
}

export function verificarSenha(senha, armazenado) {
  return new Promise((resolve) => {
    const partes = String(armazenado || "").split("$");
    if (partes.length !== 3 || partes[0] !== "s1") return resolve(false);
    const salt = Buffer.from(partes[1], "base64");
    const esperado = Buffer.from(partes[2], "base64");
    crypto.scrypt(String(senha), salt, esperado.length, { N: 16384, r: 8, p: 1 }, (err, dk) => {
      if (err) return resolve(false);
      resolve(dk.length === esperado.length && crypto.timingSafeEqual(dk, esperado));
    });
  });
}

/** Faz o mesmo custo de uma verificação real (evita revelar se o e-mail existe pelo tempo de resposta). */
export async function verificacaoFalsa(senha) {
  await verificarSenha(senha, "s1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64"));
}

export function tokenAleatorio(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
