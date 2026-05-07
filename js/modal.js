// ============================================================
// modal.js — Lógica do modal de elemento
//
// Gerencia abertura, fechamento, verificação de nome e
// escolha de elemento. Comunica com Session para operações
// que requerem validação server-side.
//
// ANIMAÇÕES: todas as transições são CSS-driven — este arquivo
// apenas adiciona/remove classes e escuta animationend.
// Os @keyframes vivem em main.css para ficarem centralizados.
// ============================================================

const CATEGORY_COLORS = {
  "alcali":             "var(--cat-alcali)",
  "alcalino-terroso":   "var(--cat-alcalino-terroso)",
  "lantanideo":         "var(--cat-lantanideo)",
  "actinideo":          "var(--cat-actinideo)",
  "metal-transicao":    "var(--cat-metal-transicao)",
  "metal-pos-transicao":"var(--cat-metal-pos-transicao)",
  "semimetal":          "var(--cat-semimetal)",
  "nao-metal":          "var(--cat-nao-metal)",
  "halogenio":          "var(--cat-halogenio)",
  "gas-nobre":          "var(--cat-gas-nobre)",
};

const CATEGORY_LABELS = {
  "alcali":             "Metal Álcali",
  "alcalino-terroso":   "Alcalino Terroso",
  "lantanideo":         "Lantanídeo",
  "actinideo":          "Actinídeo",
  "metal-transicao":    "Metal de Transição",
  "metal-pos-transicao":"Metal Pós-Transição",
  "semimetal":          "Semimetal",
  "nao-metal":          "Não-Metal",
  "halogenio":          "Halogênio",
  "gas-nobre":          "Gás Nobre",
};

