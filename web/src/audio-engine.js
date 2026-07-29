/**
 * Shared Web Audio engine for the Battleship app.
 *
 * Uses a single AudioContext and an AudioBuffer cache so that sounds can be
 * played on demand, including from setTimeout callbacks where plain
 * HTMLAudioElement.play() is often blocked by browser autoplay policies.
 *
 * The AudioContext is created on the first play() call and resumed in that
 * user gesture, so it is allowed by iOS/Safari/Chrome autoplay rules.
 */

let audioContext = null;
const bufferCache = new Map();

function createAudioContext() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  return new AC();
}

export async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = createAudioContext();
    if (!audioContext) {
      throw new Error('Web Audio API not supported');
    }
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  return audioContext;
}

export async function loadAudioBuffer(url) {
  const ctx = await ensureAudioContext();

  if (bufferCache.has(url)) {
    return bufferCache.get(url);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load audio: ${url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await new Promise((resolve, reject) => {
    ctx.decodeAudioData(arrayBuffer, resolve, reject);
  });

  bufferCache.set(url, audioBuffer);
  return audioBuffer;
}

export function playBuffer(audioBuffer, { volume = 1, onEnded } = {}) {
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;

  const gainNode = audioContext.createGain();
  gainNode.gain.value = volume;

  source.connect(gainNode);
  gainNode.connect(audioContext.destination);

  source.onended = () => {
    if (onEnded) onEnded();
  };

  source.start(0);
  return source;
}
