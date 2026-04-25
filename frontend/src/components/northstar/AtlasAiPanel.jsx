function AtlasAiMark() {
  return (
    <svg aria-hidden="true" className="ga-ai-mark" viewBox="0 0 24 24" width="20" height="20" fill="none">
      <circle cx="4.5" cy="7" r="1.6" fill="currentColor" opacity="0.82" />
      <circle cx="6.8" cy="16.5" r="1.25" fill="currentColor" opacity="0.72" />
      <path
        d="m13 3 1.7 5.3L20 10l-5.3 1.7L13 17l-1.7-5.3L6 10l5.3-1.7L13 3Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m18.2 15.4.7 2 2.1.7-2.1.7-.7 2-.7-2-2.1-.7 2.1-.7.7-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function AtlasAiPanel({
  title = "Ask Atlas AI",
  prompts = [],
  promptsDisabled = false,
  onPromptClick = undefined,
  children,
  moreLabel = "",
  onMoreSuggestions = undefined,
  footer = null,
}) {
  return (
    <section className="ga-atlas-ai-panel">
      <header>
        <div>
          <AtlasAiMark />
          <h2>{title}</h2>
        </div>
        <span className="ga-beta-pill">Beta</span>
      </header>
      {children}
      {prompts.length ? (
        <div className="ga-ai-prompts">
          {prompts.map((prompt) => (
            <button
              aria-disabled={promptsDisabled || undefined}
              disabled={promptsDisabled}
              key={prompt}
              onClick={() => onPromptClick?.(prompt)}
              title={promptsDisabled ? "Atlas AI recommendations require evidence-backed chat configuration." : undefined}
              type="button"
            >
              <span>{prompt}</span>
              <span aria-hidden="true" className="ga-ai-prompt-arrow">↗</span>
            </button>
          ))}
        </div>
      ) : null}
      {moreLabel ? (
        <button
          className="ga-ai-more"
          disabled={!onMoreSuggestions}
          onClick={onMoreSuggestions}
          type="button"
        >
          {moreLabel}
        </button>
      ) : null}
      {footer}
      <p className="ga-ai-disclaimer">Atlas AI uses AI. Review for accuracy.</p>
    </section>
  );
}

export default AtlasAiPanel;
