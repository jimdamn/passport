/**
 * KrowdKwest mini-game tease lines - kept separate from logic so copy edits
 * never touch the reveal engine. Rotating, picked by index (kwest_minigame_plays.
 * tease_variant) so the same offer always echoes the same line if re-fetched.
 * Plain hyphens only; no odds, caps, or amounts promised (per plan Section 5/10).
 */

export const KWEST_TEASE_LINES = [
  'Want to play a game?',
  'Something glints near where you found it...',
  'The trail spirits offer you a moment of luck.',
  "A stranger's map falls at your feet. Take a look?",
  'One quick game before you go?',
];

export function teaseLine(variant: number): string {
  return KWEST_TEASE_LINES[variant % KWEST_TEASE_LINES.length];
}
