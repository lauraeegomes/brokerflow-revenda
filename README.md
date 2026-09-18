# BrokerFlow Revenda — MyBroker

Captação de imóveis de revenda + **precificação por pesquisa na web** + envio ao **Latitude** como rascunho de imóvel.

- Interface: protótipo `BrokerFlowRevenda.jsx` (gerado a partir de `scripts/BrokerFlowRevenda.original.jsx` por `python scripts/patch_prototype.py`).
- Servidor: Next.js 15 (App Router). Login, permissões por perfil e armazenamento ficam **no servidor**.
- Banco: Postgres (Supabase em produção; PGlite em `.data/` no desenvolvimento).

## Como funciona

| Função | Quem faz |
|---|---|
| Descrição comercial e análise de fotos | IA do Latitude (Insight) via `/api/anthropic` |
| **Precificação** (função principal) | Gemini + Google Search (referências da web, nunca dados do Latitude) via `/api/precificar`. Os cenários são recalculados no servidor: Agressivo = média × 0,85, Recomendado = × 0,90, Otimista = × 0,95. Comparáveis sem link, preço ou área são descartados. |
| Envio ao Latitude | `/api/latitude/enviar` cria o **rascunho** (nunca publica). Exige checklist completo, é idempotente e reaproveita o proprietário já cadastrado. |
| Acesso | Login por e-mail/senha; perfis corretor, gerente, backoffice, diretoria. Convites de 7 dias criados pela diretoria. |

Permissões: corretor vê só as próprias captações; gerente vê as da equipe; backoffice e diretoria veem tudo. Só backoffice/diretoria aprovam a validação; só a diretoria exclui. Campos de envio ao Latitude só o servidor grava.

## Variáveis de ambiente (ver `.env.example`)

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Postgres (Supabase: connection string do *transaction pooler*) |
| `SESSION_SECRET` | Assinatura da sessão, mínimo 32 caracteres |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥10), `ADMIN_NAME` | Primeiro administrador — criado só se a tabela de usuários estiver vazia |
| `LATITUDE_EMAIL`, `LATITUDE_SENHA`, `LATITUDE_EMPRESA_ID` | Conta de serviço usada para o Insight e para criar rascunhos |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Pesquisa de preços (modelo padrão `gemini-2.5-flash`) |

## Desenvolvimento

```bash
npm install
npm run dev        # http://localhost:3000, banco local em .data/pglite
npm test           # vitest: precificação + login/convites/permissões
npm run typecheck
```

## Deploy (Vercel)

1. Criar o projeto Supabase e copiar a `DATABASE_URL` (as tabelas são criadas sozinhas no primeiro acesso, com RLS ligado e sem policies).
2. Cadastrar as variáveis acima no projeto Vercel.
3. `npx vercel deploy --prod` e conferir se o alias `.vercel.app` apontou para o deploy novo.
4. Abrir `/login` com `ADMIN_EMAIL`/`ADMIN_PASSWORD` e criar os usuários em **Diretoria → Usuários** (gera o link de convite).

## Limitações conhecidas

- O **nome da rua** e a **descrição comercial** não vão para o rascunho do Latitude (exigem `logradouroId` do catálogo / campo ainda não identificado) — aparecem como pendências no envio.
- A **publicação** (`save-imovel`) nunca foi testada; o sistema só cria rascunhos, o backoffice publica no Latitude.
- A IA do Insight não acessa a web; por isso a precificação usa o Gemini.
- Fotos ficam dentro do registro (limite ~4 MB por captação).
- Não há tela de troca de senha: para redefinir, a diretoria gera um novo convite.
- As conversas do Insight se acumulam na conta de serviço do Latitude.
