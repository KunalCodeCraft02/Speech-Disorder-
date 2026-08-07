// Original passages (not reproductions of a copyrighted clinical text like
// the Rainbow/Grandfather passages), chosen for a phonetically varied,
// natural reading pace — roughly 20 seconds each at a conversational
// ~140-150 words/min.
//
// Part A.4: two short clips pooled together beat one longer clip -- a
// single clip understates natural variability and makes the std estimate
// unreliable, so calibration reads two independent short passages instead
// of one long one.
export const CALIBRATION_PASSAGES = [
  `The sun rose slowly over the quiet hills, casting a warm golden light across
the valley below. Birds began to sing as a gentle breeze moved through the
tall green trees. Down by the river, a small boat drifted past mossy stones,
rocking softly with every ripple.`,
  `Children laughed as they ran along the sandy path, chasing one another
toward the old wooden bridge. In the distance, a farmer waved from his field
while his dog barked happily beside him. By midday, the village square
filled with people buying fresh bread, ripe fruit, and bright flowers.`,
];

export const CALIBRATION_CLIP_DURATION_SEC = 20;
export const CALIBRATION_CLIP_COUNT = CALIBRATION_PASSAGES.length;

// Kept for any lingering references to the old single-clip constants.
export const CALIBRATION_PASSAGE = CALIBRATION_PASSAGES.join('\n\n');
export const CALIBRATION_DURATION_SEC = CALIBRATION_CLIP_DURATION_SEC;
