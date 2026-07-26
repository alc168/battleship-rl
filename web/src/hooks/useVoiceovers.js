import { useCallback, useEffect, useRef } from 'react';

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
  const activeAudioRef = useRef(null);
  const baseRef = useRef(
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
  );

  const playVoiceover = useCallback(() => {
    if (!soundOn) return;
    try {
      // Stop any previous voiceover before starting a new one.
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      }

      const filename = VOICEOVER_FILES[Math.floor(Math.random() * VOICEOVER_FILES.length)];
      const audio = new Audio(`${baseRef.current}voiceovers/${filename}`);
      activeAudioRef.current = audio;

      audio.onended = () => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
      };
      audio.onerror = () => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
      };
      audio.play().catch(() => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
      });
    } catch {
      // Ignore browsers/environments that do not support Audio.
    }
  }, [soundOn]);

  useEffect(() => {
    if (soundOn) return;
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
  }, [soundOn]);

  return playVoiceover;
}
