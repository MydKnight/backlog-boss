import { useState, useEffect } from 'react';

/**
 * Simple fetch hook. Re-fetches whenever `url` changes.
 * @param {string} url
 * @returns {{ data: any, loading: boolean, error: string|null }}
 */
/**
 * Simple fetch hook. Pass null as url to skip fetching.
 * Re-fetches whenever `url` changes.
 */
export function useApi(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(url, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => {
        if (e.name !== 'AbortError') {
          setError(e.message);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [url]);

  return { data, loading, error };
}