const Modal = (() => {
  let _currentElementNumber = null;
  let _isProcessing = false;
  let _closeAnimTimeout = null; // guarda o timeout do close animado

  // ── Referências DOM ───────────────────────────────────────
  const overlay     = () => document.getElementById("element-overlay");
  const modal       = () => document.getElementById("element-modal");
  const nameInput   = () => document.getElementById("input-student-name");
  const feedback    = () => document.getElementById("name-feedback");
  const btnAdvance  = () => document.getElementById("btn-advance");
  const btnVerify   = () => document.getElementById("btn-verify-name");
  const btnClose    = () => document.getElementById("modal-close");
  const takenMsg    = () => document.getElementById("modal-taken-msg");
  const mineMsg     = () => document.getElementById("modal-mine-msg");
  const formSection = () => document.getElementById("modal-form-section");
  const modalActions= () => document.querySelector(".modal-actions");

  // ── Abertura do modal ─────────────────────────────────────
  async function open(elementNumber, options = {}) {
    // Cancela qualquer close animado que ainda esteja pendente.
    // Isso evita um bug raro: abrir rapidamente após fechar
    // poderia re-aplicar .hidden no meio da abertura.
    if (_closeAnimTimeout) {
      clearTimeout(_closeAnimTimeout);
      _closeAnimTimeout = null;
    }

    _currentElementNumber = elementNumber;
    _isProcessing = false;

    const el = ELEMENT_BY_NUMBER.get(elementNumber);
    if (!el) return;

    const { isMine = false } = options;
    const isTaken = takenElements.has(elementNumber) && !isMine;

    const color = CATEGORY_COLORS[el.category] ?? "var(--accent)";
    modal().style.setProperty("--modal-cat-color", color);

    document.getElementById("modal-element-number").textContent   = el.number;
    document.getElementById("modal-element-symbol").textContent   = el.symbol;
    document.getElementById("modal-element-name").textContent     = el.name_pt;
    document.getElementById("modal-element-category").textContent = CATEGORY_LABELS[el.category] ?? el.category;
    document.getElementById("placeholder-symbol-text").textContent = el.symbol;

    const countDisplay = document.getElementById("btn-count-display");
    if (countDisplay) countDisplay.textContent = `(${Session.choicesCount}/4)`;

    _setModalState(isMine, isTaken);
    _loadElementImage(elementNumber);

    if (Session.isNameVerified) {
      nameInput().value    = Session.studentName;
      nameInput().disabled = true;
      if (!isMine && !isTaken) _enableChooseButton();
    }

    // ── Animação de entrada ───────────────────────────────
    // 1. Remove .hidden para colocar os elementos no DOM
    //    (display passa de none para flex/block).
    // 2. No próximo frame de renderização, adiciona .is-open
    //    que dispara os @keyframes definidos no CSS.
    //
    // O requestAnimationFrame duplo existe porque o browser
    // precisa de ao menos um frame para calcular o layout
    // após remover display:none — sem ele, a animação começa
    // do estado final e não é percebida.
    overlay().classList.remove("hidden");
    overlay().setAttribute("aria-hidden", "false");
    overlay().classList.remove("is-closing"); // garante estado limpo

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay().classList.add("is-open");
      });
    });

    requestAnimationFrame(() => {
      if (Session.isNameVerified && !isMine && !isTaken) {
        btnAdvance()?.focus();
      } else if (!Session.isNameVerified && !isMine) {
        nameInput()?.focus();
      }
    });
  }

  // ── Estado visual do modal ────────────────────────────────
  function _setModalState(isMine, isTaken) {
    const form    = formSection();
    const actions = modalActions();
    const taken   = takenMsg();
    const mine    = mineMsg();
    const btn     = btnAdvance();

    taken?.classList.add("hidden");
    mine?.classList.add("hidden");
    btn && (btn.disabled = true);
    _setFeedback("", "");

    if (isMine) {
      form?.classList.add("hidden");
      actions?.classList.add("hidden");
      mine?.classList.remove("hidden");
    } else if (isTaken) {
      form?.classList.add("hidden");
      actions?.classList.add("hidden");
      taken?.classList.remove("hidden");
    } else {
      form?.classList.remove("hidden");
      actions?.classList.remove("hidden");
    }
  }

  // ── Carregamento de imagem ────────────────────────────────
  async function _loadElementImage(elementNumber) {
    const img         = document.getElementById("modal-element-image");
    const placeholder = document.getElementById("modal-image-placeholder");

    if (!img || !placeholder) return;

    img.style.display = "none";
    placeholder.style.display = "flex";

    try {
      const { data } = await window._supabase
        .from("elements")
        .select("cloudinary_url")
        .eq("number", elementNumber)
        .single();

      if (_currentElementNumber !== elementNumber) return;

      if (data?.cloudinary_url) {
        img.onload = () => {
          if (_currentElementNumber !== elementNumber) return;
          placeholder.style.display = "none";
          img.style.display = "block";
        };
        img.onerror = () => {
          placeholder.style.display = "flex";
        };
        img.src = data.cloudinary_url;
        img.alt = `Foto do elemento ${elementNumber}`;
      }
    } catch (err) {
      console.warn("[Modal._loadElementImage]", err);
    }
  }

  // ── Habilitação do botão de escolha ──────────────────────
  function _enableChooseButton() {
    const btn = btnAdvance();
    if (!btn) return;
    btn.disabled = Session.choicesCount >= 4;
    btn.setAttribute("aria-disabled", btn.disabled ? "true" : "false");
  }

  // ── Feedback de verificação de nome ──────────────────────
  function _setFeedback(message, type) {
    const fb = feedback();
    if (!fb) return;

    // ── Micro-slide no feedback ────────────────────────────
    // Para que a animação fadeSlideUp dispare toda vez que
    // uma nova mensagem aparece (não só na primeira),
    // precisamos forçar um reflow antes de re-aplicar a
    // classe de animação. Sem o reflow, o browser vê que
    // a classe já está lá e não reinicia o @keyframe.
    //
    // A técnica clássica é:
    //   1. Remover a classe de animação
    //   2. Ler qualquer propriedade que force layout (offsetHeight)
    //   3. Re-adicionar a classe
    //
    // O acesso a offsetHeight é um efeito colateral intencional —
    // não um bug — e é amplamente documentado como a forma correta
    // de reiniciar animações CSS.
    fb.classList.remove("feedback-animated");
    void fb.offsetHeight; // força reflow — necessário para reiniciar @keyframe
    fb.classList.add("feedback-animated");

    fb.textContent = message;
    fb.className = `feedback-msg feedback-animated ${type}`.trim();
  }

  // ── Fechamento do modal ───────────────────────────────────
  function close() {
    _currentElementNumber = null;

    // ── Animação de saída ──────────────────────────────────
    // Adicionamos .is-closing para disparar o @keyframe de saída
    // (modalLeave) que está no modal.css. Só aplicamos .hidden
    // — que força display:none — DEPOIS que a animação terminar.
    //
    // Usamos setTimeout com a duração da animação (--dur-normal
    // = 260ms) como fallback confiável em vez de animationend,
    // porque animationend pode não disparar se o elemento for
    // re-aberto antes do close terminar (o timeout acima cancela).
    //
    // Duração alinhada com a variável CSS --dur-normal: 260ms.
    overlay().classList.remove("is-open");
    overlay().classList.add("is-closing");

    _closeAnimTimeout = setTimeout(() => {
      overlay().classList.add("hidden");
      overlay().classList.remove("is-closing");
      overlay().setAttribute("aria-hidden", "true");
      _closeAnimTimeout = null;
    }, 260);

    if (!Session.isNameVerified) {
      if (nameInput()) nameInput().value = "";
      _setFeedback("", "");
    }

    const vBtn = btnVerify();
    if (vBtn && !Session.isNameVerified) {
      vBtn.textContent = "Verificar";
      vBtn.classList.remove("verified");
      vBtn.disabled = false;
    }
  }

  // ── Verificação de nome ───────────────────────────────────
  async function handleVerifyClick() {
    const name = nameInput()?.value.trim();
    if (!name || name.length < 2) {
      _setFeedback("Digite seu nome completo.", "invalid");
      return;
    }

    const vBtn = btnVerify();
    if (vBtn) {
      vBtn.disabled = true;
      vBtn.textContent = "Verificando…";
    }

    _setFeedback("Verificando…", "");

    const result = await Session.verifyName(name);

    if (result.valid) {
      _setFeedback(`✓ Olá, ${Session.studentName}!`, "valid");
      _enableChooseButton();
    } else {
      _setFeedback("Nome não encontrado na lista da turma.", "invalid");
      if (vBtn) {
        vBtn.disabled = false;
        vBtn.textContent = "Tentar novamente";
      }
    }
  }

  // ── Escolha do elemento ───────────────────────────────────
  async function handleAdvanceClick() {
    if (_isProcessing) return;
    if (!_currentElementNumber) return;
    if (!Session.isNameVerified) {
      _setFeedback("Verifique seu nome antes de escolher.", "invalid");
      return;
    }

    _isProcessing = true;
    const btn = btnAdvance();
    if (btn) {
      btn.disabled = true;
      btn.querySelector(".btn-advance-inner").innerHTML =
        `<span class="btn-advance-icon">⏳</span> Registrando…`;
    }

    const result = await Session.chooseElement(_currentElementNumber);

    if (result.success) {
      markElementTaken(_currentElementNumber, true);
      // Delay pequeno para o aluno ver o pip acender antes do modal fechar
      setTimeout(() => close(), 420);
    } else {
      if (btn) {
        btn.disabled = false;
        btn.querySelector(".btn-advance-inner").innerHTML = `
          <span class="btn-advance-icon">⊕</span>
          Escolher este elemento
          <span class="btn-advance-count">(${Session.choicesCount}/4)</span>
        `;
      }

      if (result.code === "ELEMENT_TAKEN") {
        _setFeedback("⊗ Outro aluno acabou de escolher este elemento!", "invalid");
        markElementTaken(_currentElementNumber, false);
        setTimeout(() => {
          _setModalState(false, true);
        }, 1500);
      } else if (result.error === "Limite de 4 elementos atingido") {
        _setFeedback("Você já atingiu o limite de 4 elementos.", "invalid");
        close();
      } else {
        _setFeedback(`Erro: ${result.error ?? "tente novamente"}`, "invalid");
      }
    }

    _isProcessing = false;
  }

  // ── Event listeners ───────────────────────────────────────
  function _bindEvents() {
    btnClose()?.addEventListener("click", close);

    overlay()?.addEventListener("click", (e) => {
      if (e.target === overlay()) close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay().classList.contains("hidden")) {
        close();
      }
    });

    btnVerify()?.addEventListener("click", handleVerifyClick);

    nameInput()?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleVerifyClick();
      }
    });

    btnAdvance()?.addEventListener("click", handleAdvanceClick);
  }

  // ── API pública ───────────────────────────────────────────
  return {
    init: _bindEvents,
    open,
    close,
  };
})();
