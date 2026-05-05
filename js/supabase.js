// ============================================================
// supabase.js — Inicialização do cliente Supabase
//
// Usa a anon key pública. O RLS no banco garante que este
// cliente só pode ler dados permitidos e nunca escrever
// diretamente nas tabelas críticas (sessions, students).
// ============================================================

(function () {
  // O SDK do Supabase é carregado via CDN antes deste arquivo.
  // Verifica se o SDK foi carregado corretamente.
  if (typeof supabase === "undefined" || typeof supabase.createClient !== "function") {
    console.error("[supabase.js] SDK do Supabase não encontrado. Verifique o CDN no HTML.");
    return;
  }

  // Cria o cliente e expõe globalmente como window._supabase
  // O underscore indica que é "interno" — outros módulos usam
  // o cliente através desta referência, nunca criando instâncias novas.
  window._supabase = supabase.createClient(
    CONFIG.SUPABASE_URL,
    CONFIG.SUPABASE_ANON_KEY,
    {
      auth: {
        // Para alunos: sem persistência de sessão de auth Supabase.
        // A sessão do aluno é gerenciada pelo módulo Session via Edge Functions.
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        // Parâmetros de reconexão para ambientes instáveis (WiFi escolar)
        heartbeatIntervalMs: 30000,
        reconnectAfterMs: (tries) => Math.min(tries * 1000, 10000),
      },
    }
  );

  // Verificação de saúde: tenta acessar a tabela elements para
  // confirmar que a configuração está correta.
  window._supabase
    .from("elements")
    .select("number", { count: "exact", head: true })
    .then(({ count, error }) => {
      if (error) {
        console.warn("[supabase.js] Aviso de conexão:", error.message);
        console.warn("Verifique SUPABASE_URL e SUPABASE_ANON_KEY em config.js");
      } else {
        console.info(`[supabase.js] Conectado. ${count} elementos no banco.`);
      }
    });
})();
