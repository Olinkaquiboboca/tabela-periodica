// supabase/functions/confirm-session/index.ts
//
// Marca uma sessão como confirmada (confirmed = true).
//
// QUANDO É CHAMADA:
// Imediatamente após o PDF ser gerado com sucesso no frontend (app.js).
// Só é possível confirmar uma sessão que:
//   1. Existe no banco
//   2. Tem exatamente 4 elementos escolhidos
//   3. Ainda não foi confirmada (idempotente: chamar duas vezes é seguro)
//
// POR QUE EDGE FUNCTION E NÃO SUPABASE CLIENT DIRETO:
// A tabela sessions tem RLS sem policy de UPDATE para anon.
// Esta função usa service_role para fazer o UPDATE com segurança,
// mas valida primeiro que a sessão realmente completou as 4 escolhas
// antes de confirmar — o frontend não é fonte de verdade.

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

  let body: { session_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Body inválido" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const { session_id } = body;

  if (!session_id || typeof session_id !== "string") {
    return new Response(JSON.stringify({ success: false, error: "session_id inválido" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(session_id)) {
    return new Response(JSON.stringify({ success: false, error: "Formato de session_id inválido" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("DB_URL")!,
      Deno.env.get("DB_SERVICE_KEY")!
    );

    // ── Verifica se a sessão existe e tem nome vinculado ───
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, student_name, confirmed")
      .eq("id", session_id)
      .single();

    if (sessionError || !session) {
      return new Response(JSON.stringify({ success: false, error: "Sessão não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Sessão já confirmada — idempotente, retorna sucesso
    // Isso evita erros se o frontend chamar duas vezes
    if (session.confirmed) {
      return new Response(JSON.stringify({ success: true, already_confirmed: true }), {
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Nome deve estar vinculado para confirmar
    if (!session.student_name) {
      return new Response(JSON.stringify({ success: false, error: "Nome não verificado" }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // ── Confirma que existem exatamente 4 escolhas ─────────
    // O frontend diz que tem 4 escolhas, mas nós verificamos
    // no servidor — nunca confiamos apenas no cliente.
    const { count, error: countError } = await supabase
      .from("element_choices")
      .select("*", { count: "exact", head: true })
      .eq("session_id", session_id);

    if (countError) {
      throw new Error(`Erro ao contar escolhas: ${countError.message}`);
    }

    if ((count ?? 0) < 4) {
      return new Response(JSON.stringify({
        success: false,
        error:   `Sessão tem apenas ${count} elemento(s) escolhido(s). São necessários 4 para confirmar.`,
      }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // ── Faz o UPDATE ───────────────────────────────────────
    const { error: updateError } = await supabase
      .from("sessions")
      .update({ confirmed: true })
      .eq("id", session_id);

    if (updateError) {
      throw new Error(`Erro ao confirmar sessão: ${updateError.message}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[confirm-session]", err);
    return new Response(JSON.stringify({ success: false, error: "Erro interno do servidor" }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
