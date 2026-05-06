// ============================================================
// admin.js — Lógica exclusiva do painel administrativo
//
// SEGURANÇA:
// - Todo acesso usa a anon key + JWT do Supabase Auth.
// - As políticas RLS no banco garantem que só admins logados
//   podem inserir/deletar na tabela students.
// - A service_role key NUNCA aparece aqui.
//
// CLOUDINARY:
// - Upload feito via unsigned preset direto do navegador.
// - A API Secret do Cloudinary NUNCA aparece aqui.
// - Substitua CLOUDINARY_CLOUD_NAME e CLOUDINARY_UPLOAD_PRESET
//   pelos valores do seu painel do Cloudinary.
// ============================================================

// ── Configuração do Cloudinary ────────────────────────────────
// ⚠ Substitua pelos seus valores reais antes do deploy!
const CLOUDINARY_CLOUD_NAME    = "dijqcsy3r";
const CLOUDINARY_UPLOAD_PRESET = "Tabela Periodica";
const CLOUDINARY_FOLDER        = "elementos";

// ── Estado local ──────────────────────────────────────────────
let _currentSection   = "overview";
let _elementsData     = {};   // { [number]: cloudinary_url | null }
let _activeFilter     = "all"; // "all" | "done" | "missing"
let _uploadingElement = null;  // número do elemento sendo enviado no momento
let _bulkRunning      = false;  // true enquanto o lote de upload em massa está ativo

// ── Normalização de nome para matching ───────────────────────
// Remove acentos e converte para minúsculas para comparação
// segura entre o nome do arquivo e o name_pt do banco.
// Ex: "Nitrogênio" → "nitrogenio", "Berílio" → "berilio"
function _normalizeName(str) {
  return str
    .toLowerCase()
    .normalize("NFD")                    // decompõe letras acentuadas em base + diacrítico
    .replace(/[\u0300-\u036f]/g, "")   // remove os diacríticos (acentos)
    .trim();
}

// Extrai o nome do elemento a partir do nome do arquivo.
// Padrão esperado: "elemento_[nome].png" (ou .jpg/.webp)
// Retorna null se o arquivo não seguir o padrão.
function _extractNameFromFilename(filename) {
  const match = filename.match(/^elemento_(.+?)\.(png|jpg|jpeg|webp)$/i);
  if (!match) return null;
  return match[1]; // o nome entre "elemento_" e a extensão
}

// Tenta encontrar o elemento do ELEMENTS_LAYOUT correspondente
// ao nome extraído do arquivo, usando comparação normalizada.
function _matchElementByName(extractedName) {
  const normalizedExtracted = _normalizeName(extractedName);
  return ELEMENTS_LAYOUT.find(el =>
    _normalizeName(el.name_pt) === normalizedExtracted
  ) ?? null;
}

// ── Inicialização ─────────────────────────────────────────────
async function initAdmin() {
  const { data: { session } } = await window._supabase.auth.getSession();

  if (!session) {
    showLogin();
    return;
  }

  showPanel();
  await loadAdminData();
}

function showLogin() {
  document.getElementById("login-section").classList.remove("hidden");
  const panel = document.getElementById("admin-panel");
  panel.classList.add("hidden");
  panel.style.display = "none";
}

function showPanel() {
  document.getElementById("login-section").classList.add("hidden");
  const panel = document.getElementById("admin-panel");
  panel.classList.remove("hidden");
  panel.style.display = "";
}

// ── Login ─────────────────────────────────────────────────────
async function adminLogin() {
  const email    = document.getElementById("admin-email")?.value.trim();
  const password = document.getElementById("admin-password")?.value;
  const errEl    = document.getElementById("login-error");

  if (!email || !password) {
    if (errEl) errEl.textContent = "Preencha e-mail e senha.";
    return;
  }

  const btn = document.getElementById("btn-admin-login");
  if (btn) { btn.disabled = true; btn.textContent = "Entrando…"; }

  const { error } = await window._supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (errEl) errEl.textContent = "Credenciais inválidas. Tente novamente.";
    if (btn) { btn.disabled = false; btn.textContent = "Entrar"; }
    return;
  }

  showPanel();
  await loadAdminData();
}

