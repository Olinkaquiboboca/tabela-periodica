// ============================================================
// session.js — Gerenciamento de sessão do aluno
//
// REGRAS DE SEGURANÇA DESTE MÓDULO:
// 1. Nunca armazenar o ip_hash ou qualquer dado sensível.
// 2. Nunca enviar o IP no body da requisição — a Edge Function
//    lê direto do header HTTP da requisição.
// 3. O student_name canônico vem do servidor, não do input.
// 4. Todas as operações críticas são delegadas às Edge Functions.
// ============================================================

const Session = (() => {
  // ── Estado interno — privado via closure ──────────────────
  let _sessionId   = null;
  let _sessionCode = null;
  let _studentName = null;
  let _confirmed   = false;
  let _choices     = []; // array de element_numbers desta sessão

  // ── Inicialização ─────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch(`${CONFIG.EDGE_FUNCTIONS_URL}/create-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Body vazio — o IP vem do header HTTP da requisição,
        // nunca do body enviado pelo cliente.
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        throw new Error(`Erro HTTP ${res.status} ao criar sessão`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      _sessionId   = data.session_id;
      _sessionCode = data.session_code;
      _studentName = data.student_name;
      _confirmed   = data.confirmed;

      // Atualiza a UI com o código de sessão
      const codeDisplay = document.getElementById("session-code-display");
      if (codeDisplay) codeDisplay.textContent = _sessionCode;

      // Se a sessão já tinha nome (recuperação após F5), preenche o campo
      if (_studentName) {
        const nameInput = document.getElementById("input-student-name");
        if (nameInput) {
          nameInput.value = _studentName;
          nameInput.disabled = true;
        }
        const verifyBtn = document.getElementById("btn-verify-name");
        if (verifyBtn) {
          verifyBtn.textContent = "✓ Verificado";
          verifyBtn.classList.add("verified");
          verifyBtn.disabled = true;
        }
      }

      // Carrega escolhas já feitas (caso de recarregamento de página)
      await _loadExistingChoices();

      return { sessionId: _sessionId, sessionCode: _sessionCode };
    } catch (err) {
      console.error("[Session.init]", err);
      throw err;
    }
  }

  // Busca escolhas já confirmadas no banco para esta sessão
  async function _loadExistingChoices() {
    if (!_sessionId) return;

    const { data, error } = await window._supabase
      .from("element_choices")
      .select("element_number")
      .eq("session_id", _sessionId);

    if (error) {
      console.warn("[Session._loadExistingChoices]", error.message);
      return;
    }

    if (data && data.length > 0) {
      _choices = data.map(r => r.element_number);
      _updateCounter();
    }
  }

  // ── Verificação de nome ───────────────────────────────────
  async function verifyName(name) {
    if (!_sessionId) throw new Error("Sessão não inicializada");

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return { valid: false, error: "Nome muito curto" };
    }

    try {
      const res = await fetch(`${CONFIG.EDGE_FUNCTIONS_URL}/verify-student`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_name: name.trim(),
          session_id:   _sessionId,
        }),
      });

      const data = await res.json();

      if (data.valid) {
        // IMPORTANTE: usa o nome canônico retornado pelo servidor,
        // não o nome como o aluno digitou. Garante consistência.
        _studentName = data.canonical_name;

        // Atualiza o input com o nome canônico e trava o campo
        const nameInput = document.getElementById("input-student-name");
        if (nameInput) {
          nameInput.value = _studentName;
          nameInput.disabled = true;
        }
        const verifyBtn = document.getElementById("btn-verify-name");
        if (verifyBtn) {
          verifyBtn.textContent = "✓ Verificado";
          verifyBtn.classList.add("verified");
          verifyBtn.disabled = true;
        }
      }

      return data;
    } catch (err) {
      console.error("[Session.verifyName]", err);
      return { valid: false, error: "Erro de rede" };
    }
  }

  // ── Escolha de elemento ───────────────────────────────────
  async function chooseElement(elementNumber) {
    if (!_sessionId)   throw new Error("Sessão não inicializada");
    if (!_studentName) throw new Error("Nome não verificado");
    if (_choices.length >= 4) {
      return { success: false, error: "Limite de 4 elementos atingido" };
    }
    if (_choices.includes(elementNumber)) {
      return { success: false, error: "Você já escolheu este elemento" };
    }

    try {
      const res = await fetch(`${CONFIG.EDGE_FUNCTIONS_URL}/choose-element`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id:     _sessionId,
          element_number: elementNumber,
        }),
      });

      const data = await res.json();

      if (data.success) {
        _choices.push(elementNumber);
        _updateCounter();

        if (data.completed) {
          _onCompleted();
        }
      }

      return data;
    } catch (err) {
      console.error("[Session.chooseElement]", err);
      return { success: false, error: "Erro de rede" };
    }
  }

  // ── Atualização do contador na UI ─────────────────────────
  function _updateCounter() {
    const n = _choices.length;

    // Texto do contador
    const countEl = document.getElementById("count-current");
    if (countEl) countEl.textContent = n;

    // Pips visuais na barra
    for (let i = 1; i <= 4; i++) {
      const pip = document.getElementById(`pip-${i}`);
      if (!pip) continue;

      const wasFilled = pip.classList.contains("filled");
      const shouldFill = i <= n;

      pip.classList.toggle("filled", shouldFill);

      // Anima apenas quando um pip NOVO é preenchido
      if (shouldFill && !wasFilled) {
        pip.classList.add("pop");
        pip.addEventListener("animationend", () => pip.classList.remove("pop"), { once: true });
      }
    }

    // Habilita/desabilita botão Concluir
    const btnConclude = document.getElementById("btn-conclude");
    if (btnConclude) {
      btnConclude.disabled = n < 4;
      btnConclude.setAttribute("aria-disabled", n < 4 ? "true" : "false");
    }
  }

  // ── Callback ao completar as 4 escolhas ───────────────────
  function _onCompleted() {
    // Confete!
    if (typeof confetti === "function") {
      confetti({
        particleCount: 180,
        spread: 90,
        origin: { y: 0.6 },
        colors: ["#4dabf7", "#da77f2", "#51cf66", "#ffa94d", "#ff6b6b"],
      });
    }

    // Toast de conclusão
    _showToast("🎉 Você escolheu 4 elementos! Clique em Concluir na barra acima.");
  }

  function _showToast(message) {
    const toast = document.getElementById("completion-toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("visible");

    setTimeout(() => {
      toast.classList.remove("visible");
    }, 5000);
  }

  // ── API pública do módulo ─────────────────────────────────
  return {
    init,
    verifyName,
    chooseElement,

    // Getters — expõe estado como read-only
    get sessionId()   { return _sessionId; },
    get sessionCode() { return _sessionCode; },
    get studentName() { return _studentName; },
    get confirmed()   { return _confirmed; },
    get choices()     { return [..._choices]; },      // cópia defensive, nunca a referência
    get choicesCount(){ return _choices.length; },
    get isNameVerified() { return _studentName !== null; },
  };
})();
