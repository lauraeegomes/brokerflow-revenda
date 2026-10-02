// Ambiente de teste: banco Postgres em memória (PGlite), sem tocar em nada externo.
process.env.PGLITE_DIR = "memory";
process.env.SESSION_SECRET = "teste-teste-teste-teste-teste-teste-123456";
process.env.ADMIN_EMAIL = "admin@teste.com";
process.env.ADMIN_PASSWORD = "SenhaDoAdmin123";
process.env.SUPABASE_URL = "https://teste.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-teste";
delete process.env.DATABASE_URL;
