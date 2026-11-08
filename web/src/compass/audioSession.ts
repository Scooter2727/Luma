let users = 0;
let session: { type: string } | undefined;
let previous = "auto";

// Button feedback and compass beeps can overlap without resetting one another.
export function acquirePlaybackSession() {
  if (users++ === 0) {
    session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) {
      previous = session.type;
      try { session.type = "playback"; } catch {}
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--users === 0) {
      if (session?.type === "playback") {
        try { session.type = previous; } catch {}
      }
      session = undefined;
    }
  };
}
