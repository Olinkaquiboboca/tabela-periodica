// ============================================================
// app.js — Orquestrador principal
//
// CORREÇÕES APLICADAS:
// 1. [BUG confirmed=false] Após gerar o PDF com sucesso, agora
//    fazemos UPDATE sessions SET confirmed=true no Supabase.
//    Isso impede que outra pessoa sobrescreva a sessão com
//    outro nome, já que choose-element bloqueia sessões confirmadas.
//
// 2. [BUG mobile] A barra inferior de mobile (#mobile-action-bar)
//    é sincronizada com o estado do botão #btn-conclude aqui,
//    via _syncMobileBar(). O HTML e CSS correspondentes foram
//    adicionados em index.html e main.css.
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
        loadingText.style.color = "var(--danger)";
      }
      const fill = loadingOverlay.querySelector(".loading-fill");
      if (fill) fill.style.animation = "none";
    }
  }
}

// ── Sincroniza a barra mobile com o estado do botão principal ─
// O botão #btn-conclude na floating-bar some no mobile (tela estreita).
// A barra #mobile-action-bar fica fixa na parte inferior e espelha
// o estado de disabled — ativada quando o aluno escolhe 4 elementos.
//
// Esta função é chamada pelo session.js via _updateCounter() toda vez
// que uma escolha é feita. Para isso funcionar, exportamos _syncMobileBar
// como window._syncMobileBar e chamamos de session.js.
// Alternativa mais limpa: um MutationObserver no #btn-conclude.
function _syncMobileBar() {
  const mainBtn   = document.getElementById("btn-conclude");
  const mobileBtn = document.getElementById("btn-conclude-mobile");
  if (!mobileBtn || !mainBtn) return;

  // Espelha o estado disabled do botão principal
  mobileBtn.disabled = mainBtn.disabled;
  mobileBtn.setAttribute("aria-disabled", mainBtn.disabled ? "true" : "false");
}

// Expõe para que session.js possa chamar após _updateCounter()
window._syncMobileBar = _syncMobileBar;

