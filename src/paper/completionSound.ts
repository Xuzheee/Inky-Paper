let context: AudioContext | undefined;

// Unlock during the user's click, before waiting for the saved completion.
export async function prepareCompletionSound() {
  try {
    context ??= new AudioContext();
    await context.resume();
  } catch {
    /* Audio must never block saving a task. */
  }
}

export function scheduleCompletionChime(
  ctx: BaseAudioContext,
  wholeTask: boolean,
) {
  const master = ctx.createGain();
  master.gain.value = 0.12;
  master.connect(ctx.destination);
  const notes = wholeTask ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 783.99];
  const start = ctx.currentTime + 0.02;
  notes.forEach((frequency, index) => {
    const tone = ctx.createOscillator();
    const envelope = ctx.createGain();
    const at = start + index * 0.14;
    tone.type = "sine";
    tone.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(0.65, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
    tone.connect(envelope);
    envelope.connect(master);
    tone.start(at);
    tone.stop(at + 0.65);
    tone.onended = () => {
      tone.disconnect();
      envelope.disconnect();
    };
  });
  // The last tone ends within 1.1 seconds. Keep no persistent audio graph.
  setTimeout(() => master.disconnect(), 1500);
}

export async function playCompletionSound(wholeTask: boolean) {
  try {
    if (!context) return;
    await context.resume();
    if (context.state === "running")
      scheduleCompletionChime(context, wholeTask);
  } catch {
    /* Completion remains saved even if the audio device is unavailable. */
  }
}
