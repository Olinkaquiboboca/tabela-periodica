// ============================================================
// app.js — Orquestrador principal
//
// Inicializa todos os módulos na ordem correta e gerencia
// a lógica do modal de conclusão.
//
// ANIMAÇÕES: o modal de conclusão segue o mesmo padrão do
// modal de elemento — .is-open / .is-closing gerenciam as
// transições CSS sem precisar de biblioteca externa.
// ============================================================

// ── Inicialização principal ───────────────────────────────────
async function initApp() {
  const loadingOverlay = document.getElementById("loading-overlay");

  try {
    // 1. Sessão primeiro — tudo depende do session_id
    await Session.init();

    // 2. Tabela: renderiza o grid e carrega estado do banco em paralelo
    await initTable();

    // 3. Modal de elemento: registra os event listeners
    Modal.init();

    // 4. Realtime: começa a escutar mudanças de outros alunos
    initRealtime();

    // 5. Modal de conclusão: registra listeners e lógica de PDF
    initConcludeModal();

    // 6. Remove o loading overlay com a transição CSS já definida
    //    (.hidden no main.css usa opacity:0 + pointer-events:none,
    //    não display:none — então a transição de 0.55s funciona)
    if (loadingOverlay) {
      loadingOverlay.classList.add("hidden");
    }

    console.info("[app.js] Sistema inicializado com sucesso.");

  } catch (err) {
    console.error("[app.js] Falha na inicialização:", err);

    if (loadingOverlay) {
      const loadingText = loadingOverlay.querySelector(".loading-text");
      if (loadingText) {
        loadingText.textContent = "Erro ao conectar. Verifique sua conexão e recarregue a página.";
        loadingText.style.color = "var(--danger)"; // usa variável CSS em vez de valor hardcoded
      }
      const fill = loadingOverlay.querySelector(".loading-fill");
      if (fill) fill.style.animation = "none";
    }
  }
}

