import { DEFAULT_SETTINGS } from "../electron/core/project";

// Most tests are about other things and were written for pictures that keep
// their own sound. The separate-sound behaviour has its own tests, which turn
// the setting on explicitly (test/sound.test.ts).
DEFAULT_SETTINGS.separateAudio = false;
