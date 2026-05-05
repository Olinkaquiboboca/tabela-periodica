# Tabela Periódica Interativa — Sistema de Sala de Aula

Site onde cada aluno escolhe exatamente 4 elementos da tabela periódica para imprimir.
Cada elemento só pode ser escolhido por um aluno (exclusividade absoluta).

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | HTML5 + CSS3 + JavaScript ES2022 puro |
| Hospedagem | GitHub Pages |
| Backend/DB | Supabase (PostgreSQL + Edge Functions + Realtime) |
| Imagens | Cloudinary |
| PDF | jsPDF (CDN) |
| Confete | canvas-confetti (CDN) |
| Auth admin | Supabase Auth |

---

## Configuração — Passo a Passo

### 1. Supabase

**a) Execute o SQL abaixo no Supabase SQL Editor:**

```sql
-- Extensões
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tabela: elements
CREATE TABLE elements (
  number        INTEGER PRIMARY KEY CHECK (number BETWEEN 1 AND 118),
  symbol        TEXT NOT NULL,
  name_pt       TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN (
    'alcali','alcalino-terroso','lantanideo','actinideo',
    'metal-transicao','metal-pos-transicao','semimetal',
    'nao-metal','halogenio','gas-nobre'
  )),
  cloudinary_url TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: students
CREATE TABLE students (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name  TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: sessions
CREATE TABLE sessions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_hash       TEXT NOT NULL,
  session_code  TEXT NOT NULL UNIQUE,
  student_name  TEXT,
  confirmed     BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela: element_choices
CREATE TABLE element_choices (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  element_number INTEGER NOT NULL REFERENCES elements(number),
  session_id     UUID NOT NULL REFERENCES sessions(id),
  student_name   TEXT NOT NULL,
  session_code   TEXT NOT NULL,
  chosen_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_element UNIQUE (element_number)
);

-- Função auxiliar para RLS
CREATE OR REPLACE FUNCTION count_choices_for_session(sid UUID)
RETURNS INTEGER LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COUNT(*)::INTEGER FROM element_choices WHERE session_id = sid;
$$;

-- Índices
CREATE INDEX idx_element_choices_session ON element_choices(session_id);
CREATE INDEX idx_element_choices_element ON element_choices(element_number);
CREATE INDEX idx_sessions_code           ON sessions(session_code);
CREATE INDEX idx_sessions_ip_hash        ON sessions(ip_hash);

-- RLS
ALTER TABLE elements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE students        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE element_choices ENABLE ROW LEVEL SECURITY;

-- Políticas
CREATE POLICY "elements_read_public"
  ON elements FOR SELECT USING (true);

CREATE POLICY "choices_read_public"
  ON element_choices FOR SELECT USING (true);

-- Policy para admin inserir alunos (substitua pelo email real)
CREATE POLICY "students_admin_insert"
  ON students FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "students_admin_select"
  ON students FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "students_admin_delete"
  ON students FOR DELETE
  USING (auth.role() = 'authenticated');
```

**b) Configure as variáveis de ambiente das Edge Functions:**

Em **Supabase > Settings > Edge Functions > Secrets**, adicione:

```
SUPABASE_URL            = https://SEU_PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJ...   (a chave longa service_role)
ALLOWED_ORIGIN          = https://SEU_USUARIO.github.io
IP_HASH_SALT            = (string aleatória ≥ 32 chars — gere com: openssl rand -base64 32)
```

**c) Faça deploy das Edge Functions:**

```bash
supabase functions deploy create-session
supabase functions deploy verify-student
supabase functions deploy choose-element
```

**d) Crie o usuário admin:**

Em **Supabase > Authentication > Users**, crie um usuário com email/senha.

### 2. Cloudinary

1. Crie uma conta em cloudinary.com
2. Crie a pasta `elementos/` e faça upload das 118 imagens
3. Use nomenclatura: `elemento_001.jpg`, `elemento_002.jpg`, etc.
4. Em **Settings > Security > Allowed fetch domains**: adicione `https://SEU_USUARIO.github.io`
5. Insira os dados no banco com o SQL:

```sql
INSERT INTO elements (number, symbol, name_pt, category, cloudinary_url) VALUES
  (1, 'H', 'Hidrogênio', 'nao-metal',
   'https://res.cloudinary.com/SEU_CLOUD/image/upload/w_800,h_800,c_fill,q_90/elementos/elemento_001.jpg'),
  -- ... repita para os 118 elementos
;
```

### 3. Frontend

**a) Edite `js/config.js`** com as credenciais do seu projeto Supabase:

```javascript
const CONFIG = {
  SUPABASE_URL:       "https://SEU_PROJETO.supabase.co",
  SUPABASE_ANON_KEY:  "eyJ...",
  EDGE_FUNCTIONS_URL: "https://SEU_PROJETO.supabase.co/functions/v1",
  CLOUDINARY_BASE:    "https://res.cloudinary.com/SEU_CLOUD/image/upload",
};
```

**b) Atualize as URLs na CSP** em `index.html` e `admin.html`:
- Substitua `SEU_PROJETO.supabase.co` pelo projeto real
- Substitua `SEU_CLOUD` pelo cloud name real

**c) Faça push para GitHub Pages:**

```bash
git init
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
git push -u origin main
```

Em **GitHub > Settings > Pages**, configure source como `main` branch.

---

## Estrutura de Arquivos

```
/
├── index.html          ← SPA principal (tabela + modais)
├── admin.html          ← Painel do professor
├── css/
│   ├── main.css        ← Estilos globais e variáveis
│   ├── table.css       ← Grid da tabela periódica
│   ├── modal.css       ← Modais de elemento e conclusão
│   └── admin.css       ← Estilos do painel admin
├── js/
│   ├── config.js       ← Chaves públicas (SOMENTE anon key)
│   ├── supabase.js     ← Inicialização do cliente
│   ├── session.js      ← Gerenciamento de sessão
│   ├── table.js        ← Renderização da tabela
│   ├── modal.js        ← Lógica do modal de elemento
│   ├── realtime.js     ← Listener de tempo real
│   ├── pdf.js          ← Geração do PDF
│   ├── app.js          ← Orquestrador principal
│   └── admin.js        ← Lógica do painel admin
└── supabase/
    └── functions/
        ├── create-session/index.ts
        ├── verify-student/index.ts
        └── choose-element/index.ts
```

---

## Checklist de Segurança Antes do Deploy

**Banco de dados:**
- [ ] RLS ativado em TODAS as 4 tabelas
- [ ] Tabela `students` sem SELECT para anon
- [ ] Tabela `sessions` sem acesso direto ao anon
- [ ] CONSTRAINT UNIQUE em `element_choices.element_number`

**Edge Functions:**
- [ ] Variáveis de ambiente configuradas no Supabase (nunca em código)
- [ ] `ALLOWED_ORIGIN` com o domínio exato do GitHub Pages
- [ ] `IP_HASH_SALT` com ≥ 32 caracteres aleatórios
- [ ] `service_role` key NUNCA no código-fonte

**Frontend:**
- [ ] `config.js` com APENAS `anon key` e URLs públicas
- [ ] CSP atualizada com os domínios corretos
- [ ] `Object.freeze(CONFIG)` presente
- [ ] Nenhum `console.log` com dados sensíveis em produção

**Cloudinary:**
- [ ] CORS configurado para o domínio exato (não `*`)
- [ ] Todas as 118 imagens carregadas

**Admin:**
- [ ] Usuário admin criado via Supabase Auth (não hardcoded)
- [ ] `admin.html` sem chaves ou senhas no código-fonte

---

## Fluxo do Aluno

1. Aluno acessa o site → sessão criada automaticamente (código gerado)
2. Clica em um elemento → modal abre
3. Digita o nome → Edge Function verifica na lista da turma
4. Nome válido → botão "Escolher" ativa
5. Clica "Escolher" → Edge Function insere no banco com validação
6. Repete até 4 elementos → botão "Concluir" ativa
7. Confirma → PDF A4 gerado no browser com as 4 imagens
