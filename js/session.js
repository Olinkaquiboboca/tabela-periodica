// ============================================================
// session.js — Gerenciamento de sessão do aluno
//
// CORREÇÕES APLICADAS NESTA VERSÃO:
//
// 1. _updateCounter() agora sincroniza os pips da barra mobile
//    (pip-mobile-1..4) junto com os da floating-bar (pip-1..4).
//
// 2. _updateCounter() atualiza o nome do aluno na barra mobile
//    (#mobile-student-name) assim que disponível.
//
// 3. _updateCounter() chama window._syncMobileBar() ao final,
//    função definida em app.js que espelha o estado disabled
//    do botão Concluir no botão mobile.
//
// 4. verifyName() atualiza o nome na barra mobile imediatamente
//    após verificação, sem precisar esperar a primeira escolha.
//
// REGRAS DE SEGURANÇA DESTE MÓDULO (mantidas do original):
// 1. Nunca armazenar o ip_hash ou qualquer dado sensível.
// 2. O device_id é gerado no cliente e salvo no localStorage.
// 3. O student_name canônico vem do servidor, não do input.
// 4. Todas as operações críticas são delegadas às Edge Functions.
// ============================================================

const Session = (() => {
  // ── Estado interno — privado via closure ──────────────────
  let _sessionId   = null;
  let _sessionCode = null;
  let _studentName = null;
  let _confirmed   = false;
  let _choices     = [];

  // ── Identificação do dispositivo ──────────────────────────
  function _getOrCreateDeviceId() {
    const KEY = "tp_device_id";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  }

  // ── Inicialização ─────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch(`${CONFIG.EDGE_FUNCTIONS_URL}/create-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          device_id: _getOrCreateDeviceId(),
        }),
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

      const codeDisplay = document.getElementById("session-code-display");
      if (codeDisplay) codeDisplay.textContent = _sessionCode;

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

        // Preenche o nome na barra mobile logo na inicialização,
        // caso o aluno já tenha verificado o nome em uma sessão anterior
        // (o nome é restaurado do banco via create-session).
        const mobileNameEl = document.getElementById("mobile-student-name");
        if (mobileNameEl) mobileNameEl.textContent = _studentName;
      }

      await _loadExistingChoices();

      return { sessionId: _sessionId, sessionCode: _sessionCode };
    } catch (err) {
      console.error("[Session.init]", err);
      throw err;
    }
  }

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
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          student_name: name.trim(),
          session_id:   _sessionId,
        }),
      });

      const data = await res.json();

      if (data.valid) {
        _studentName = data.canonical_name;

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

        // CORREÇÃO MOBILE: atualiza o nome na barra inferior
        // imediatamente após a verificação, sem esperar a primeira escolha.
        // Sem isso, o aluno verifica o nome mas a barra mobile ainda
        // mostra "—" até ele escolher algum elemento.
        const mobileNameEl = document.getElementById("mobile-student-name");
        if (mobileNameEl) mobileNameEl.textContent = _studentName;
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
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        },
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
  //
  // CORREÇÃO MOBILE: além dos pips originais (pip-1..4) e do
  // botão da floating-bar, agora também sincroniza:
  //   - pip-mobile-1..4 (pips duplicados na barra inferior)
  //   - #mobile-student-name (nome do aluno na barra inferior)
  //   - window._syncMobileBar() (espelha o disabled no botão mobile)
  function _updateCounter() {
    const n = _choices.length;

    const countEl = document.getElementById("count-current");
    if (countEl) countEl.textContent = n;

    for (let i = 1; i <= 4; i++) {
      const pip       = document.getElementById(`pip-${i}`);
      const pipMobile = document.getElementById(`pip-mobile-${i}`);
      const shouldFill = i <= n;

      // ── Pip da floating-bar (original) ─────────────────
      if (pip) {
        const wasFilled = pip.classList.contains("filled");
        pip.classList.toggle("filled", shouldFill);

        if (shouldFill && !wasFilled) {
          pip.classList.add("pop");
          pip.addEventListener("animationend", () => pip.classList.remove("pop"), { once: true });
        }
      }

      // ── Pip da barra mobile (novo) ──────────────────────
      // A mesma animação "pop" dispara no mobile para que o aluno
      // veja o feedback independentemente de estar olhando
      // para o topo ou para o fundo da tela.
      if (pipMobile) {
        const wasMobileFilled = pipMobile.classList.contains("filled");
        pipMobile.classList.toggle("filled", shouldFill);

        if (shouldFill && !wasMobileFilled) {Carecalindao
          pipMobile.classList.add("pop");
          pipMobile.addEventListener("animationend", () => pipMobile.classList.remove("pop"), { once: true });
        }
      }
    }

    // Botão Concluir da floating-bar (original)
    const btnConclude = document.getElementById("btn-conclude");
    if (btnConclude) {
      btnConclude.disabled = n < 4;
      btnConclude.setAttribute("aria-disabled", n < 4 ? "true" : "false");
    }

    // Atualiza o nome na barra mobile se já estiver disponível.
    // Isso cobre o caso de _loadExistingChoices() ser chamada
    // na inicialização quando o aluno já tinha um nome verificado
    // em sessão anterior — o nome chega antes da primeira escolha.
    const mobileNameEl = document.getElementById("mobile-student-name");
    if (mobileNameEl && _studentName) {
      mobileNameEl.textContent = _studentName;
    }

    // Espelha o estado disabled no botão mobile.
    // _syncMobileBar é definida em app.js e exposta via window
    // para evitar dependência circular entre módulos.
    if (typeof window._syncMobileBar === "function") {
      window._syncMobileBar();
    }
  }

  // ── Callback ao completar as 4 escolhas ───────────────────
  function _onCompleted() {
    if (typeof confetti === "function") {
      const counter = document.getElementById("choice-counter");
      const origin  = { x: 0.85, y: 0.04 };

      if (counter) {
        const rect = counter.getBoundingClientRect();
        origin.x = (rect.left + rect.width  / 2) / window.innerWidth;
        origin.y = (rect.top  + rect.height / 2) / window.innerHeight;
      }

      const palette = ["#ffd43b", "#4dabf7", "#da77f2", "#63e6be", "#ffa94d"];

      confetti({
        particleCount: 60,
        spread:        50,
        startVelocity: 28,
        decay:         0.92,
        origin,
        colors:        palette,
        ticks:         200,
      });

      setTimeout(() => {
        confetti({
          particleCount: 40,
          spread:        80,
          startVelocity: 14,
          decay:         0.94,
          origin,
          colors:        palette,
          ticks:         250,
          scalar:        0.9,
        });
      }, 180);
    }

    _showToast("🎉 Você escolheu 4 elementos! Clique em Concluir para finalizar.");
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

    get sessionId()      { return _sessionId; },
    get sessionCode()    { return _sessionCode; },
    get studentName()    { return _studentName; },
    get confirmed()      { return _confirmed; },
    get choices()        { return [..._choices]; },
    get choicesCount()   { return _choices.length; },
    get isNameVerified() { return _studentName !== null; },
  };
})();
