// supabase/functions/create-session/index.ts
//
// Chamada toda vez que o site carrega.
// Lê o IP do header HTTP (NUNCA do body do cliente).
// Cria ou recupera a sessão e retorna APENAS session_id e session_code.
// O ip_hash NUNCA é exposto ao frontend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// SHA-256 do IP com salt — impede reversão via rainbow tables
async function hashIP(ip: string): Promise<string> {
  const salt = Deno.env.get("IP_HASH_SALT");
  if (!salt) throw new Error("IP_HASH_SALT não configurado");

  const encoder = new TextEncoder();
  const data = encoder.encode(ip + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Código legível: 3 letras + 3 números. Ex: "XKP-749"
// Usa crypto.getRandomValues (NUNCA Math.random para segurança)
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

  // Responde ao preflight OPTIONS do CORS
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
    // IP lido do header HTTP — NUNCA do body da requisição
    // x-forwarded-for pode ter múltiplos IPs (proxies encadeados)
    // Pega apenas o primeiro (IP real do cliente)
    const rawIP = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
      ?? req.headers.get("x-real-ip")
      ?? "unknown";

    const ipHash = await hashIP(rawIP);

    // Cliente com service_role para bypassar RLS
    // service_role NUNCA vai ao frontend — está apenas nas variáveis de ambiente
    const supabase = createClient(
  	Deno.env.get("DB_URL")!,
  	Deno.env.get("DB_SERVICE_KEY")!
);

    // Verifica se já existe sessão para este IP (mesmo dispositivo)
    // ORDER BY created_at DESC para pegar a mais recente
    const { data: existing } = await supabase
      .from("sessions")
      .select("id, session_code, student_name, confirmed")
      .eq("ip_hash", ipHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Sessão recuperada — retorna sem criar nova
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
        .insert({ ip_hash: ipHash, session_code: code })
        .select("id, session_code")
        .single();

      if (!error && data) {
        newSession = data;
        break;
      }

      // Se o erro não é de colisão de código único, propaga
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
