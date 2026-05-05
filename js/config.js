// ============================================================
// config.js — SOMENTE chaves e URLs PÚBLICAS
//
// ⚠️  NUNCA coloque aqui:
//     - SUPABASE_SERVICE_ROLE_KEY
//     - Senhas de qualquer tipo
//     - Tokens de admin
//     - Qualquer segredo
//
// A anon key é projetada para ser pública — ela só funciona
// dentro dos limites que o RLS define no banco de dados.
// ============================================================

const CONFIG = {
  // Substitua pelos valores reais do seu projeto Supabase
  SUPABASE_URL:        "https://hrvleytimzrysircbwao.supabase.co",
  SUPABASE_ANON_KEY:   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhydmxleXRpbXpyeXNpcmNid2FvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NDA3ODMsImV4cCI6MjA5MzUxNjc4M30.wYfvE5IQWyKx4P75Op8oxk8UvoaREN9DZWVcu3o99S4",  // anon key pública do Supabase

  // URL base das Edge Functions
  EDGE_FUNCTIONS_URL:  "https://hrvleytimzrysircbwao.supabase.co/functions/v1/choose-element",
  EDGE_FUNCTIONS_URL:  "https://hrvleytimzrysircbwao.supabase.co/functions/v1/create-session",
  EDGE_FUNCTIONS_URL:  "https://hrvleytimzrysircbwao.supabase.co/functions/v1/verify-student",

  // Base URL do Cloudinary (substitua pelo seu cloud name)
  CLOUDINARY_BASE:     "https://res.cloudinary.com/dijqcsy3r/image/upload",
};

// Impede modificação acidental em runtime
Object.freeze(CONFIG);
