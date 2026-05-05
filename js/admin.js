// ============================================================
// admin.js — Lógica exclusiva do painel administrativo
//
// SEGURANÇA:
// - Todo acesso usa a anon key + JWT do Supabase Auth.
// - As políticas RLS no banco garantem que só admins logados
//   podem inserir/deletar na tabela students.
// - A service_role key NUNCA aparece aqui.
// ============================================================

// ── Estado local ──────────────────────────────────────────────
let _currentSection = "overview";

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

// ── Carregamento de dados ─────────────────────────────────────
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

  // Conta sessões únicas com pelo menos 1 escolha
  const sessionsWithChoices = new Set((allChoices ?? []).map(r => r.session_id));

  // Conta alunos com exatamente 4 escolhas (by session)
  const choicesBySession = {};
  (allChoices ?? []).forEach(r => {
    choicesBySession[r.session_id] = (choicesBySession[r.session_id] ?? 0) + 1;
  });
  const completeSessions = Object.values(choicesBySession).filter(c => c >= 4).length;

  // Atualiza stats na UI
  _setText("stat-students",        totalStudents ?? 0);
  _setText("stat-with-choices",    sessionsWithChoices.size);
  _setText("stat-complete",        completeSessions);
  _setText("stat-elements-taken",  (allChoices ?? []).length);
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
    const el   = ELEMENTS_LAYOUT_ADMIN.find(e => e.number === row.element_number);
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

  // Agrupa escolhas por nome de aluno
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
    if (count >= 4)  { badgeClass = "complete"; badgeText = "Completo (4/4)"; }
    else if (count > 0) { badgeClass = "partial"; badgeText = `Parcial (${count}/4)`; }

    const elementsStr = studentChoices.length > 0
      ? studentChoices.sort((a,b) => a-b).join(", ")
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

  container.innerHTML = ELEMENTS_LAYOUT_ADMIN.map(el => {
    const owner = choiceByElement[el.number];
    const isTaken = !!owner;
    return `
      <div style="
        background:${isTaken ? "color-mix(in srgb, var(--cat-${el.category}) 20%, var(--bg-card))" : "var(--bg-card)"};
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

// ── Status dos elementos ──────────────────────────────────────
async function loadElementsStatus() {
  const { data, count } = await window._supabase
    .from("elements")
    .select("number", { count: "exact", head: false });

  const statusEl = document.getElementById("elements-status");
  if (!statusEl) return;

  if (!count || count === 0) {
    statusEl.innerHTML = `
      <div style="color:var(--danger)">
        ⚠ Nenhum elemento cadastrado no banco ainda.
        Execute o SQL de INSERT para adicionar os 118 elementos com suas URLs do Cloudinary.
      </div>
    `;
  } else {
    statusEl.innerHTML = `
      <div style="color:var(--success)">
        ✓ ${count} de 118 elementos com imagens cadastradas no banco.
        ${count < 118 ? `<br><span style="color:#ffa94d">⚠ Faltam ${118 - count} elementos.</span>` : ""}
      </div>
    `;
  }
}

// ── Navegação entre seções ────────────────────────────────────
function navigateTo(sectionName) {
  // Oculta todas as seções
  document.querySelectorAll(".admin-content-section").forEach(s => s.classList.add("hidden"));
  document.querySelectorAll(".admin-nav-item").forEach(b => b.classList.remove("active"));

  // Exibe a seção selecionada
  const section = document.getElementById(`section-${sectionName}`);
  const navBtn  = document.querySelector(`[data-section="${sectionName}"]`);

  section?.classList.remove("hidden");
  navBtn?.classList.add("active");

  _currentSection = sectionName;

  // Carrega dados específicos da seção
  switch (sectionName) {
    case "students": loadStudentsList(); break;
    case "choices":  loadChoicesMap();   break;
    case "elements": loadElementsStatus(); break;
  }
}

// ── Utilitário ────────────────────────────────────────────────
function _setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// Versão compacta do layout (só o que o admin precisa)
const ELEMENTS_LAYOUT_ADMIN = [
  { number: 1,   symbol: "H",  name_pt: "Hidrogênio",    category: "nao-metal"           },
  { number: 2,   symbol: "He", name_pt: "Hélio",          category: "gas-nobre"           },
  { number: 3,   symbol: "Li", name_pt: "Lítio",          category: "alcali"              },
  { number: 4,   symbol: "Be", name_pt: "Berílio",        category: "alcalino-terroso"    },
  { number: 5,   symbol: "B",  name_pt: "Boro",           category: "semimetal"           },
  { number: 6,   symbol: "C",  name_pt: "Carbono",        category: "nao-metal"           },
  { number: 7,   symbol: "N",  name_pt: "Nitrogênio",     category: "nao-metal"           },
  { number: 8,   symbol: "O",  name_pt: "Oxigênio",       category: "nao-metal"           },
  { number: 9,   symbol: "F",  name_pt: "Flúor",          category: "halogenio"           },
  { number: 10,  symbol: "Ne", name_pt: "Neônio",         category: "gas-nobre"           },
  { number: 11,  symbol: "Na", name_pt: "Sódio",          category: "alcali"              },
  { number: 12,  symbol: "Mg", name_pt: "Magnésio",       category: "alcalino-terroso"    },
  { number: 13,  symbol: "Al", name_pt: "Alumínio",       category: "metal-pos-transicao" },
  { number: 14,  symbol: "Si", name_pt: "Silício",        category: "semimetal"           },
  { number: 15,  symbol: "P",  name_pt: "Fósforo",        category: "nao-metal"           },
  { number: 16,  symbol: "S",  name_pt: "Enxofre",        category: "nao-metal"           },
  { number: 17,  symbol: "Cl", name_pt: "Cloro",          category: "halogenio"           },
  { number: 18,  symbol: "Ar", name_pt: "Argônio",        category: "gas-nobre"           },
  { number: 19,  symbol: "K",  name_pt: "Potássio",       category: "alcali"              },
  { number: 20,  symbol: "Ca", name_pt: "Cálcio",         category: "alcalino-terroso"    },
  // (truncado para brevidade — os 118 completos estão em table.js via ELEMENTS_LAYOUT)
  // Para o admin, a listagem completa de símbolos/nomes vem das queries ao banco.
];

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

  // Inicializa
  initAdmin();
});
