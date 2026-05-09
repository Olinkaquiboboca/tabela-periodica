// ============================================================
// session.js — Gerenciamento de sessão do aluno
//
// REGRAS DE SEGURANÇA DESTE MÓDULO:
// 1. Nunca armazenar o ip_hash ou qualquer dado sensível.
// 2. O device_id é gerado no cliente e salvo no localStorage —
//    identifica o dispositivo/browser sem depender de IP externo.
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
  // Em vez de depender do IP externo do roteador (que é o mesmo
  // para todos os dispositivos na mesma rede WiFi), geramos um
  // UUID único por dispositivo/browser e persistimos no localStorage.
  //
  // Na primeira visita: crypto.randomUUID() cria um UUID v4 e
  // o salva em "tp_device_id" no localStorage deste domínio.
  // Nas visitas seguintes: o mesmo UUID é recuperado — a sessão
  // do aluno é restaurada corretamente mesmo após recarregar.
  //
  // Limitação conhecida: modo anônimo cria um localStorage
  // temporário que some ao fechar o browser. Na prática,
  // para uso escolar em browser normal, isso não é problema.
  function _getOrCreateDeviceId() {
    const KEY = "tp_device_id";
    let id = localStorage.getItem(KEY);
    if (!id) {
      // crypto.randomUUID() é nativo em todos os browsers modernos
      // (Chrome 92+, Firefox 95+, Safari 15.4+) — sem dependência.
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
        // device_id enviado no body — a Edge Function usa ele
        // para identificar o dispositivo em vez do IP externo.
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
  function _updateCounter() {
    const n = _choices.length;

    const countEl = document.getElementById("count-current");
    if (countEl) countEl.textContent = n;

    for (let i = 1; i <= 4; i++) {
      const pip = document.getElementById(`pip-${i}`);
      if (!pip) continue;

      const wasFilled = pip.classList.contains("filled");
      const shouldFill = i <= n;

      pip.classList.toggle("filled", shouldFill);

      if (shouldFill && !wasFilled) {
        pip.classList.add("pop");
        pip.addEventListener("animationend", () => pip.classList.remove("pop"), { once: true });
      }
    }

    const btnConclude = document.getElementById("btn-conclude");
    if (btnConclude) {
      btnConclude.disabled = n < 4;
      btnConclude.setAttribute("aria-disabled", n < 4 ? "true" : "false");
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