// ── Logout ────────────────────────────────────────────────────
async function adminLogout() {
  await window._supabase.auth.signOut();
  showLogin();
}

// ── Carregamento de dados gerais ──────────────────────────────
async function loadAdminData() {
  await Promise.all([
    loadStats(),
    loadRecentChoices(),
  ]);
}

async function loadStats() {
  const [
    { count: totalStudents },
    { data: allChoices },
  ] = await Promise.all([
    window._supabase.from("students").select("*", { count: "exact", head: true }),
    window._supabase.from("element_choices").select("student_name, session_id"),
  ]);

  const sessionsWithChoices = new Set((allChoices ?? []).map(r => r.session_id));

  const choicesBySession = {};
  (allChoices ?? []).forEach(r => {
    choicesBySession[r.session_id] = (choicesBySession[r.session_id] ?? 0) + 1;
  });
  const completeSessions = Object.values(choicesBySession).filter(c => c >= 4).length;

  _setText("stat-students",       totalStudents ?? 0);
  _setText("stat-with-choices",   sessionsWithChoices.size);
  _setText("stat-complete",       completeSessions);
  _setText("stat-elements-taken", (allChoices ?? []).length);
}

async function loadRecentChoices() {
  const { data } = await window._supabase
    .from("element_choices")
    .select("student_name, element_number, chosen_at")
    .order("chosen_at", { ascending: false })
    .limit(20);

  const tbody = document.getElementById("recent-choices-tbody");
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);padding:20px">Nenhuma escolha ainda.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(row => {
    const el   = ELEMENTS_LAYOUT.find(e => e.number === row.element_number);
    const time = new Date(row.chosen_at).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
    return `
      <tr>
        <td>${row.student_name ?? "—"}</td>
        <td>${el?.name_pt ?? `Nº ${row.element_number}`}</td>
        <td style="font-family:var(--font-mono);font-weight:700">${el?.symbol ?? "?"}</td>
        <td style="color:var(--text-muted);font-size:12px">${time}</td>
      </tr>
    `;
  }).join("");
}

