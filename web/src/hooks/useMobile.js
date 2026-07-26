import { useState, useEffect } from 'react';

/**
 * Hook that reports whether the viewport is mobile-sized.
 * Initial value is read from matchMedia to avoid a flash of desktop layout.
 */
export function useMobile(breakpoint = '768px') {
  const getInitial = () =>
    typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint})`).matches;

  const [isMobile, setIsMobile] = useState(getInitial);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint})`);
    const update = () => setIsMobile(mql.matches);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [breakpoint]);

  return isMobile;
}
