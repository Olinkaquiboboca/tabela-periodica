// ============================================================
// modal.js — Lógica do modal de elemento
//
// Gerencia abertura, fechamento, verificação de nome e
// escolha de elemento. Comunica com Session para operações
// que requerem validação server-side.
// ============================================================

// Mapa de cores por categoria (para aplicar no modal)
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
  let _nameVerifyTimeout = null;

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
    _currentElementNumber = elementNumber;
    _isProcessing = false;

    const el = ELEMENT_BY_NUMBER.get(elementNumber);
    if (!el) return;

    const { isMine = false } = options;
    const isTaken = takenElements.has(elementNumber) && !isMine;

    // Aplica cor da categoria ao modal
    const color = CATEGORY_COLORS[el.category] ?? "var(--accent)";
    modal().style.setProperty("--modal-cat-color", color);

    // Preenche dados do elemento
    document.getElementById("modal-element-number").textContent = el.number;
    document.getElementById("modal-element-symbol").textContent = el.symbol;
    document.getElementById("modal-element-name").textContent   = el.name_pt;
    document.getElementById("modal-element-category").textContent = CATEGORY_LABELS[el.category] ?? el.category;
    document.getElementById("placeholder-symbol-text").textContent = el.symbol;

    // Atualiza o botão de escolha
    const countDisplay = document.getElementById("btn-count-display");
    if (countDisplay) {
      countDisplay.textContent = `(${Session.choicesCount}/4)`;
    }

    // Controla visibilidade de seções baseado no estado
    _setModalState(isMine, isTaken);

    // Carrega imagem do Cloudinary (async, não bloqueia abertura)
    _loadElementImage(elementNumber);

    // Restaura o nome já verificado (se houver)
    if (Session.isNameVerified) {
      nameInput().value    = Session.studentName;
      nameInput().disabled = true;
      if (!isMine && !isTaken) {
        _enableChooseButton();
      }
    }

    // Exibe o overlay com animação
    overlay().classList.remove("hidden");
    overlay().setAttribute("aria-hidden", "false");

    // Foca no input de nome se não verificado, ou no botão se já verificado
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

    // Oculta tudo inicialmente
    taken?.classList.add("hidden");
    mine?.classList.add("hidden");
    btn && (btn.disabled = true);
    _setFeedback("", "");

    if (isMine) {
      // Elemento já meu: mostra mensagem de confirmação, oculta form/botão
      form?.classList.add("hidden");
      actions?.classList.add("hidden");
      mine?.classList.remove("hidden");
    } else if (isTaken) {
      // Elemento de outro: mostra mensagem de ocupado, oculta form/botão
      form?.classList.add("hidden");
      actions?.classList.add("hidden");
      taken?.classList.remove("hidden");
    } else {
      // Disponível: mostra form e botão normalmente
      form?.classList.remove("hidden");
      actions?.classList.remove("hidden");
    }
  }

  // ── Carregamento de imagem ────────────────────────────────
  async function _loadElementImage(elementNumber) {
    const img         = document.getElementById("modal-element-image");
    const placeholder = document.getElementById("modal-image-placeholder");

    if (!img || !placeholder) return;

    // Esconde imagem, mostra placeholder
    img.style.display = "none";
    placeholder.style.display = "flex";

    try {
      const { data } = await window._supabase
        .from("elements")
        .select("cloudinary_url")
        .eq("number", elementNumber)
        .single();

      // Verifica se o modal ainda está aberto para este elemento
      if (_currentElementNumber !== elementNumber) return;

      if (data?.cloudinary_url) {
        img.onload = () => {
          if (_currentElementNumber !== elementNumber) return;
          placeholder.style.display = "none";
          img.style.display = "block";
        };
        img.onerror = () => {
          // Mantém o placeholder se a imagem falhar
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
    fb.textContent = message;
    fb.className = `feedback-msg ${type}`;
  }

  // ── Fechamento do modal ───────────────────────────────────
  function close() {
    _currentElementNumber = null;
    overlay().classList.add("hidden");
    overlay().setAttribute("aria-hidden", "true");

    // Limpa estado do form se o nome não foi verificado
    if (!Session.isNameVerified) {
      if (nameInput()) nameInput().value = "";
      _setFeedback("", "");
    }

    // Restaura botão de verificar ao estado correto
    const vBtn = btnVerify();
    if (vBtn && !Session.isNameVerified) {
      vBtn.textContent = "Verificar";
      vBtn.classList.remove("verified");
      vBtn.disabled = false;
    }
  }

  // ── Verificação de nome (com debounce) ───────────────────
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
      // Marca o elemento na tabela (o Realtime também vai pegar,
      // mas marcamos localmente para feedback imediato)
      markElementTaken(_currentElementNumber, true);

      // Fecha o modal com um pequeno delay para deixar o usuário ver o sucesso
      setTimeout(() => close(), 400);
    } else {
      // Erro: restaura botão e mostra feedback
      if (btn) {
        btn.disabled = false;
        btn.querySelector(".btn-advance-inner").innerHTML = `
          <span class="btn-advance-icon">⊕</span>
          Escolher este elemento
          <span class="btn-advance-count">(${Session.choicesCount}/4)</span>
        `;
      }

      if (result.code === "ELEMENT_TAKEN") {
        // Outro aluno escolheu no mesmo momento (race condition)
        _setFeedback("⊗ Outro aluno acabou de escolher este elemento!", "invalid");
        // Atualiza a UI da tabela para refletir o novo estado
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
    // Fechar ao clicar no botão X
    btnClose()?.addEventListener("click", close);

    // Fechar ao clicar no overlay (fora do modal)
    overlay()?.addEventListener("click", (e) => {
      if (e.target === overlay()) close();
    });

    // Fechar com Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay().classList.contains("hidden")) {
        close();
      }
    });

    // Verificar nome ao clicar no botão
    btnVerify()?.addEventListener("click", handleVerifyClick);

    // Verificar nome ao pressionar Enter no input
    nameInput()?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleVerifyClick();
      }
    });

    // Escolher elemento
    btnAdvance()?.addEventListener("click", handleAdvanceClick);
  }

  // ── API pública ───────────────────────────────────────────
  return {
    init: _bindEvents,
    open,
    close,
  };
})();
