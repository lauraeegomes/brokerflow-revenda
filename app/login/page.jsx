import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, usuarioDoToken } from "@/lib/auth.js";
import { query } from "@/lib/db.js";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const jar = await cookies();
  if (await usuarioDoToken(jar.get(COOKIE)?.value)) redirect("/");
  let semUsuarios = false;
  try {
    const { rows } = await query("SELECT count(*)::int AS n FROM users");
    semUsuarios = rows[0].n === 0;
  } catch {
    /* banco indisponível: o login mostra o erro ao tentar entrar */
  }
  return <LoginForm semUsuarios={semUsuarios} />;
}
