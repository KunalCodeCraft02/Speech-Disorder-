const User = require('../models/User');
const Profile = require('../models/Profile');
const ApiError = require('../utils/ApiError');
const dspRestClient = require('./dspRestClient');

async function getById(userId) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

async function updateMe(userId, updates) {
  const user = await getById(userId);
  Object.assign(user, updates);
  await user.save();
  return user;
}

async function getCalibration(userId) {
  const profile = await Profile.findOne({ userId });
  if (!profile || profile.baselineArticulationRate == null) {
    // A Profile document existing with no baseline is treated the same as
    // no document at all -- both mean "uncalibrated" (Part A.1).
    throw ApiError.notFound('No calibration profile found for this user');
  }
  return profile;
}

const SNAPSHOT_FIELDS = [
  'baselineArticulationRate',
  'baselineArticulationRateStd',
  'baselinePauseRatio',
  'baselinePauseRatioStd',
  'baselineSyllableDurationSec',
  'baselineSyllableDurationStd',
  'baselineIpuLengthSec',
  'baselineIpuLengthStd',
  'isPersonal',
  'tachylaliaThreshold',
  'bradylaliaThreshold',
  'baselineSpeechRateWPM',
  'baselinePitchHz',
  'baselineLoudnessDb',
  'baselinePauseDurationSec',
  'baselineSpeechRatio',
  'calibrationDurationSec',
  'calibrationSyllableCount',
  'clipCount',
];

/**
 * Appends a new calibration snapshot to `calibrationHistory` and promotes
 * it to the "active" top-level fields other code (loadCalibration,
 * getCalibration) reads. Never overwrites or drops prior history --
 * recalibrating is always additive (Part A.4: recalibration must never
 * silently overwrite history).
 */
async function appendCalibration(userId, data, source) {
  await getById(userId); // 404s if the target user doesn't exist

  const calibratedAt = new Date();
  const present = SNAPSHOT_FIELDS.filter((field) => data[field] !== undefined);
  const activeFields = Object.fromEntries(present.map((field) => [field, data[field]]));
  const snapshot = { ...activeFields, source, calibratedAt };

  const profile = await Profile.findOneAndUpdate(
    { userId },
    {
      $push: { calibrationHistory: snapshot },
      $set: { ...activeFields, calibratedAt },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return profile;
}

/** Manual/direct calibration override (PUT /:id/calibration). */
async function upsertCalibration(userId, data) {
  return appendCalibration(userId, data, 'manual');
}

/**
 * Runs the audio-driven calibration flow: sends the recording(s) to the
 * DSP service's /calibrate endpoint (dspRestClient.requestCalibration —
 * FastAPI runs the same preprocess/VAD/segment/pitch pipeline the live
 * classifier uses) and persists the result as a new snapshot in this
 * user's calibration history.
 *
 * `clips` (preferred, Part A.4: two ~20s clips pooled beats one longer
 * clip) takes priority over the legacy single `audioBase64`/`sampleRate`
 * pair when both happen to be present.
 */
async function recordCalibration(userId, { clips, audioBase64, sampleRate } = {}) {
  await getById(userId); // 404s if the target user doesn't exist

  const referenceStats = clips && clips.length ? { clips } : { audioBase64, sampleRate };
  const result = await dspRestClient.requestCalibration({ userId, referenceStats });

  return appendCalibration(userId, result, 'record');
}

module.exports = { getById, updateMe, getCalibration, upsertCalibration, recordCalibration };
