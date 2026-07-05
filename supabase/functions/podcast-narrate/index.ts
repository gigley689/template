import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Podcast narration via Smallest.ai Waves (Lightning v3.1) text-to-speech
// Falls back to OpenAI TTS (tts-1) if Smallest.ai is unavailable.
interface NarrateRequest {
  text: string;
  voice: string; // smallest.ai voice_id (e.g. "sophia", "atharv")
  language?: string; // language code for text normalization (en, hi, ta, es, auto)
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Map our supported language labels to smallest.ai language codes.
// Lightning v3.1 only accepts: auto, en, hi, ta, es.
const LANG_CODE: Record<string, string> = {
  English: "en",
  Hindi: "hi",
  Tamil: "ta",
  Spanish: "es",
  Malayalam: "auto",
  Telugu: "auto",
  Kannada: "auto",
  Bengali: "auto",
  Marathi: "auto",
  French: "auto",
  German: "auto",
  Japanese: "auto",
  Korean: "auto",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Diagnostic endpoint
  if (req.method === "GET") {
    const smallestKey = Deno.env.get("SMALLEST_API_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    return new Response(
      JSON.stringify({
        configured: Boolean(smallestKey),
        smallest: smallestKey ? { keyPrefix: smallestKey.substring(0, 6) + "..." } : null,
        openai: openaiKey ? { keyPrefix: openaiKey.substring(0, 6) + "..." } : null,
        provider: "smallest.ai (Lightning v3.1)",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { text, voice, language } = await req.json() as NarrateRequest;

    console.log("=== Podcast Narration Request ===");
    console.log("Voice:", voice, "| Language:", language || "auto");
    console.log("Text length:", text?.length || 0);

    if (!text || !text.trim()) {
      return new Response(
        JSON.stringify({ error: "Text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const smallestKey = Deno.env.get("SMALLEST_API_KEY");
    if (!smallestKey) {
      console.error("SMALLEST_API_KEY not set");
      return new Response(
        JSON.stringify({ error: "Smallest.ai API key not configured. Please set SMALLEST_API_KEY in your edge function secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const voiceId = (voice || "sophia").trim();
    const langCode = LANG_CODE[language || ""] || "auto";
    console.log("Using voice_id:", voiceId, "| lang code:", langCode);

    // Smallest.ai has a per-request text limit; chunk long text.
    const MAX_CHARS = 3500;
    let narrationText = text.trim();
    if (narrationText.length > MAX_CHARS) {
      const truncated = narrationText.substring(0, MAX_CHARS);
      const lastSentenceEnd = Math.max(
        truncated.lastIndexOf(". "),
        truncated.lastIndexOf("! "),
        truncated.lastIndexOf("? "),
      );
      narrationText = lastSentenceEnd > MAX_CHARS * 0.5
        ? truncated.substring(0, lastSentenceEnd + 1)
        : truncated;
      console.log(`Truncated text from ${text.trim().length} to ${narrationText.length} chars`);
    }

    // Try Smallest.ai Lightning v3.1 first.
    try {
      const response = await fetch("https://waves-api.smallest.ai/api/v1/lightning-v3.1/get_speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${smallestKey}`,
        },
        body: JSON.stringify({
          text: narrationText,
          voice_id: voiceId,
          sample_rate: 24000,
          speed: 1,
          language: langCode,
          output_format: "mp3",
        }),
      });

      console.log("Smallest.ai response status:", response.status);

      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        console.log("Audio size:", audioBuffer.byteLength);
        if (audioBuffer.byteLength > 0) {
          return new Response(audioBuffer, {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
          });
        }
      }

      // Non-OK: log and fall through to OpenAI fallback.
      const errorText = await response.text();
      console.error("Smallest.ai API error:", response.status, errorText);
      throw new Error(`Smallest.ai ${response.status}: ${errorText}`);
    } catch (smallestErr) {
      console.warn("Smallest.ai failed, falling back to OpenAI TTS:", smallestErr.message);
      return await openaiFallback(narrationText, voiceId);
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate audio", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// OpenAI TTS fallback. Maps smallest voice ids to OpenAI voices (alloy/echo/fable/onyx/nova/shimmer).
async function openaiFallback(text: string, voiceId: string): Promise<Response> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(
      JSON.stringify({ error: "Both Smallest.ai and OpenAI TTS are unavailable. Set SMALLEST_API_KEY or OPENAI_API_KEY." }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Deterministic pick from the 6 OpenAI voices based on voiceId hash.
  const openaiVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
  let hash = 0;
  for (let i = 0; i < voiceId.length; i++) hash = (hash * 31 + voiceId.charCodeAt(i)) >>> 0;
  const openaiVoice = openaiVoices[hash % openaiVoices.length];

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: openaiVoice,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI TTS error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: `OpenAI TTS failed: ${response.status}`, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    console.log("OpenAI fallback audio size:", audioBuffer.byteLength);
    return new Response(audioBuffer, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
    });
  } catch (err) {
    console.error("OpenAI fallback error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to generate audio via OpenAI", details: err.message }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
