import { DEFAULT_EXPORT, DEFAULT_SETTINGS } from "../electron/core/project";

// Most tests are about other things and were written for pictures that keep
// their own sound. The separate-sound behaviour has its own tests, which turn
// the setting on explicitly (test/sound.test.ts).
DEFAULT_SETTINGS.separateAudio = false;

// Hosted macOS runners do not expose VideoToolbox's compression session.
// Export tests exercise the same edit graph with the software encoder.
DEFAULT_EXPORT.hardware = false;
