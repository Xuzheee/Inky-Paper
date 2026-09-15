import { useEffect, useRef, useState } from 'react';
export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directives';
// The host supplies React Query. This fixture only drives the component's
// async read boundary; it makes no claim about Hermes runtime integration.
export function useQuery(options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [result, setResult] = useState({ data: undefined, error: null });
  const refetch = async () => {
    try {
      const data = await optionsRef.current.queryFn();
      const next = { data, error: null };
      setResult(next);
      return next;
    } catch (error) {
      setResult(previous => ({ ...previous, error }));
      return { error };
    }
  };
  useEffect(() => { if (options.enabled !== false) void refetch(); }, []);
  return { ...result, refetch };
}
