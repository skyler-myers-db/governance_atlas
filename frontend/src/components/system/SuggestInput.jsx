import { useId } from "react";

/*
 * SuggestInput — a free-text input backed by a native <datalist> of
 * suggestions. Used for owner/steward emails (real account principals) and
 * domains, so the user autofills from ground truth instead of typing a
 * fabricated value. Native datalist is deliberate: full keyboard support,
 * screen-reader announced, zero extra dependencies, and it never BLOCKS a
 * value that isn't in the list (owners can still be typed when the roster is
 * degraded — the server does the authoritative validation).
 *
 * Any extra props (placeholder, type, disabled, required, autoFocus, className,
 * inputMode…) pass straight through to the <input>.
 */
export function SuggestInput({ value, onChange, options = [], id, className = "", ...rest }) {
  const generatedId = useId();
  const listId = `${id || generatedId}-suggest`;
  const seen = new Set();
  const items = [];
  for (const option of options) {
    const label = String(option ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(label);
  }
  return (
    <>
      <input
        // Default the browser's own autofill off so it doesn't compete with the
        // datalist, but let a caller override it via ...rest when needed.
        autoComplete="off"
        {...rest}
        id={id}
        className={className}
        list={items.length ? listId : undefined}
        value={value ?? ""}
        onChange={onChange}
      />
      {items.length ? (
        <datalist id={listId}>
          {items.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

export default SuggestInput;
