// ============================================================
// table.js — Renderização e estado da tabela periódica
//
// Layout IUPAC padrão: 18 colunas, 10 linhas.
// Os dados de layout são estáticos (não buscados do banco) para
// evitar requisição extra no carregamento.
// Os dados de imagem/cloudinary_url vêm do banco sob demanda.
// ============================================================

// Lookup rápido por número de elemento
const ELEMENT_BY_NUMBER = new Map(ELEMENTS_LAYOUT.map(el => [el.number, el]));

// ── Estado global de células ──────────────────────────────────
const takenElements = new Set(); // escolhidos por qualquer aluno
const myElements    = new Set(); // escolhidos pelo aluno desta sessão

// ── Renderização da tabela ────────────────────────────────────
function renderTable() {
  const grid = document.getElementById("periodic-table");
  grid.innerHTML = "";

  // Configura o CSS Grid
  grid.style.gridTemplateColumns = "repeat(18, minmax(50px, 1fr))";

  ELEMENTS_LAYOUT.forEach((el, idx) => {
    const cell = document.createElement("div");
    cell.className = `element-cell cat-${el.category}`;
    cell.dataset.number = el.number;
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `${el.name_pt}, símbolo ${el.symbol}, número ${el.number}`);
    cell.setAttribute("tabindex", "0");

    // Delay escalonado na animação de entrada
    cell.style.animationDelay = `${Math.min(idx * 4, 300)}ms`;

    // Posicionamento no CSS Grid
    cell.style.gridRow    = el.row;
    cell.style.gridColumn = el.col;

    cell.innerHTML = `
      <span class="cell-number">${el.number}</span>
      <span class="cell-symbol">${el.symbol}</span>
      <span class="cell-name">${el.name_pt}</span>
    `;

    // Eventos
    cell.addEventListener("click",   () => onCellClick(el.number));
    cell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onCellClick(el.number);
      }
    });

    grid.appendChild(cell);
  });
}

// ── Clique em célula ──────────────────────────────────────────
function onCellClick(elementNumber) {
  // Se o elemento é meu, abre o modal mostrando isso
  if (myElements.has(elementNumber)) {
    Modal.open(elementNumber, { isMine: true });
    return;
  }

  // Se o elemento está ocupado por outro, feedback visual
  if (takenElements.has(elementNumber)) {
    showShakeFeedback(elementNumber);
    return;
  }

  // Se o aluno já tem 4 escolhas, não abre
  if (Session.choicesCount >= 4) {
    showShakeFeedback(elementNumber);
    return;
  }

  // Abre o modal normalmente
  Modal.open(elementNumber, { isMine: false });
}

// ── Marca um elemento como escolhido ──────────────────────────
function markElementTaken(elementNumber, isMine = false) {
  if (takenElements.has(elementNumber)) return; // já marcado

  takenElements.add(elementNumber);

  const cell = document.querySelector(`.element-cell[data-number="${elementNumber}"]`);
  if (!cell) return;

  if (isMine) {
    myElements.add(elementNumber);
    cell.classList.add("chosen-mine");
    cell.setAttribute("aria-label",
      `${ELEMENT_BY_NUMBER.get(elementNumber)?.name_pt ?? ""} — seu elemento`);
  } else {
    cell.classList.add("chosen-other");
    cell.setAttribute("aria-label",
      `${ELEMENT_BY_NUMBER.get(elementNumber)?.name_pt ?? ""} — já escolhido`);
    cell.setAttribute("aria-disabled", "true");
  }
}

// ── Feedback de "já ocupado" ──────────────────────────────────
function showShakeFeedback(elementNumber) {
  const cell = document.querySelector(`.element-cell[data-number="${elementNumber}"]`);
  if (!cell) return;

  cell.classList.add("shake");
  cell.addEventListener("animationend", () => cell.classList.remove("shake"), { once: true });
}

// ── Carregamento do estado inicial do banco ───────────────────
async function loadInitialState() {
  const { data, error } = await window._supabase
    .from("element_choices")
    .select("element_number, session_id");

  if (error) {
    console.warn("[table.js] Erro ao carregar estado inicial:", error.message);
    return;
  }

  if (data) {
    data.forEach(row => {
      const isMine = row.session_id === Session.sessionId;
      markElementTaken(row.element_number, isMine);
    });
  }
}

// ── Ponto de entrada ──────────────────────────────────────────
async function initTable() {
  renderTable();
  await loadInitialState();
}