// ── Modal de Conclusão ────────────────────────────────────────
function initConcludeModal() {
  const btnConclude          = document.getElementById("btn-conclude");
  const concludeOverlay      = document.getElementById("conclude-overlay");
  const concludeClose        = document.getElementById("conclude-close");
  const btnConfirmYes        = document.getElementById("btn-confirm-yes");
  const btnConfirmNo         = document.getElementById("btn-confirm-no");
  const concludeElementsList = document.getElementById("conclude-elements-list");
  const concludeStudentName  = document.getElementById("conclude-student-name");

  // Guarda o timeout da animação de saída — igual ao padrão do modal.js.
  // Sem isso, abrir rapidamente após fechar pode re-aplicar .hidden
  // no meio da animação de abertura.
  let _closeAnimTimeout = null;

  // ── Abertura animada ────────────────────────────────────────
  function openConcludeModal() {
    if (Session.choicesCount < 4) return;

    if (_closeAnimTimeout) {
      clearTimeout(_closeAnimTimeout);
      _closeAnimTimeout = null;
    }

    _populateConcludeList(concludeElementsList);

    if (concludeStudentName) {
      concludeStudentName.textContent = Session.studentName
        ? `Aluno: ${Session.studentName}`
        : "";
    }

    // Garante que começa na tela de confirmação, não na de PDF
    document.getElementById("conclude-confirm-area")?.classList.remove("hidden");
    document.getElementById("pdf-download-area")?.classList.add("hidden");

    // Mesma técnica do modal.js:
    // remove .hidden primeiro (coloca no DOM/fluxo visual),
    // depois no próximo frame adiciona .is-open para disparar o @keyframe.
    // O rAF duplo garante que o browser calculou o layout antes de animar.
    concludeOverlay.classList.remove("hidden");
    concludeOverlay.classList.remove("is-closing");
    concludeOverlay.setAttribute("aria-hidden", "false");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        concludeOverlay.classList.add("is-open");
      });
    });
  }

  // ── Fechamento animado ──────────────────────────────────────
  function closeConcludeModal() {
    concludeOverlay.classList.remove("is-open");
    concludeOverlay.classList.add("is-closing");

    // Aplica .hidden somente após a animação de saída terminar.
    // 260ms = var(--dur-normal), alinhado com o CSS do modal.
    _closeAnimTimeout = setTimeout(() => {
      concludeOverlay.classList.add("hidden");
      concludeOverlay.classList.remove("is-closing");
      concludeOverlay.setAttribute("aria-hidden", "true");
      _closeAnimTimeout = null;
    }, 260);
  }

  // ── Event listeners ─────────────────────────────────────────
  btnConclude?.addEventListener("click", openConcludeModal);
  concludeClose?.addEventListener("click", closeConcludeModal);
  btnConfirmNo?.addEventListener("click", closeConcludeModal);

  concludeOverlay?.addEventListener("click", (e) => {
    if (e.target === concludeOverlay) closeConcludeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !concludeOverlay?.classList.contains("hidden")) {
      closeConcludeModal();
    }
  });

  // ── Confirmação final + geração de PDF ─────────────────────
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

      // ── Confetti localizado no modal de conclusão ───────────
      // Calculamos a posição do botão "Confirmar" para que o burst
      // parta de onde o aluno acabou de clicar — conecta o efeito
      // à ação que o causou, em vez de cair do céu genericamente.
      //
      // Se o botão não for encontrado (improvável mas defensivo),
      // usa o centro horizontal + terço superior como fallback.
      if (typeof confetti === "function") {
        const btnRect = btnConfirmYes.getBoundingClientRect();
        const origin  = {
          x: (btnRect.left + btnRect.width  / 2) / window.innerWidth,
          y: (btnRect.top  + btnRect.height / 2) / window.innerHeight,
        };

        // Paleta completa — celebração maior que a adoção individual,
        // então usamos mais cores (todas as categorias representadas)
        const palette = [
          "#ffd43b", // âmbar — cor de adoção
          "#4dabf7", // azul acento
          "#da77f2", // lantanídeo
          "#63e6be", // pós-transição
          "#ffa94d", // alcalino terroso
          "#ff6b6b", // álcali
          "#51cf66", // sucesso
        ];

        // Primeiro burst: concentrado e rápido — o "impacto"
        confetti({
          particleCount: 80,
          spread:        60,
          startVelocity: 32,
          decay:         0.91,
          origin,
          colors:  palette,
          ticks:   260,
        });

        // Segundo burst (180ms depois): mais lento e espalhado — o "eco"
        // Usa scalar menor para partículas menores, diferenciando visualmente
        setTimeout(() => {
          confetti({
            particleCount: 55,
            spread:        100,
            startVelocity: 16,
            decay:         0.93,
            origin,
            colors:  palette,
            ticks:   300,
            scalar:  0.85,
          });
        }, 180);

        // Terceiro burst (400ms depois): pouquíssimas partículas grandes
        // que "flutuam" para cima — dá a impressão de que o efeito
        // ainda está acontecendo, cria duração sem ser excessivo
        setTimeout(() => {
          confetti({
            particleCount: 20,
            spread:        40,
            startVelocity: 8,
            decay:         0.96,
            origin,
            colors:  palette,
            ticks:   400,
            scalar:  1.2,
            gravity: 0.4, // partículas sobem mais devagar — efeito de "flutuar"
          });
        }, 400);
      }

    } catch (err) {
      console.error("[app.js] Erro ao gerar PDF:", err);
      btnConfirmYes.disabled    = false;
      btnConfirmYes.textContent = "Tentar novamente";

      // Erro inline — aparece dentro do modal sem fechar
      const confirmArea   = document.getElementById("conclude-confirm-area");
      const existingError = confirmArea?.querySelector(".pdf-error");

      if (!existingError && confirmArea) {
        const errMsg       = document.createElement("p");
        errMsg.className   = "pdf-error";
        // Usa variáveis CSS em vez de valores hardcoded — respeita o tema
        errMsg.style.cssText = `
          color: var(--danger);
          font-size: 13px;
          margin-top: 12px;
          text-align: center;
          animation: fadeSlideUp var(--dur-normal) var(--ease-out-circ) both;
        `;
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

  choices.forEach((num, idx) => {
    const el = ELEMENT_BY_NUMBER.get(num);
    if (!el) return;

    const card = document.createElement("div");
    card.className = "conclude-element-card";

    // Cor da categoria via CSS custom property — o CSS do modal
    // usa --card-color para a linha colorida no topo do card
    // e para o símbolo em cor da categoria
    card.style.setProperty("--card-color", `var(--cat-${el.category})`);

    // Delay de entrada escalonado: cada card aparece 60ms após o anterior.
    // O @keyframe fadeSlideUp já está no modal.css.
    // Sem este delay, todos os 4 cards aparecem simultaneamente
    // e o efeito de entrada fica plano.
    card.style.animationDelay = `${idx * 60}ms`;

    card.innerHTML = `
      <span class="conclude-card-number">Nº ${el.number}</span>
      <span class="conclude-card-symbol">${el.symbol}</span>
      <span class="conclude-card-name">${el.name_pt}</span>
    `;

    container.appendChild(card);
  });

  // Slots vazios (não deveria acontecer com choicesCount >= 4,
  // mas garante que o grid de 2×2 sempre se forma corretamente)
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
// Aguarda o DOM antes de inicializar — garante que todos os
// elementos HTML já existem quando os módulos tentam referenciá-los.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp(); // DOM já estava pronto (script carregado de forma assíncrona)
}
