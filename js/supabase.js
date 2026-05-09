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

// ── Busca as URLs das imagens do banco ────────────────────────
// Retorna um Map de { number → cloudinary_url } para todos os
// 118 elementos. Chamado por initTable() antes de renderizar,
// garantindo que as imagens estejam disponíveis no momento
// em que cada célula é montada no DOM.
//
// Em caso de erro (banco fora do ar, CORS etc.), retorna um
// Map vazio — o fallback :not(:has(.cell-bg-image)) do CSS
// assume o controle e exibe os textos normalmente.
async function fetchElementImages() {
  const { data, error } = await window._supabase
    .from("elements")
    .select("number, cloudinary_url");

  if (error) {
    console.warn("[supabase.js] Não foi possível buscar imagens:", error.message);
    return new Map();
  }

  // Constrói o Map para lookup O(1) dentro do renderTable()
  return new Map(data.map(el => [el.number, el.cloudinary_url]));
}
