import { useCallback, useEffect, useRef } from 'react';

/**
 * Hook to play one-shot sound effects.
 * Keeps track of active Audio objects so they can be stopped
 * immediately when the user toggles sound off.
 */
export function useAudio(soundOn) {
  const activeAudioRef = useRef(new Set());
  const baseRef = useRef(
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
  );

  const playSound = useCallback((filename) => {
    if (!soundOn) return;
    try {
      const audio = new Audio(`${baseRef.current}${filename}`);
      activeAudioRef.current.add(audio);
      audio.onended = () => activeAudioRef.current.delete(audio);
      audio.onerror = () => activeAudioRef.current.delete(audio);
      audio.play().catch(() => activeAudioRef.current.delete(audio));
    } catch {
      // Ignore browsers/environments that do not support Audio.
    }
  }, [soundOn]);

  useEffect(() => {
    if (soundOn) return;
    activeAudioRef.current.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    activeAudioRef.current.clear();
  }, [soundOn]);

  return playSound;
}
