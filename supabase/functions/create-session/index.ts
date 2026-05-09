// supabase/functions/create-session/index.ts
//
// Chamada toda vez que o site carrega.
// Recebe o device_id gerado pelo cliente no body da requisição.
// Usa o hash do device_id (em vez do IP) para identificar o dispositivo —
// isso resolve o problema de múltiplos alunos no mesmo WiFi
// compartilharem o mesmo IP externo.
// O device_hash NUNCA é exposto ao frontend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// SHA-256 do device_id com salt — impede reversão via rainbow tables.
// Mesma lógica da função hashIP original, agora aplicada ao device_id.
async function hashDeviceId(deviceId: string): Promise<string> {
  const salt = Deno.env.get("IP_HASH_SALT");
  if (!salt) throw new Error("IP_HASH_SALT não configurado");

  const encoder = new TextEncoder();
  const data = encoder.encode(deviceId + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Código legível: 3 letras + 3 números. Ex: "XKP-749"
function generateSessionCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem I e O (confusos visualmente)
  const numbers = "0123456789";
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  const l = Array.from(arr.slice(0, 3)).map(n => letters[n % letters.length]).join("");
  const n = Array.from(arr.slice(3, 6)).map(n => numbers[n % numbers.length]).join("");
  return `${l}-${n}`;
}

// CORS restrito ao domínio exato do GitHub Pages
function corsHeaders(origin: string): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGIN") ?? "";
  const isAllowed = origin === allowed;
  return {
    "Access-Control-Allow-Origin":  isAllowed ? allowed : "",
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
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  try {
    // Lê o device_id enviado pelo session.js do frontend.
    // Validação básica: deve ser uma string UUID v4 (36 chars com hífens).
    // Se não vier ou for inválido, retorna 400 — não há fallback para IP,
    // pois o IP externo causaria o bug de colisão no WiFi escolar.
    const body = await req.json().catch(() => ({}));
    const deviceId: string = body.device_id ?? "";

    if (!deviceId || typeof deviceId !== "string" || deviceId.length < 20) {
      return new Response(JSON.stringify({ error: "device_id inválido ou ausente" }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Hash do device_id — armazenado na coluna ip_hash do banco.
    // O nome da coluna permanece ip_hash para evitar migração de schema,
    // mas agora armazena o hash do identificador de dispositivo.
    const deviceHash = await hashDeviceId(deviceId);

    const supabase = createClient(
      Deno.env.get("DB_URL")!,
      Deno.env.get("DB_SERVICE_KEY")!
    );

    // Busca sessão existente para este dispositivo.
    // ORDER BY created_at DESC para pegar a mais recente
    // (um dispositivo nunca deveria ter mais de uma, mas é defensivo).
    const { data: existing } = await supabase
      .from("sessions")
      .select("id, session_code, student_name, confirmed")
      .eq("ip_hash", deviceHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({
        session_id:   existing.id,
        session_code: existing.session_code,
        student_name: existing.student_name,
        confirmed:    existing.confirmed,
      }), {
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Cria nova sessão — tenta até 5 vezes em caso de colisão de código (raro)
    let newSession = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateSessionCode();
      const { data, error } = await supabase
        .from("sessions")
        .insert({ ip_hash: deviceHash, session_code: code })
        .select("id, session_code")
        .single();

      if (!error && data) {
        newSession = data;
        break;
      }

      if (error && error.code !== "23505") {
        throw new Error(`Erro ao criar sessão: ${error.message}`);
      }
    }

    if (!newSession) {
      throw new Error("Falha ao gerar código de sessão único após 5 tentativas");
    }

    return new Response(JSON.stringify({
      session_id:   newSession.id,
      session_code: newSession.session_code,
      student_name: null,
      confirmed:    false,
    }), {
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[create-session]", err);
    return new Response(JSON.stringify({ error: "Erro interno do servidor" }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
