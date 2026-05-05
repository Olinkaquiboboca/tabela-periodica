// supabase/functions/verify-student/index.ts
//
// Verifica se um nome existe na tabela `students`.
// A tabela students tem RLS sem policy de SELECT para anon —
// o frontend NUNCA acessa ela diretamente.
// Esta função usa service_role para a consulta.
//
// Retorna apenas {valid: boolean} — nunca lista de alunos.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin: string): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGIN") ?? "";
  return {
    "Access-Control-Allow-Origin":  origin === allowed ? allowed : "",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age":       "86400",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ valid: false, error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  let body: { student_name?: unknown; session_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ valid: false, error: "Body inválido" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const { student_name, session_id } = body;

  // ── Validação de entrada ──────────────────────────────────
  if (
    !student_name ||
    typeof student_name !== "string" ||
    student_name.trim().length < 2 ||
    student_name.trim().length > 200
  ) {
    return new Response(JSON.stringify({ valid: false, error: "Nome inválido" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  if (!session_id || typeof session_id !== "string") {
    return new Response(JSON.stringify({ valid: false, error: "Sessão inválida" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // Validação básica de formato UUID
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(session_id)) {
    return new Response(JSON.stringify({ valid: false, error: "ID de sessão inválido" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
  	Deno.env.get("DB_URL")!,
  	Deno.env.get("DB_SERVICE_KEY")!
);

    // Verifica se a sessão existe e não foi confirmada ainda
    const { data: session } = await supabase
      .from("sessions")
      .select("id, confirmed, student_name")
      .eq("id", session_id)
      .single();

    if (!session) {
      return new Response(JSON.stringify({ valid: false, error: "Sessão não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Se a sessão já tem nome vinculado, retorna o nome canônico
    // (aluno recarregou a página)
    if (session.student_name) {
      return new Response(JSON.stringify({
        valid:          true,
        canonical_name: session.student_name,
      }), {
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Busca o nome na tabela students (case-insensitive)
    // ilike = case-insensitive LIKE — o .trim() normaliza espaços extras
    const normalizedInput = student_name.trim();

    const { data: student } = await supabase
      .from("students")
      .select("full_name")
      .ilike("full_name", normalizedInput)
      .maybeSingle();

    if (!student) {
      // Nome não encontrado. Mensagem neutra — não revela se o nome
      // "quase bate" ou se a lista tem outros nomes similares.
      return new Response(JSON.stringify({ valid: false }), {
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Nome válido: vincula o nome canônico à sessão
    const { error: updateError } = await supabase
      .from("sessions")
      .update({ student_name: student.full_name })
      .eq("id", session_id);

    if (updateError) {
      console.error("[verify-student] Erro ao atualizar sessão:", updateError.message);
      return new Response(JSON.stringify({ valid: false, error: "Erro ao registrar nome" }), {
        status: 500,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Retorna o nome exatamente como cadastrado pelo professor
    return new Response(JSON.stringify({
      valid:          true,
      canonical_name: student.full_name,
    }), {
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[verify-student]", err);
    return new Response(JSON.stringify({ valid: false, error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
