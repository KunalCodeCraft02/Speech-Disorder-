const Joi = require('joi');

const objectId = Joi.string().hex().length(24);

const updateMe = Joi.object({
  name: Joi.string().trim().min(1).max(120),
}).min(1);

const userIdParam = Joi.object({
  id: objectId.required(),
});

const updateCalibration = Joi.object({
  baselineArticulationRate: Joi.number().min(0).required(),
  baselineArticulationRateStd: Joi.number().min(0),
  // Speech-to-pause ratio scale (speech seconds / pause seconds), not a
  // 0..1 fraction-of-time -- see dsp-service's baseline.py docstring.
  baselinePauseRatio: Joi.number().min(0).required(),
  baselinePauseRatioStd: Joi.number().min(0),
  baselineSyllableDurationSec: Joi.number().min(0),
  baselineSyllableDurationStd: Joi.number().min(0),
  baselineIpuLengthSec: Joi.number().min(0),
  baselineIpuLengthStd: Joi.number().min(0),
  isPersonal: Joi.boolean(),
  tachylaliaThreshold: Joi.number().min(0).required(),
  bradylaliaThreshold: Joi.number().min(0).required(),
}).custom((value, helpers) => {
  if (value.bradylaliaThreshold >= value.tachylaliaThreshold) {
    return helpers.message('bradylaliaThreshold must be lower than tachylaliaThreshold');
  }
  return value;
});

// ~20s of mono 16kHz PCM16 base64-encodes to ~850KB; 4MB per clip leaves
// generous headroom for a longer reading or a higher client-side sample rate.
const clip = Joi.object({
  audioBase64: Joi.string().base64().max(4 * 1024 * 1024).required(),
  sampleRate: Joi.number().integer().min(8000).max(48000),
});

// Part A.4: two short clips pooled together are preferred over one longer
// clip. `clips` (current flow) takes priority over the legacy single
// `audioBase64` when both are somehow present. At least one of the two
// shapes must be supplied.
const recordCalibration = Joi.object({
  clips: Joi.array().items(clip).min(1).max(4),
  audioBase64: Joi.string().base64().max(4 * 1024 * 1024),
  sampleRate: Joi.number().integer().min(8000).max(48000),
})
  .or('clips', 'audioBase64')
  .messages({ 'object.missing': 'Provide either "clips" (preferred) or a single "audioBase64" recording' });

module.exports = { updateMe, userIdParam, updateCalibration, recordCalibration };
