export function AtlasAiMark() {
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
  title = "Atlas AI",
  groundingLine = "Grounded in available governance metadata - no raw rows read",
  prompts = [],
  promptsDisabled = false,
  promptsDisabledTitle = "Atlas AI is working on the current question.",
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
          <span>
            <h2>{title}</h2>
            {groundingLine ? <em>{groundingLine}</em> : null}
          </span>
        </div>
        <span className="ga-beta-pill">Beta</span>
      </header>
      {children}
      {prompts.length ? (
        <div className="ga-ai-prompts">
          <div className="ga-ai-prompt-label">Try asking</div>
          {prompts.map((prompt) => (
            <button
              aria-disabled={promptsDisabled || undefined}
              disabled={promptsDisabled}
              key={prompt}
              onClick={() => onPromptClick?.(prompt)}
              title={promptsDisabled ? promptsDisabledTitle : undefined}
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
          title={!onMoreSuggestions ? "More suggestions are unavailable for this view." : undefined}
          type="button"
        >
          {moreLabel}
        </button>
      ) : null}
      {footer}
      <p className="ga-ai-disclaimer">
        <span>Atlas AI uses AI. Review for accuracy.</span>
        <button
          aria-label="Atlas AI accuracy notice"
          className="ga-ai-disclaimer-info"
          title="Atlas AI answers are grounded in available governance metadata and should be reviewed for accuracy."
          type="button"
        >
          i
        </button>
      </p>
    </section>
  );
}

export default AtlasAiPanel;
