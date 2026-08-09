import { useRef, useState, type KeyboardEvent } from 'react';
import { useEffectiveMotion } from '../../hooks/useEffectiveMotion';

/**
 * A small chip-style tag editor. Type a tag and press Enter or comma to add it;
 * Backspace on an empty field removes the last chip. Tags are kept lowercase and
 * de-duplicated so search and display stay consistent.
 */
export default function TagInput({
  value,
  onChange,
  placeholder = 'Add a tag, press Enter…',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  // The tag mid-scale-out, so it plays `.mo-chip-pop-out` before it's actually
  // dropped from `value` (M20) — same "linger, then commit" shape as
  // Timeline.tsx's `removingId`.
  const [removingTag, setRemovingTag] = useState<string | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const motion = useEffectiveMotion();

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (!tag) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };

  const removeTag = (tag: string) => {
    if (motion === 'off') {
      onChange(value.filter((t) => t !== tag));
      return;
    }
    setRemovingTag(tag);
    if (removeTimer.current) clearTimeout(removeTimer.current);
    removeTimer.current = setTimeout(() => {
      onChange(value.filter((t) => t !== tag));
      setRemovingTag(null);
    }, 160);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-surface border border-water rounded focus-within:border-terracotta">
      {value.map((tag) => (
        <span
          key={tag}
          className={`mo-chip-pop flex items-center gap-1 pl-2 pr-1 py-0.5 bg-land rounded text-xs text-ink/80 ${removingTag === tag ? 'mo-chip-pop-out' : ''}`}
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="text-ink/40 hover:text-terracotta leading-none"
            title={`Remove "${tag}"`}
            aria-label={`Remove tag ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => addTag(draft)}
        placeholder={value.length ? '' : placeholder}
        className="flex-1 min-w-[8rem] bg-transparent text-sm focus:outline-none py-0.5"
      />
    </div>
  );
}
