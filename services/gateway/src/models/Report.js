const mongoose = require('mongoose');
const { REPORT_TYPE, REPORT_STATUS, REPORT_FORMAT } = require('../utils/constants');

const sharedWithSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sharedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * A clinician/system-authored, shareable write-up covering one or more
 * sessions (and their AnalysisResults) for a single patient. Drafted, then
 * finalized — finalizing fires a `report_ready` Notification to the patient
 * (see reportService.updateReport / reportService.generatePdfForSession).
 *
 * The rendered PDF is stored directly on the document (`pdf.data`), not in
 * external object storage — reports are small (a handful of pages of text
 * and vector-drawn charts, no embedded audio/video), so this stays well
 * under MongoDB's 16MB document limit while keeping the module dependency-
 * free. `pdf.data` is `select: false` so routine list/get queries never pull
 * the binary; reportService.getPdfBuffer explicitly selects it.
 */
const reportSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // the patient the report is about
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // clinician/admin/system that created it

    title: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: Object.values(REPORT_TYPE), default: REPORT_TYPE.SESSION },
    status: { type: String, enum: Object.values(REPORT_STATUS), default: REPORT_STATUS.DRAFT, index: true },
    format: { type: String, enum: Object.values(REPORT_FORMAT), default: REPORT_FORMAT.PDF },

    sessionIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Session' }], default: [] },
    analysisResultIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AnalysisResult' }], default: [] },

    periodStart: { type: Date },
    periodEnd: { type: Date },

    summary: { type: String, maxlength: 5000 },

    pdf: {
      data: { type: Buffer, select: false },
      contentType: { type: String, default: 'application/pdf' },
      size: { type: Number },
    },

    sharedWith: { type: [sharedWithSchema], default: [] },
    generatedAt: { type: Date },
  },
  { timestamps: true }
);

reportSchema.index({ userId: 1, createdAt: -1 });
reportSchema.index({ authorId: 1, createdAt: -1 });

reportSchema.pre('validate', function enforcePeriodRange(next) {
  if (this.periodStart && this.periodEnd && this.periodStart > this.periodEnd) {
    return next(new Error('periodStart must be before periodEnd'));
  }
  next();
});

module.exports = mongoose.model('Report', reportSchema);
