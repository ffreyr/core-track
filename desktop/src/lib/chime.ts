/**
 * A short, soft two-note chime played when a Pomodoro finishes.
 *
 * Browsers (and WKWebView) only allow audio after a user gesture, so
 * {@link primeChime} is called from the Start button click to create/resume
 * the AudioContext; {@link playChime} can then sound later without a gesture.
 * Everything fails silently if audio is unavailable.
 */

let context: AudioContext | null = null;

/** Create or resume the audio context. Call from a click handler. */
export function primeChime(): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") {
      void context.resume();
    }
  } catch {
    context = null;
  }
}

/** Play the chime (no-op if audio was never primed or is unavailable). */
export function playChime(): void {
  if (!context) {
    return;
  }
  try {
    const start = context.currentTime;
    [880, 1318.5].forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const at = start + index * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.65);
    });
  } catch {
    // Audio is a nicety; ignore failures.
  }
}
