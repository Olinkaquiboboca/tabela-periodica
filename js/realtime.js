// ============================================================
// realtime.js — Listener do Supabase Realtime
//
// Escuta INSERTs na tabela element_choices e atualiza a UI
// de todos os browsers conectados em tempo real.
//
// SEGURANÇA: só recebe dados que o RLS permite ler (policy
// "choices_read_public"). Nunca recebe dados de sessions
// ou students (sem policy de SELECT para anon).
// ============================================================

function initRealtime() {
  const channel = window._supabase
    .channel("element-choices-changes")
    .on(
      "postgres_changes",
      {
        event:  "INSERT",        // só nos interessa novas escolhas
        schema: "public",
        table:  "element_choices",
      },
      (payload) => {
        const { element_number, session_id } = payload.new;

        // Converte para número (o Realtime pode enviar como string)
        const num = Number(element_number);
        if (!num || num < 1 || num > 118) return;

        // Evita marcação dupla: se já está no nosso Set local, ignora.
        // Isso acontece quando é o próprio aluno que escolheu — nesse
        // caso já marcamos localmente ao receber a resposta da Edge Function.
        if (takenElements.has(num)) return;

        // Determina se é um elemento da sessão atual
        const isMine = session_id === Session.sessionId;

        // Atualiza a tabela visualmente
        markElementTaken(num, isMine);

        // Se for de outro aluno e o modal estiver aberto para este elemento,
        // atualiza o modal para mostrar "já ocupado"
        if (!isMine) {
          const overlay = document.getElementById("element-overlay");
          if (overlay && !overlay.classList.contains("hidden")) {
            // O modal está aberto — verifica se é para este elemento
            const currentCell = document.querySelector(".element-cell.chosen-other");
            if (currentCell && Number(currentCell.dataset.number) === num) {
              // O aluno está olhando para um elemento que acabou de ser ocupado
              // O modal.js cuida desse estado via markElementTaken
            }
          }
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.info("[realtime.js] Conectado ao canal de tempo real.");
      } else if (status === "CHANNEL_ERROR") {
        console.warn("[realtime.js] Erro no canal. Tentando reconectar…");
      } else if (status === "TIMED_OUT") {
        console.warn("[realtime.js] Timeout. Reconectando…");
      }
    });

  // Expõe para debug (nunca usar em lógica de negócio)
  window._realtimeChannel = channel;
}
