import { useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type ReactElement } from "react";

const URL_RE = /^https?:\/\/\S+$/i;

export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  onAttach,
  attaching,
  attachError,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  disabled: boolean;
  /** Real-mode-only (plan step 5b item 3): the attach `+` button stays
   *  `disabled` (the mock preview's existing behavior, UNCHANGED) when
   *  omitted — App.tsx (the mock) never passes this. When provided, it's
   *  called with the chosen File; the caller (RealChatShell) does the
   *  actual `upload("documents/<name>")` before the next send (§ 2). */
  onAttach?: (file: File) => void;
  /** True while an attach upload is in flight — disables the attach
   *  button (no second upload can start until it resolves). */
  attaching?: boolean;
  /** A plain, candidate-facing message from the last attach attempt's
   *  failure (src/backend/upload-errors.ts) — never a raw error. */
  attachError?: string;
}): ReactElement {
  const [pastedLink, setPastedLink] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const send = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    onChange("");
    setPastedLink(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text");
    if (URL_RE.test(text.trim())) setPastedLink(text.trim());
  };

  const handleFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-choosing the same file name after a failure
    if (file && onAttach) onAttach(file);
  };

  return (
    <div className="composer">
      {pastedLink ? (
        <button
          type="button"
          className="composer-suggestion"
          onClick={() => {
            onChange(`evaluate this? ${pastedLink}`);
            setPastedLink(null);
          }}
        >
          Evaluate this? — {pastedLink}
        </button>
      ) : null}
      {attachError ? <p className="composer-attach-error">{attachError}</p> : null}
      <div className="composer-row">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx"
          className="composer-attach-input"
          onChange={handleFileChosen}
          hidden
        />
        <button
          type="button"
          className="composer-attach"
          aria-label="Attach"
          disabled={!onAttach || attaching}
          onClick={() => fileInputRef.current?.click()}
        >
          {attaching ? "…" : "+"}
        </button>
        <textarea
          className="composer-input"
          placeholder="Message Ten…"
          value={value}
          disabled={disabled}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <button type="button" className="composer-skills" disabled title="/skills">
          /skills
        </button>
        <button
          type="button"
          className="composer-send"
          onClick={send}
          disabled={disabled || !value.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