// ── Gerenciamento de alunos ───────────────────────────────────
async function loadStudentsList() {
  const [
    { data: students },
    { data: choices },
  ] = await Promise.all([
    window._supabase.from("students").select("id, full_name, created_at").order("full_name"),
    window._supabase.from("element_choices").select("student_name, element_number"),
  ]);

  const choicesByName = {};
  (choices ?? []).forEach(c => {
    const name = (c.student_name ?? "").toLowerCase();
    if (!choicesByName[name]) choicesByName[name] = [];
    choicesByName[name].push(c.element_number);
  });

  const tbody = document.getElementById("students-tbody");
  if (!tbody) return;

  if (!students || students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted);padding:20px">Nenhum aluno cadastrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = students.map(student => {
    const studentChoices = choicesByName[student.full_name.toLowerCase()] ?? [];
    const count = studentChoices.length;

    let badgeClass = "none";
    let badgeText  = "Sem escolhas";
    if (count >= 4)      { badgeClass = "complete"; badgeText = "Completo (4/4)"; }
    else if (count > 0)  { badgeClass = "partial";  badgeText = `Parcial (${count}/4)`; }

    const elementsStr = studentChoices.length > 0
      ? studentChoices.sort((a, b) => a - b).join(", ")
      : "—";

    return `
      <tr>
        <td style="font-weight:500">${student.full_name}</td>
        <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
        <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${elementsStr}</td>
        <td>
          <button class="btn-delete" onclick="deleteStudent('${student.id}', '${student.full_name.replace(/'/g, "\\'")}')">
            Remover
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

async function addStudent() {
  const input = document.getElementById("new-student-name");
  const name  = input?.value.trim();

  if (!name || name.length < 2) {
    alert("Digite o nome completo do aluno.");
    return;
  }

  const btn = document.getElementById("btn-add-student");
  if (btn) { btn.disabled = true; btn.textContent = "Adicionando…"; }

  const { error } = await window._supabase
    .from("students")
    .insert({ full_name: name });

  if (btn) { btn.disabled = false; btn.textContent = "Adicionar"; }

  if (error) {
    if (error.code === "23505") {
      alert(`O aluno "${name}" já está cadastrado.`);
    } else {
      alert(`Erro ao adicionar: ${error.message}`);
    }
    return;
  }

  if (input) input.value = "";
  await loadStudentsList();
  await loadStats();
}

async function deleteStudent(id, name) {
  if (!confirm(`Remover "${name}" da lista? Esta ação não desfaz escolhas já feitas.`)) return;

  const { error } = await window._supabase
    .from("students")
    .delete()
    .eq("id", id);

  if (error) {
    alert(`Erro ao remover: ${error.message}`);
    return;
  }

  await loadStudentsList();
  await loadStats();
}

// ── Mapa de escolhas ──────────────────────────────────────────
async function loadChoicesMap() {
  const { data: choices } = await window._supabase
    .from("element_choices")
    .select("element_number, student_name");

  const choiceByElement = {};
  (choices ?? []).forEach(c => {
    choiceByElement[c.element_number] = c.student_name;
  });

  const container = document.getElementById("choices-map");
  if (!container) return;

  container.innerHTML = ELEMENTS_LAYOUT.map(el => {
    const owner   = choiceByElement[el.number];
    const isTaken = !!owner;
    return `
      <div style="
        background:${isTaken ? `color-mix(in srgb, var(--cat-${el.category}) 20%, var(--bg-card))` : "var(--bg-card)"};
        border:1px solid ${isTaken ? `var(--cat-${el.category})` : "var(--border)"};
        border-radius:6px;
        padding:10px;
        opacity:${isTaken ? "1" : "0.4"};
      ">
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">${el.number}</div>
        <div style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--cat-${el.category})">${el.symbol}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${el.name_pt}</div>
        ${isTaken ? `<div style="font-size:10px;color:var(--text);margin-top:6px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${owner}">${owner}</div>` : ""}
      </div>
    `;
  }).join("");
}

// ── Gestão de imagens dos elementos (seção principal nova) ────

// Busca no banco quais elementos já têm URL preenchida e
// armazena em _elementsData para referência rápida nos cards.
async function loadElementsSection() {
  // Mostra estado de carregamento
  const grid = document.getElementById("elements-upload-grid");
  if (grid) grid.innerHTML = `<div class="elements-loading">Carregando elementos…</div>`;

  const { data, error } = await window._supabase
    .from("elements")
    .select("number, cloudinary_url");

  if (error) {
    if (grid) grid.innerHTML = `<div class="elements-loading" style="color:var(--danger)">Erro ao carregar: ${error.message}</div>`;
    return;
  }

  // Reconstrói o mapa de URLs a partir do que veio do banco
  _elementsData = {};
  (data ?? []).forEach(row => {
    _elementsData[row.number] = row.cloudinary_url ?? null;
  });

  // Atualiza o contador de progresso no topo da seção
  _updateElementsProgress();

  // Renderiza os cards com o filtro ativo
  renderElementCards();
}

// Atualiza a barra de progresso e os números (X/118 preenchidos)
function _updateElementsProgress() {
  const total  = ELEMENTS_LAYOUT.length;                          // sempre 118
  const done   = Object.values(_elementsData).filter(Boolean).length;
  const pct    = Math.round((done / total) * 100);

  _setText("elements-progress-done",  done);
  _setText("elements-progress-total", total);
  _setText("elements-progress-pct",   `${pct}%`);

  const bar = document.getElementById("elements-progress-bar");
  if (bar) bar.style.width = `${pct}%`;
}

// Renderiza os cards de acordo com o filtro ativo (_activeFilter)
function renderElementCards() {
  const grid = document.getElementById("elements-upload-grid");
  if (!grid) return;

  // Filtra a lista de elementos conforme o seletor de filtro
  const filtered = ELEMENTS_LAYOUT.filter(el => {
    const hasPic = !!_elementsData[el.number];
    if (_activeFilter === "done")    return hasPic;
    if (_activeFilter === "missing") return !hasPic;
    return true; // "all"
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="elements-loading" style="color:var(--text-muted)">Nenhum elemento nesta categoria.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(el => _buildElementCard(el)).join("");

  // Após renderizar, anexa um listener de "change" em cada input por card.
  // Fazemos isso aqui (e não via delegação na grade) porque o evento "change"
  // de um file input também precisa estar próximo da origem para funcionar
  // corretamente em todos os navegadores.
  grid.querySelectorAll(".elem-file-input-card").forEach(input => {
    input.addEventListener("change", onElementFileSelected);
  });
}

// Constrói o HTML de um único card de elemento com estado visual
function _buildElementCard(el) {
  const url      = _elementsData[el.number];
  const hasPic   = !!url;
  const isUpping = _uploadingElement === el.number;

  // Se tem imagem, mostra thumbnail; se não tem, mostra placeholder com símbolo.
  // Sem onerror= inline (viola CSP) — o fallback é feito via listener com capture.
  const imageContent = hasPic
    ? `<img
        src="${url}"
        alt="${el.name_pt}"
        class="elem-card-img"
        loading="lazy"
        data-fallback-symbol="${el.symbol}"
       >
       <div class="elem-card-placeholder" style="display:none">
         <span>${el.symbol}</span>
       </div>`
    : `<div class="elem-card-placeholder">
         <span>${el.symbol}</span>
       </div>`;

  const btnText = isUpping
    ? `<span class="elem-upload-spinner"></span> Enviando…`
    : hasPic ? `↺ Trocar imagem` : `↑ Adicionar imagem`;

  const btnClass = isUpping ? "elem-upload-btn uploading" : "elem-upload-btn";

  // Cada card tem seu próprio <input type="file"> invisível como label.
  // Isso garante que o clique no botão/imagem aciona diretamente o input
  // sem intermediários — o navegador exige que o .click() num file input
  // venha de um gesto do usuário direto, sem delegação de eventos.
  // O input fica dentro de um <label> que envolve o botão, então o
  // clique no botão dispara o input nativamente pelo browser, sem JS.
  const inputId = `elem-file-${el.number}`;

  return `
    <div class="elem-card ${hasPic ? "has-image" : "no-image"}" data-number="${el.number}">

      <label for="${inputId}" class="elem-card-image-wrap" style="cursor:pointer">
        ${imageContent}
        <div class="elem-card-overlay">
          <span>${hasPic ? "Trocar" : "Adicionar"}</span>
        </div>
      </label>

      <div class="elem-card-info">
        <div class="elem-card-number" style="color:var(--cat-${el.category})">${el.number}</div>
        <div class="elem-card-symbol" style="color:var(--cat-${el.category})">${el.symbol}</div>
        <div class="elem-card-name">${el.name_pt}</div>
      </div>

      <label for="${inputId}" class="${btnClass}" style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px">
        ${btnText}
      </label>

      <input
        type="file"
        id="${inputId}"
        class="elem-file-input-card"
        data-number="${el.number}"
        accept="image/jpeg,image/png,image/webp"
        style="display:none"
        ${isUpping ? "disabled" : ""}
      >
    </div>
  `;
}

// triggerUpload foi removido — o upload agora é acionado diretamente pelo
// <label for="elem-file-NNN"> em cada card, sem precisar de JS intermediário.
// O navegador conecta o label ao input nativamente, garantindo o user gesture.

// Disparado quando o usuário seleciona um arquivo num dos inputs por card.
// O número do elemento vem do atributo data-number do próprio input.
async function onElementFileSelected(event) {
  const file          = event.target.files[0];
  const elementNumber = parseInt(event.target.dataset.number, 10);

  if (!file || isNaN(elementNumber)) return;

  // Valida tipo de arquivo antes de enviar (aceita jpg, png, webp)
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    alert("Use imagens no formato JPG, PNG ou WebP.");
    return;
  }

  // Marca o card como "em upload" para feedback visual imediato
  _uploadingElement = elementNumber;
  _refreshCard(elementNumber);

  try {
    // ── Passo 1: envia a imagem pro Cloudinary ────────────────
    const cloudinaryUrl = await _uploadToCloudinary(file, elementNumber);

    // ── Passo 2: salva a URL retornada no Supabase ────────────
    await _saveUrlToSupabase(elementNumber, cloudinaryUrl);

    // ── Passo 3: atualiza o estado local e redesenha o card ───
    _elementsData[elementNumber] = cloudinaryUrl;
    _updateElementsProgress();

  } catch (err) {
    console.error("[elements upload]", err);
    alert(`Erro ao enviar imagem: ${err.message}`);
  } finally {
    // Sempre limpa o estado de upload, mesmo em caso de erro
    _uploadingElement = null;
    _refreshCard(elementNumber);
  }
}

// Faz o upload de um arquivo para o Cloudinary via unsigned preset.
// Retorna a URL segura (https) da imagem hospedada.
async function _uploadToCloudinary(file, elementNumber) {
  const formData = new FormData();
  formData.append("file",         file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  // Nomeia o arquivo com o padrão elemento_NNN para organização na pasta
  const paddedNum = String(elementNumber).padStart(3, "0");
  formData.append("public_id", `${CLOUDINARY_FOLDER}/elemento_${paddedNum}`);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: formData }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }

  const data = await res.json();

  // secure_url usa HTTPS — sempre use este, nunca o "url" (HTTP)
  return data.secure_url;
}

// Salva ou atualiza a cloudinary_url na tabela elements do Supabase.
// Usa upsert para funcionar tanto em inserção quanto em atualização.
async function _saveUrlToSupabase(elementNumber, url) {
  const { error } = await window._supabase
    .from("elements")
    .update({ cloudinary_url: url })
    .eq("number", elementNumber);

  if (error) {
    throw new Error(`Supabase: ${error.message}`);
  }
}

// Redesenha apenas o card do elemento afetado, sem re-renderizar a grade inteira.
// Isso evita flickering e preserva a posição de scroll do usuário.
function _refreshCard(elementNumber) {
  const el = ELEMENTS_LAYOUT.find(e => e.number === elementNumber);
  if (!el) return;

  // Se o filtro ativo pode esconder este card após o upload, re-renderiza tudo
  // (ex: filtro "missing" e o upload foi bem-sucedido → card deve sumir)
  const hasPic = !!_elementsData[elementNumber];
  const shouldHide =
    (_activeFilter === "missing" && hasPic) ||
    (_activeFilter === "done"    && !hasPic);

  if (shouldHide) {
    renderElementCards();
    return;
  }

  // Caso contrário, atualiza apenas o card específico no DOM
  const existingCard = document.querySelector(`.elem-card[data-number="${elementNumber}"]`);
  if (existingCard) {
    existingCard.outerHTML = _buildElementCard(el);
  }
}

// Muda o filtro ativo e re-renderiza os cards
function setElementsFilter(filter) {
  _activeFilter = filter;

  // Atualiza visual dos botões de filtro
  document.querySelectorAll(".elements-filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });

  renderElementCards();
}

// ── Upload em lote (importação em massa) ─────────────────────

// Disparado quando o usuário seleciona vários arquivos pelo input em lote.
// Para cada arquivo: tenta fazer o match pelo nome, faz upload pro Cloudinary,
// salva URL no Supabase, e atualiza o painel de progresso em tempo real.
async function onBulkFilesSelected(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  // Bloqueia re-entrada: o botão flutuante vira "Cancelar" durante o lote
  _bulkRunning = true;
  _setBulkButtonState("running");

  // Classifica os arquivos antes de começar:
  // matched  → arquivo tem nome válido E encontramos o elemento correspondente
  // unmatched → arquivo segue o padrão mas não bateu com nenhum elemento
  // invalid  → arquivo não segue o padrão "elemento_[nome].ext"
  const matched   = [];
  const unmatched = [];
  const invalid   = [];

  for (const file of files) {
    const extractedName = _extractNameFromFilename(file.name);
    if (!extractedName) {
      invalid.push(file.name);
      continue;
    }
    const el = _matchElementByName(extractedName);
    if (!el) {
      unmatched.push(file.name);
    } else {
      matched.push({ file, el });
    }
  }

  // Exibe o painel de progresso com o resumo inicial
  _showBulkProgress(matched.length, unmatched, invalid);

  let successCount = 0;
  let errorCount   = 0;

  // Processa os matched em sequência (não em paralelo) para evitar
  // sobrecarregar o Cloudinary e facilitar o acompanhamento visual.
  for (let i = 0; i < matched.length; i++) {
    if (!_bulkRunning) break; // usuário cancelou

    const { file, el } = matched[i];
    _updateBulkProgressItem(el.number, "uploading", `Enviando ${el.name_pt}…`);

    try {
      const url = await _uploadToCloudinary(file, el.number);
      await _saveUrlToSupabase(el.number, url);

      _elementsData[el.number] = url;
      _updateElementsProgress();
      _refreshCard(el.number);

      successCount++;
      _updateBulkProgressItem(el.number, "success", `✓ ${el.name_pt}`);
    } catch (err) {
      errorCount++;
      _updateBulkProgressItem(el.number, "error", `✗ ${el.name_pt}: ${err.message}`);
    }

    // Atualiza o contador de progresso geral do painel
    _updateBulkProgressCount(i + 1, matched.length, successCount, errorCount);
  }

  // Lote concluído
  _bulkRunning = false;
  _setBulkButtonState("idle");
  _finalizeBulkProgress(successCount, errorCount, unmatched, invalid);

  // Reseta o input para permitir re-seleção dos mesmos arquivos se necessário
  event.target.value = "";
}

// Exibe o painel de progresso e monta a lista de itens a processar
function _showBulkProgress(matchedCount, unmatched, invalid) {
  const panel = document.getElementById("bulk-progress-panel");
  if (!panel) return;

  panel.style.display = "block";

  // Cabeçalho com contagem
  const header = panel.querySelector("#bulk-progress-header");
  if (header) {
    header.textContent = `Processando ${matchedCount} imagens…`;
  }

  // Lista de unmatched e inválidos (aviso imediato, antes mesmo de começar)
  const warnings = panel.querySelector("#bulk-warnings");
  if (warnings) {
    let html = "";
    if (unmatched.length) {
      html += `<div class="bulk-warning">⚠ ${unmatched.length} arquivo(s) com nome válido mas sem elemento correspondente:<br>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${unmatched.join(", ")}</span>
      </div>`;
    }
    if (invalid.length) {
      html += `<div class="bulk-warning">⚠ ${invalid.length} arquivo(s) ignorados (não seguem o padrão elemento_nome.png):<br>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${invalid.join(", ")}</span>
      </div>`;
    }
    warnings.innerHTML = html;
  }

  // Lista de progresso — um item por matched
  const list = panel.querySelector("#bulk-progress-list");
  if (list) list.innerHTML = ""; // limpa execução anterior
}

// Atualiza o estado visual de um item específico na fila
function _updateBulkProgressItem(elementNumber, status, text) {
  const list = document.getElementById("bulk-progress-list");
  if (!list) return;

  // Verifica se o item já existe (pode ser uma segunda execução)
  let item = list.querySelector(`[data-bulk-number="${elementNumber}"]`);
  if (!item) {
    item = document.createElement("div");
    item.className = "bulk-progress-item";
    item.dataset.bulkNumber = elementNumber;
    list.appendChild(item);
  }

  item.className = `bulk-progress-item bulk-${status}`;
  item.textContent = text;

  // Mantém o item visível fazendo scroll automático
  item.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// Atualiza o contador geral de progresso no topo do painel
function _updateBulkProgressCount(current, total, success, errors) {
  const header = document.getElementById("bulk-progress-header");
  if (header) {
    header.textContent = `Processando ${current}/${total} — ✓ ${success} ok, ✗ ${errors} erro(s)`;
  }
}

// Mostra o resumo final quando o lote termina
function _finalizeBulkProgress(success, errors, unmatched, invalid) {
  const header = document.getElementById("bulk-progress-header");
  if (header) {
    const skipped = unmatched.length + invalid.length;
    header.textContent =
      `Concluído — ✓ ${success} enviadas, ✗ ${errors} erro(s), ⊘ ${skipped} ignoradas`;
  }
}

// Alterna o visual e comportamento do botão flutuante conforme o estado
function _setBulkButtonState(state) {
  const btn = document.getElementById("btn-bulk-upload");
  if (!btn) return;

  if (state === "running") {
    btn.textContent  = "⊗ Cancelar lote";
    btn.className    = "bulk-upload-fab running";
    btn.dataset.mode = "cancel";
  } else {
    btn.textContent  = "⬆ Importar imagens";
    btn.className    = "bulk-upload-fab";
    btn.dataset.mode = "select";
  }
}

// ── Navegação entre seções ────────────────────────────────────
function navigateTo(sectionName) {
  document.querySelectorAll(".admin-content-section").forEach(s => s.classList.add("hidden"));
  document.querySelectorAll(".admin-nav-item").forEach(b => b.classList.remove("active"));

  const section = document.getElementById(`section-${sectionName}`);
  const navBtn  = document.querySelector(`[data-section="${sectionName}"]`);

  section?.classList.remove("hidden");
  navBtn?.classList.add("active");

  _currentSection = sectionName;

  switch (sectionName) {
    case "students": loadStudentsList();    break;
    case "choices":  loadChoicesMap();      break;
    case "elements": loadElementsSection(); break;
  }
}

// ── Utilitários ───────────────────────────────────────────────
function _setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ── Event listeners e arranque ────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Login
  document.getElementById("btn-admin-login")?.addEventListener("click", adminLogin);
  document.getElementById("admin-password")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") adminLogin();
  });

  // Logout
  document.getElementById("btn-logout")?.addEventListener("click", adminLogout);

  // Navegação
  document.querySelectorAll(".admin-nav-item").forEach(btn => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.section));
  });

  // Adicionar aluno
  document.getElementById("btn-add-student")?.addEventListener("click", addStudent);
  document.getElementById("new-student-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addStudent();
  });

  // Botões de filtro da seção de elementos
  document.querySelectorAll(".elements-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => setElementsFilter(btn.dataset.filter));
  });

  // Fallback de imagem quebrada — delegação com capture na grade.
  // O evento "error" não sobe pelo DOM, então usamos capture: true
  // para interceptá-lo antes que desapareça. Quando uma imagem falha
  // ao carregar, esconde o <img> e mostra o placeholder com o símbolo.
  const grid = document.getElementById("elements-upload-grid");
  if (grid) {
    grid.addEventListener("error", (e) => {
      if (e.target.tagName !== "IMG") return;
      e.target.style.display = "none";
      const placeholder = e.target.nextElementSibling;
      if (placeholder) placeholder.style.display = "flex";
    }, true);
  }

  // Fecha o painel de progresso do lote ao clicar no ✕
  document.getElementById("btn-bulk-panel-close")?.addEventListener("click", () => {
    const panel = document.getElementById("bulk-progress-panel");
    if (panel) panel.style.display = "none";
  });

  // ── Botão flutuante de importação em lote ────────────────
  // O botão tem dois modos: "select" abre o seletor de arquivos,
  // "cancel" interrompe um lote em andamento (seta _bulkRunning=false).
  const bulkBtn   = document.getElementById("btn-bulk-upload");
  const bulkInput = document.getElementById("bulk-file-input");

  if (bulkBtn && bulkInput) {
    bulkInput.addEventListener("change", onBulkFilesSelected);

    bulkBtn.addEventListener("click", () => {
      if (bulkBtn.dataset.mode === "cancel") {
        // Cancela o lote atual — o loop em onBulkFilesSelected vai parar
        // na próxima iteração quando checar _bulkRunning === false
        _bulkRunning = false;
        _setBulkButtonState("idle");
        const header = document.getElementById("bulk-progress-header");
        if (header) header.textContent += " (cancelado)";
      } else {
        // Abre o seletor de múltiplos arquivos
        bulkInput.value = "";
        bulkInput.click();
      }
    });
  }

  // Inicializa
  initAdmin();
});
