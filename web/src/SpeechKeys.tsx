import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, XCircle } from "lucide-react";
import { LumaLoader } from "./LumaLoader";

type Saved = { saved: boolean; hint: string };
type Summary = {
  available: boolean;
  gemini: Saved;
  elevenlabs: Saved;
  voice_id: string;
  default_voice_id: string;
};
type Result = { ok: boolean; message: string };
type Check = { gemini: Result; elevenlabs: Result };

const placeholder = (s: Saved) =>
  s.saved ? `Saved (${s.hint}). Paste to replace.` : "Paste key";

/**
 * Local development only: the backend answers 404 when deployed or reached from another machine,
 * and then this panel renders nothing. Keys go to the server's .env and are never read back.
 */
export function SpeechKeys({ onSaved }: { onSaved: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [gemini, setGemini] = useState("");
  const [elevenlabs, setElevenlabs] = useState("");
  const [voice, setVoice] = useState("");
  const [busy, setBusy] = useState<"" | "saving" | "checking">("");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<Check | null>(null);

  useEffect(() => {
    fetch("/api/speech/keys")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);
  if (!summary) return null;

  async function runCheck() {
    setBusy("checking");
    setError("");
    try {
      const r = await fetch("/api/speech/keys/check", { method: "POST" });
      if (!r.ok) throw new Error();
      setCheck(await r.json());
    } catch {
      setError("Could not check the keys. Is the backend running?");
    } finally {
      setBusy("");
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("saving");
    setError("");
    setCheck(null);
    try {
      const r = await fetch("/api/speech/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gemini_api_key: gemini,
          elevenlabs_api_key: elevenlabs,
          elevenlabs_voice_id: voice,
        }),
      });
      const body = await r.json();
      if (!r.ok)
        throw new Error(
          typeof body.detail === "string" ? body.detail : "Could not save.",
        );
      setSummary(body);
      setGemini("");
      setElevenlabs("");
      setVoice("");
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Could not save the keys. Is the backend running?",
      );
      setBusy("");
      return;
    }
    await runCheck();
  }

  const nothingToSave = !gemini && !elevenlabs && !voice;
  return (
    <form className="key-card" onSubmit={save} aria-labelledby="keys-heading">
      <h2 id="keys-heading">
        <KeyRound size={26} aria-hidden="true" /> AI voice keys
      </h2>
      <p className="key-note">
        For local testing. Keys are saved to this computer’s <code>.env</code>{" "}
        file by the Luma server and are never shown again or kept in the
        browser.
      </p>
      <label>
        <span>Google Gemini API key</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={gemini}
          placeholder={placeholder(summary.gemini)}
          onChange={(e) => setGemini(e.target.value)}
        />
      </label>
      <label>
        <span>ElevenLabs API key</span>
        <small>Starts with sk_. The key ID will not work.</small>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={elevenlabs}
          placeholder={placeholder(summary.elevenlabs)}
          onChange={(e) => setElevenlabs(e.target.value)}
        />
      </label>
      <details>
        <summary>ElevenLabs voice (optional)</summary>
        <label>
          <span>Voice ID</span>
          <small>
            {summary.voice_id === summary.default_voice_id
              ? "Using the default voice, George."
              : `Using voice ${summary.voice_id}.`}
          </small>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={voice}
            placeholder={summary.default_voice_id}
            onChange={(e) => setVoice(e.target.value)}
          />
        </label>
      </details>
      <div className="key-actions">
        <button type="submit" disabled={!!busy || nothingToSave}>
          {busy === "saving" ? "Saving…" : "Save keys"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={
            !!busy || (!summary.gemini.saved && !summary.elevenlabs.saved)
          }
          onClick={() => void runCheck()}
        >
          {busy === "checking" ? "Checking…" : "Check keys"}
        </button>
      </div>
      {(busy === "saving" || busy === "checking") && (
        <LumaLoader
          label={busy === "saving" ? "Saving keys…" : "Checking keys…"}
          size={72}
        />
      )}
      <div className="key-results" role={busy ? undefined : "status"}>
        {error && <p className="key-result bad">{error}</p>}
        {check &&
          (
            [
              ["Gemini", check.gemini],
              ["ElevenLabs", check.elevenlabs],
            ] as const
          ).map(([name, result]) => (
            <p
              key={name}
              className={"key-result " + (result.ok ? "ok" : "bad")}
            >
              {result.ok ? (
                <CheckCircle2 size={22} aria-hidden="true" />
              ) : (
                <XCircle size={22} aria-hidden="true" />
              )}
              <span>
                <strong>{name}:</strong> {result.message}
              </span>
            </p>
          ))}
        {check?.gemini.ok && check.elevenlabs.ok && (
          <p className="key-next">
            Both keys work. Press Test Luma voice.
          </p>
        )}
      </div>
    </form>
  );
}