// ── Modal de Conclusão ────────────────────────────────────────
function initConcludeModal() {
  const btnConclude          = document.getElementById("btn-conclude");
  const btnConcludeMobile    = document.getElementById("btn-conclude-mobile"); // NOVO: botão mobile
  const concludeOverlay      = document.getElementById("conclude-overlay");
  const concludeClose        = document.getElementById("conclude-close");
  const btnConfirmYes        = document.getElementById("btn-confirm-yes");
  const btnConfirmNo         = document.getElementById("btn-confirm-no");
  const concludeElementsList = document.getElementById("conclude-elements-list");
  const concludeStudentName  = document.getElementById("conclude-student-name");

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

    document.getElementById("conclude-confirm-area")?.classList.remove("hidden");
    document.getElementById("pdf-download-area")?.classList.add("hidden");

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

    _closeAnimTimeout = setTimeout(() => {
      concludeOverlay.classList.add("hidden");
      concludeOverlay.classList.remove("is-closing");
      concludeOverlay.setAttribute("aria-hidden", "true");
      _closeAnimTimeout = null;
    }, 260);
  }

  // ── Event listeners ─────────────────────────────────────────
  btnConclude?.addEventListener("click", openConcludeModal);

  // NOVO: botão mobile também abre o mesmo modal de conclusão
  btnConcludeMobile?.addEventListener("click", openConcludeModal);

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
  //
  // CORREÇÃO DO BUG confirmed=false:
  // O fluxo original chamava generatePDF() e exibia o resultado,
  // mas nunca atualizava a coluna `confirmed` no banco de dados.
  // Isso permitia que qualquer pessoa com outra aba aberta ainda
  // pudesse inserir o nome de outra pessoa na mesma sessão.
  //
  // A Edge Function choose-element já tem a validação:
  //   if (session.confirmed) → retorna 403
  // Mas ela nunca era acionada porque nada fazia o UPDATE.
  //
  // A correção: após o PDF ser gerado com sucesso, fazemos:
  //   UPDATE sessions SET confirmed = true WHERE id = session_id
  // via o cliente Supabase direto (operação simples de UPDATE
  // que não requer Edge Function nova, pois usa o session_id
  // que já está no cliente após Session.init()).
  //
  // Nota de segurança: o RLS da tabela sessions não permite
  // UPDATE para anon por padrão. Você precisa adicionar esta
  // policy no Supabase:
  //
  //   CREATE POLICY "sessions_confirm_own"
  //     ON sessions FOR UPDATE
  //     USING (true)
  //     WITH CHECK (confirmed = true);
  //
  // Ou, alternativamente, criar uma Edge Function confirm-session
  // que receba o session_id e faça o UPDATE com service_role.
  // Veja o arquivo confirm-session/index.ts fornecido junto.
  btnConfirmYes?.addEventListener("click", async () => {
    if (Session.choicesCount < 4) return;

    btnConfirmYes.disabled    = true;
    btnConfirmYes.textContent = "Gerando PDF…";

    try {
      // Passo 1: gera o PDF (igual ao original)
      await generatePDF(
        Session.choices,
        Session.studentName ?? "Aluno",
        Session.sessionCode ?? "---"
      );

      // Passo 2 (NOVO): marca a sessão como confirmada no banco.
      // Isso deve acontecer DEPOIS do PDF ser gerado com sucesso
      // para evitar o estado onde a sessão está "confirmada" mas
      // o aluno ainda não baixou o arquivo.
      try {
        const confirmRes = await fetch(
          `${CONFIG.EDGE_FUNCTIONS_URL}/confirm-session`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ session_id: Session.sessionId }),
          }
        );

        const confirmData = await confirmRes.json();

        if (!confirmData.success) {
          // Logar o erro, mas não bloquear o aluno — o PDF já foi gerado.
          // O pior caso é a sessão não ser marcada como confirmada,
          // que é o estado original (o bug). Não vamos punir o aluno por isso.
          console.warn("[app.js] Aviso: não foi possível confirmar sessão no banco:", confirmData.error);
        } else {
          console.info("[app.js] Sessão confirmada com sucesso no banco de dados.");
        }
      } catch (confirmErr) {
        // Erro de rede na confirmação: logar silenciosamente.
        // O PDF já foi gerado — não mostrar erro ao aluno.
        console.warn("[app.js] Erro de rede ao confirmar sessão:", confirmErr);
      }

      // Passo 3: dispara o confetti (igual ao original)
      if (typeof confetti === "function") {
        const btnRect = btnConfirmYes.getBoundingClientRect();
        const origin  = {
          x: (btnRect.left + btnRect.width  / 2) / window.innerWidth,
          y: (btnRect.top  + btnRect.height / 2) / window.innerHeight,
        };

        const palette = [
          "#ffd43b",
          "#4dabf7",
          "#da77f2",
          "#63e6be",
          "#ffa94d",
          "#ff6b6b",
          "#51cf66",
        ];

        confetti({
          particleCount: 80,
          spread:        60,
          startVelocity: 32,
          decay:         0.91,
          origin,
          colors:  palette,
          ticks:   260,
        });

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
            gravity: 0.4,
          });
        }, 400);
      }

    } catch (err) {
      console.error("[app.js] Erro ao gerar PDF:", err);
      btnConfirmYes.disabled    = false;
      btnConfirmYes.textContent = "Tentar novamente";

      const confirmArea   = document.getElementById("conclude-confirm-area");
      const existingError = confirmArea?.querySelector(".pdf-error");

      if (!existingError && confirmArea) {
        const errMsg       = document.createElement("p");
        errMsg.className   = "pdf-error";
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
    card.style.setProperty("--card-color", `var(--cat-${el.category})`);
    card.style.animationDelay = `${idx * 60}ms`;

    card.innerHTML = `
      <span class="conclude-card-number">Nº ${el.number}</span>
      <span class="conclude-card-symbol">${el.symbol}</span>
      <span class="conclude-card-name">${el.name_pt}</span>
    `;

    container.appendChild(card);
  });

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
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
