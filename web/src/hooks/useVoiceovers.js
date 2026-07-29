import { useCallback, useEffect, useRef } from 'react';
import { loadAudioBuffer, playBuffer } from '../audio-engine.js';

/**
 * Hook to play one random voiceover clip from the public/voiceovers folder.
 * Only one voiceover is kept active at a time; starting a new one stops the previous.
 * Playback is skipped entirely when soundOn is false.
 */
const VOICEOVER_FILES = [
  'voiceover-1.mp3',
  'voiceover-2.mp3',
  'voiceover-3.mp3',
  'voiceover-4.mp3',
  'voiceover-5.mp3',
  'voiceover-6.mp3',
  'voiceover-7.mp3',
  'voiceover-8.mp3'
];

export function useVoiceovers(soundOn) {
  const activeSourceRef = useRef(null);
  const baseRef = useRef(
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
  );

  const playVoiceover = useCallback(async () => {
    if (!soundOn) return;

    try {
      // Stop any previous voiceover before starting a new one.
      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.stop();
        } catch {
          // Already stopped or not started.
        }
        activeSourceRef.current = null;
      }

      const filename = VOICEOVER_FILES[Math.floor(Math.random() * VOICEOVER_FILES.length)];
      const buffer = await loadAudioBuffer(`${baseRef.current}voiceovers/${filename}`);
      const source = playBuffer(buffer, {
        onEnded: () => {
          if (activeSourceRef.current === source) activeSourceRef.current = null;
        }
      });
      activeSourceRef.current = source;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Voiceover playback failed:', err);
    }
  }, [soundOn]);

  useEffect(() => {
    if (soundOn) return;
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch {
        // Already stopped.
      }
      activeSourceRef.current = null;
    }
  }, [soundOn]);

  return playVoiceover;
}
