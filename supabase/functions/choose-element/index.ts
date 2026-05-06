// supabase/functions/choose-element/index.ts
//
// A função mais crítica do sistema.
// Valida identidade da sessão, verifica o limite de 4 escolhas,
// e insere a escolha. A constraint UNIQUE(element_number) no banco
// garante exclusividade absoluta mesmo em race conditions simultâneos.
//
// NUNCA faça esta validação só no frontend — qualquer aluno com
// DevTools aberto poderia forjar requisições diretas ao Supabase.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin: string): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGIN") ?? "";
  return {
    "Access-Control-Allow-Origin":  origin === allowed ? allowed : "",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    return new Response(JSON.stringify({ success: false, error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  let body: { session_id?: unknown; element_number?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Body inválido" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const { session_id, element_number } = body;

  // ── Validação de tipos ─────────────────────────────────────
  if (!session_id || typeof session_id !== "string") {
    return new Response(JSON.stringify({ success: false, error: "Sessão inválida" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(session_id)) {
    return new Response(JSON.stringify({ success: false, error: "ID de sessão inválido" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // Número do elemento deve ser inteiro entre 1 e 118
  if (
    element_number === null ||
    element_number === undefined ||
    typeof element_number !== "number" ||
    !Number.isInteger(element_number) ||
    element_number < 1 ||
    element_number > 118
  ) {
    return new Response(JSON.stringify({ success: false, error: "Número de elemento inválido (deve ser 1–118)" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
  	Deno.env.get("DB_URL")!,
  	Deno.env.get("DB_SERVICE_KEY")!
);

    // ── Verifica a sessão ──────────────────────────────────
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, session_code, student_name, confirmed")
      .eq("id", session_id)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ success: false, error: "Sessão não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Nome deve estar verificado
    if (!session.student_name) {
      return new Response(JSON.stringify({ success: false, error: "Nome não verificado" }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Sessão já confirmada = bloqueada
    if (session.confirmed) {
      return new Response(JSON.stringify({ success: false, error: "Seleção já concluída e confirmada" }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // ── Verifica limite de 4 escolhas ─────────────────────
    // IMPORTANTE: esta contagem acontece NO SERVIDOR.
    // O frontend nunca é fonte de verdade para este número.
    const { count, error: countError } = await supabase
      .from("element_choices")
      .select("*", { count: "exact", head: true })
      .eq("session_id", session_id);

    if (countError) {
      throw new Error(`Erro ao contar escolhas: ${countError.message}`);
    }

    if ((count ?? 0) >= 4) {
      return new Response(JSON.stringify({
        success: false,
        error:   "Limite de 4 elementos atingido",
        code:    "LIMIT_REACHED",
      }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // ── Verifica se o elemento existe no banco ─────────────
    const { data: elementData } = await supabase
      .from("elements")
      .select("number")
      .eq("number", element_number)
      .maybeSingle();

    if (!elementData) {
      return new Response(JSON.stringify({
        success: false,
        error:   "Elemento não encontrado no banco de dados",
        code:    "ELEMENT_NOT_FOUND",
      }), {
        status: 404,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // ── Tenta inserir a escolha ────────────────────────────
    // Se o elemento já foi escolhido por outro aluno,
    // a constraint UNIQUE(element_number) retorna erro 23505.
    // Mesmo duas requisições simultâneas para o mesmo elemento:
    // apenas UMA vai passar, a outra recebe 23505.
    const { error: insertError } = await supabase
      .from("element_choices")
      .insert({
        element_number: element_number,
        session_id:     session.id,
        student_name:   session.student_name,
        session_code:   session.session_code,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        // Violação de unique constraint = elemento já escolhido
        return new Response(JSON.stringify({
          success: false,
          error:   "Este elemento já foi escolhido por outro aluno",
          code:    "ELEMENT_TAKEN",
        }), {
          status: 409, // Conflict
          headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
        });
      }

      throw new Error(`Erro ao inserir escolha: ${insertError.message}`);
    }

    // ── Retorna a contagem atualizada ──────────────────────
    const { count: newCount } = await supabase
      .from("element_choices")
      .select("*", { count: "exact", head: true })
      .eq("session_id", session_id);

    const isCompleted = (newCount ?? 0) >= 4;

    return new Response(JSON.stringify({
      success:       true,
      choices_count: newCount,
      completed:     isCompleted,
    }), {
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[choose-element]", err);
    return new Response(JSON.stringify({ success: false, error: "Erro interno do servidor" }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
