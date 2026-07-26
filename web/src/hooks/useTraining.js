import { useCallback, useEffect, useRef } from 'react';
import { CONFIG } from '../training.config.js';

/**
 * Hook that owns the background training Web Worker.
 *
 * It continuously runs 250-game self-play batches and calls onComplete with
 * the resulting delta after each batch. The worker is created once on mount
 * and terminated on unmount.
 */
export function useTraining(weightMap, placementMemory, onComplete, addLog) {
  const workerRef = useRef(null);
  const isTraining = useRef(false);
  const weightMapRef = useRef(weightMap);
  const placementMemoryRef = useRef(placementMemory);
  const onCompleteRef = useRef(onComplete);
  const addLogRef = useRef(addLog);

  useEffect(() => { weightMapRef.current = weightMap; }, [weightMap]);
  useEffect(() => { placementMemoryRef.current = placementMemory; }, [placementMemory]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { addLogRef.current = addLog; }, [addLog]);

  const scheduleNextTraining = useCallback((delay = CONFIG.TRAINING_DELAY_MS) => {
    if (isTraining.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    isTraining.current = true;
    if (delay === 0) {
      addLogRef.current('Starting background training immediately');
    } else {
      addLogRef.current(`Scheduling background training in ${delay}ms`);
    }

    setTimeout(() => {
      if ((typeof document !== 'undefined' && document.hidden) || !workerRef.current) {
        isTraining.current = false;
        return;
      }
      const currentWeightMap = weightMapRef.current || {};
      const currentPlacementMemory = placementMemoryRef.current || [];
      addLogRef.current(`Starting background training with ${currentPlacementMemory.length} placement patterns`);
      workerRef.current.postMessage({
        weightMap: currentWeightMap,
        placementMemory: currentPlacementMemory
      });
    }, delay);
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL('../training.worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
      const { type, delta, completed, elapsed, total, error } = event.data;

      if (type === 'progress') {
        addLogRef.current(`Training batch: ${completed}/${total} games`);
        return;
      }

      if (type === 'complete') {
        addLogRef.current(`Training complete: ${completed} games in ${elapsed?.toFixed?.(0)}ms`);
        onCompleteRef.current(delta, completed);
        isTraining.current = false;
        // Keep training continuously while the page is visible
        scheduleNextTraining(CONFIG.CONTINUOUS_INTERVAL_MS);
        return;
      }

      if (type === 'error') {
        addLogRef.current(`Training worker error: ${error}`);
        isTraining.current = false;
      }
    };

    worker.onerror = (err) => {
      addLogRef.current(`Training worker error: ${err.message || err}`);
      isTraining.current = false;
    };

    workerRef.current = worker;

    // Begin synthetic training immediately, even before the player places ships
    scheduleNextTraining(0);

    return () => worker.terminate();
  }, [scheduleNextTraining]);

  return { scheduleNextTraining, isTraining };
}
