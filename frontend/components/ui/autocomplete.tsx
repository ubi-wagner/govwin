'use client';

/**
 * Autocomplete input with keyboard navigation + tab-accept.
 *
 * CMS-ready: takes a static suggestions list OR an async fetcher.
 * Pressing Tab or Enter on a highlighted suggestion accepts it.
 * Used across upload forms (agency, office, branch) and the
 * compliance tag popover (memory-suggested values).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface AutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Static suggestions — filtered client-side. */
  suggestions?: string[];
  /** Async fetcher — called on every input change (debounced 200ms). */
  fetchSuggestions?: (query: string) => Promise<string[]>;
  placeholder?: string;
  className?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  maxSuggestions?: number;
}

export const Autocomplete = forwardRef<HTMLInputElement, AutocompleteProps>(
  function Autocomplete(
    {
      value,
      onChange,
      suggestions: staticSuggestions,
      fetchSuggestions,
      placeholder,
      className = '',
      name,
      required,
      disabled,
      maxSuggestions = 8,
    },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [asyncSuggestions, setAsyncSuggestions] = useState<string[]>([]);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Merge static + async suggestions, filter by current input
    const filtered = useMemo(() => {
      const source = fetchSuggestions ? asyncSuggestions : (staticSuggestions ?? []);
      if (!value.trim()) return source.slice(0, maxSuggestions);
      const q = value.toLowerCase();
      return source
        .filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
        .slice(0, maxSuggestions);
    }, [staticSuggestions, asyncSuggestions, fetchSuggestions, value, maxSuggestions]);

    // Debounced fetch for async mode
    useEffect(() => {
      if (!fetchSuggestions) return;
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
      fetchTimer.current = setTimeout(async () => {
        try {
          const results = await fetchSuggestions(value);
          setAsyncSuggestions(results);
        } catch {
          setAsyncSuggestions([]);
        }
      }, 200);
      return () => {
        if (fetchTimer.current) clearTimeout(fetchTimer.current);
      };
    }, [fetchSuggestions, value]);

    // Close on click outside
    useEffect(() => {
      function handleClick(e: MouseEvent) {
        if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      }
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const accept = useCallback(
      (suggestion: string) => {
        onChange(suggestion);
        setOpen(false);
        setActiveIndex(-1);
      },
      [onChange],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open || filtered.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
        } else if (e.key === 'Tab' || e.key === 'Enter') {
          if (activeIndex >= 0 && activeIndex < filtered.length) {
            e.preventDefault();
            accept(filtered[activeIndex]);
          }
        } else if (e.key === 'Escape') {
          setOpen(false);
        }
      },
      [open, filtered, activeIndex, accept],
    );

    return (
      <div ref={wrapperRef} className="relative">
        <input
          ref={ref}
          type="text"
          name={name}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete="off"
          className={`w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none ${className}`}
        />
        {open && filtered.length > 0 && (
          <ul className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filtered.map((s, i) => (
              <li
                key={s}
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`px-3 py-2 text-sm cursor-pointer ${
                  i === activeIndex
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);
