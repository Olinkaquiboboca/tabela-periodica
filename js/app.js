// ============================================================
// app.js — Orquestrador principal
//
// Inicializa todos os módulos na ordem correta e gerencia
// a lógica do modal de conclusão.
// ============================================================

// ── Inicialização principal ───────────────────────────────────
async function initApp() {
  const loadingOverlay = document.getElementById("loading-overlay");

  try {
    // 1. Inicia a sessão (cria ou recupera via Edge Function)
    await Session.init();

    // 2. Renderiza a tabela e carrega estado inicial do banco
    await initTable();

    // 3. Inicializa o modal de elemento
    Modal.init();

    // 4. Inicializa o listener de Realtime
    initRealtime();

    // 5. Inicializa o modal de conclusão
    initConcludeModal();

    // 6. Remove o loading overlay
    if (loadingOverlay) {
      loadingOverlay.classList.add("hidden");
    }

    console.info("[app.js] Sistema inicializado com sucesso.");

  } catch (err) {
    console.error("[app.js] Falha na inicialização:", err);

    // Mostra erro amigável no loading overlay
    if (loadingOverlay) {
      const loadingText = loadingOverlay.querySelector(".loading-text");
      if (loadingText) {
        loadingText.textContent = "Erro ao conectar. Verifique sua conexão e recarregue a página.";
        loadingText.style.color = "#ff6b6b";
      }
      // Remove a barra de progresso animada
      const fill = loadingOverlay.querySelector(".loading-fill");
      if (fill) fill.style.animation = "none";
    }
  }
}

// ── Modal de Conclusão ────────────────────────────────────────
function initConcludeModal() {
  const btnConclude       = document.getElementById("btn-conclude");
  const concludeOverlay   = document.getElementById("conclude-overlay");
  const concludeClose     = document.getElementById("conclude-close");
  const btnConfirmYes     = document.getElementById("btn-confirm-yes");
  const btnConfirmNo      = document.getElementById("btn-confirm-no");
  const concludeElementsList = document.getElementById("conclude-elements-list");
  const concludeStudentName  = document.getElementById("conclude-student-name");

  // Abre o modal de conclusão
  btnConclude?.addEventListener("click", () => {
    if (Session.choicesCount < 4) return;

    // Preenche a lista dos 4 elementos
    _populateConcludeList(concludeElementsList);

    // Exibe o nome do aluno
    if (concludeStudentName) {
      concludeStudentName.textContent = Session.studentName
        ? `Aluno: ${Session.studentName}`
        : "";
    }

    // Garante que a área de confirmação está visível (não PDF)
    document.getElementById("conclude-confirm-area")?.classList.remove("hidden");
    document.getElementById("pdf-download-area")?.classList.add("hidden");

    concludeOverlay.classList.remove("hidden");
    concludeOverlay.setAttribute("aria-hidden", "false");
  });

  // Fecha o modal de conclusão (botão X)
  concludeClose?.addEventListener("click", () => {
    concludeOverlay.classList.add("hidden");
  });

  // Fecha ao clicar no overlay
  concludeOverlay?.addEventListener("click", (e) => {
    if (e.target === concludeOverlay) {
      concludeOverlay.classList.add("hidden");
    }
  });

  // Fecha ao pressionar Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !concludeOverlay?.classList.contains("hidden")) {
      concludeOverlay.classList.add("hidden");
    }
  });

  // Botão "Não, quero escolher outros" — simplesmente fecha
  btnConfirmNo?.addEventListener("click", () => {
    concludeOverlay.classList.add("hidden");
  });

  // Botão "Sim, confirmar" — gera PDF
  btnConfirmYes?.addEventListener("click", async () => {
    if (Session.choicesCount < 4) return;

    btnConfirmYes.disabled    = true;
    btnConfirmYes.textContent = "Gerando PDF…";

    try {
      await generatePDF(
        Session.choices,
        Session.studentName ?? "Aluno",
        Session.sessionCode ?? "---"
      );

      // Dispara confete de celebração final
      if (typeof confetti === "function") {
        confetti({
          particleCount: 250,
          spread: 100,
          origin: { y: 0.5 },
          colors: ["#4dabf7", "#da77f2", "#51cf66", "#ffa94d", "#ff6b6b", "#ffe066"],
        });
      }

    } catch (err) {
      console.error("[app.js] Erro ao gerar PDF:", err);
      btnConfirmYes.disabled    = false;
      btnConfirmYes.textContent = "Tentar novamente";

      // Mostra erro inline
      const confirmArea = document.getElementById("conclude-confirm-area");
      const existingError = confirmArea?.querySelector(".pdf-error");
      if (!existingError && confirmArea) {
        const errMsg = document.createElement("p");
        errMsg.className = "pdf-error";
        errMsg.style.cssText = "color: var(--danger); font-size: 13px; margin-top: 12px; text-align: center;";
        errMsg.textContent = "Erro ao gerar PDF. Verifique sua conexão e tente novamente.";
        confirmArea.appendChild(errMsg);
      }
    }
  });
}

// ── Popula a lista de elementos no modal de conclusão ─────────
function _populateConcludeList(container) {
  if (!container) return;
  container.innerHTML = "";

  const choices = Session.choices;

  choices.forEach(num => {
    const el = ELEMENT_BY_NUMBER.get(num);
    if (!el) return;

    const card = document.createElement("div");
    card.className = "conclude-element-card";

    // Aplica a cor da categoria via CSS variable
    const color = `var(--cat-${el.category})`;
    card.style.setProperty("--card-color", color);

    card.innerHTML = `
      <span class="conclude-card-number">Nº ${el.number}</span>
      <span class="conclude-card-symbol">${el.symbol}</span>
      <span class="conclude-card-name">${el.name_pt}</span>
    `;

    container.appendChild(card);
  });

  // Se menos de 4 (não deveria acontecer, mas garante robustez)
  const remaining = 4 - choices.length;
  for (let i = 0; i < remaining; i++) {
    const empty = document.createElement("div");
    empty.className = "conclude-element-card";
    empty.style.opacity = "0.3";
    empty.innerHTML = `
      <span class="conclude-card-number">—</span>
      <span class="conclude-card-symbol" style="font-size:20px;color:var(--text-dim)">?</span>
      <span class="conclude-card-name">Não escolhido</span>
    `;
    container.appendChild(empty);
  }
}

// ── Arranque ──────────────────────────────────────────────────
// Aguarda o DOM estar pronto antes de inicializar
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
