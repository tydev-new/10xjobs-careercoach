import { useState, type ClipboardEvent, type KeyboardEvent, type ReactElement } from "react";

const URL_RE = /^https?:\/\/\S+$/i;

export function Composer({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  disabled: boolean;
}): ReactElement {
  const [pastedLink, setPastedLink] = useState<string | null>(null);

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
      <div className="composer-row">
        <button type="button" className="composer-attach" aria-label="Attach" disabled>
          +
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
