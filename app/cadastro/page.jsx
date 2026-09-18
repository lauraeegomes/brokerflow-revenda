import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, usuarioDoToken } from "@/lib/auth.js";
import CadastroForm from "./CadastroForm";

export const dynamic = "force-dynamic";

export default async function CadastroPage() {
  const jar = await cookies();
  if (await usuarioDoToken(jar.get(COOKIE)?.value)) redirect("/");
  return <CadastroForm />;
}
