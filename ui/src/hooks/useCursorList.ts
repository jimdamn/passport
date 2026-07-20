import { useEffect, useRef, useState } from 'react';

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * Keyset-cursor infinite scroll: never fetches the whole list, only the next
 * page when the sentinel div scrolls into view. Re-fetches from scratch
 * whenever `deps` changes (filters/search/segment/tab).
 */
export function useCursorList<T>(fetchPage: (cursor: string | null) => Promise<CursorPage<T>>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setError(null);
    setLoading(true);
    fetchPageRef.current(null)
      .then(page => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setHasMore(!!page.next_cursor);
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMoreRef = useRef<() => void>(() => {});
  loadMoreRef.current = () => {
    if (loading || !hasMore) return;
    setLoading(true);
    fetchPageRef.current(cursor)
      .then(page => {
        setItems(prev => [...prev, ...page.items]);
        setCursor(page.next_cursor);
        setHasMore(!!page.next_cursor);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreRef.current(); },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length]);

  return { items, setItems, loading, error, hasMore, sentinelRef };
}
