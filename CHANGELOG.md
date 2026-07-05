# Changelog

## 2026-07-03 — Podcast Narration: Smallest.ai + Multilingual Voices

### Edge Function (`supabase/functions/podcast-narrate/index.ts`)
- **Provider switch:** Replaced ElevenLabs with **Smallest.ai Waves (Lightning v3.1)** as the primary TTS provider.
  - Endpoint: `POST https://waves-api.smallest.ai/api/v1/lightning-v3.1/get_speech`
  - Auth: `Bearer $SMALLEST_API_KEY` (already configured in edge function secrets)
  - Output: MP3, 24 kHz sample rate
- **OpenAI fallback:** If Smallest.ai fails, the function automatically falls back to OpenAI TTS (`tts-1`, `api.openai.com/v1/audio/speech`) using `OPENAI_API_KEY`. Voice is deterministically mapped from the requested voice id to one of OpenAI's six voices.
- **Language normalization:** Maps the UI language label (e.g. "Hindi") to the Smallest.ai `language` code (`en`, `hi`, `ta`, `es`, or `auto` for unsupported languages).
- **Text chunking:** Truncates narration text to 3500 chars at a sentence boundary to respect API limits.
- **GET diagnostic endpoint:** Returns whether `SMALLEST_API_KEY` / `OPENAI_API_KEY` are configured (key prefix only, no secrets).
- **CORS headers** included on all responses (preflight, success, error).

### Frontend (`src/components/NotebookWorkspace.tsx`)
- **Voice catalog expanded** from 8 voices to **26 voices** — 13 languages, each with a male and female narrator:

  | Language | Female | Male |
  |---|---|---|
  | 🇺🇸 English | Sophia | Daniel |
  | 🇮🇳 Hindi | Maithili | Atharv |
  | 🇮🇳 Malayalam | Nithya | Shibi |
  | 🇮🇳 Tamil | Anitha | Raju |
  | 🇮🇳 Telugu | Padmaja | Sridhar |
  | 🇮🇳 Kannada | Chandana | Nagaraj |
  | 🇮🇳 Bengali | Soumya | Souvik |
  | 🇮🇳 Marathi | Gauri | Sanket |
  | 🇫🇷 French | Nerea | Alonso |
  | 🇩🇪 German | Freya | Freddie |
  | 🇪🇸 Spanish | Mariana | Jose |
  | 🇯🇵 Japanese | Sofia | Emiliano |
  | 🇰🇷 Korean | Camila | Fernando |

  All `voiceId` values are real Smallest.ai Lightning v3.1 voice IDs (verified via the `/get_voices` API).

- **Redesigned voice picker UI:**
  - Language selection via flag chips (13 buttons).
  - Male/Female toggle for the active language, showing the narrator name.
  - Selected-voice summary card with flag, name, gender badge, language, and style.
  - Updated provider label from "ElevenLabs" to "Smallest.ai".
- **Narration request** now sends `language` alongside `voice` so the edge function can apply correct text normalization.

### Verification
- `npm run build` passes (411 KB JS bundle).
- Live edge function tests:
  - English (`sophia`): HTTP 200, 60 KB MP3.
  - Hindi (`atharv`): HTTP 200, 65 KB MP3.

### Notes
- Lightning v2 is deprecated/retired by Smallest.ai; v3.1 is the active model.
- v3.1 only accepts language codes `en`, `hi`, `ta`, `es`, `auto`. Other languages (Malayalam, Telugu, Kannada, Bengali, Marathi, French, German, Japanese, Korean) use `auto` and rely on the voice's native accent; OpenAI TTS acts as fallback if needed.
