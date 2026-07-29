import { useCallback, useEffect, useRef } from 'react';
import { loadAudioBuffer, playBuffer } from '../audio-engine.js';

/**
 * Hook to play sound effects via the shared Web Audio engine.
 * Keeps track of active sources so they can be stopped when the sound toggle
 * is turned off. Playback is skipped entirely when soundOn is false.
 */
export function useAudio(soundOn) {
  const activeSourcesRef = useRef(new Set());
  const baseRef = useRef(
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
  );

  const playSound = useCallback(async (filename, volume = 1) => {
    if (!soundOn) return;

    try {
      const buffer = await loadAudioBuffer(`${baseRef.current}${filename}`);
      const source = playBuffer(buffer, {
        volume,
        onEnded: () => activeSourcesRef.current.delete(source)
      });
      activeSourcesRef.current.add(source);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Audio playback failed:', err);
    }
  }, [soundOn]);

  useEffect(() => {
    if (soundOn) return;
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch {
        // Already stopped or not started.
      }
    });
    activeSourcesRef.current.clear();
  }, [soundOn]);

  return playSound;
}
