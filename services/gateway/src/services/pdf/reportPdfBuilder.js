const PDFDocument = require('pdfkit');
const { PdfLayout, COLORS } = require('./pdfLayout');
const { CLASSIFICATION, SEVERITY } = require('../../utils/constants');

const CLASSIFICATION_LABEL = {
  [CLASSIFICATION.NORMAL]: 'Normal',
  [CLASSIFICATION.TACHYLALIA]: 'Tachylalia (rapid speech)',
  [CLASSIFICATION.BRADYLALIA]: 'Bradylalia (slow speech)',
};

const CLASSIFICATION_COLOR = {
  [CLASSIFICATION.NORMAL]: COLORS.good,
  [CLASSIFICATION.TACHYLALIA]: COLORS.critical,
  [CLASSIFICATION.BRADYLALIA]: '#2563EB',
};

const SEVERITY_LABEL = {
  [SEVERITY.NONE]: 'None',
  [SEVERITY.MILD]: 'Mild',
  [SEVERITY.MODERATE]: 'Moderate',
  [SEVERITY.SEVERE]: 'Severe',
};

function fmt(value, digits = 1, suffix = '') {
  if (value == null || Number.isNaN(value)) return null;
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fmtPercent(fraction, digits = 0) {
  if (fraction == null || Number.isNaN(fraction)) return null;
  return `${(fraction * 100).toFixed(digits)}%`;
}

function fmtDelta(percent) {
  if (percent == null || Number.isNaN(percent)) return null;
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
}

function fmtDuration(seconds) {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function fmtDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Evenly downsamples an array to at most `maxPoints` entries, preserving first/last. */
function downsample(values, maxPoints) {
  if (values.length <= maxPoints) return values;
  const step = (values.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => values[Math.round(i * step)]);
}

/**
 * Renders the full clinical session report as a PDF and resolves with its
 * Buffer. All charts are hand-drawn vector graphics (see pdfLayout.js) —
 * no canvas/rasterization dependency, so this runs anywhere Node runs.
 */
function buildSessionReportPdf({ report, user, session, analysisResult, profile, metrics }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      render(doc, { report, user, session, analysisResult, profile, metrics });
      addFooters(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function render(doc, { report, user, session, analysisResult, profile, metrics }) {
  const layout = new PdfLayout(doc);

  layout.heading('Speech Therapy Session Report', `Generated ${fmtDate(new Date())} · Speech Biofeedback System`);

  // --- Patient Details ---------------------------------------------------
  layout.sectionTitle('Patient Details');
  layout.keyValueGrid([
    ['Name', user?.name],
    ['Email', user?.email],
    ['Patient ID', user?.id || user?._id],
    ['Account created', fmtDate(user?.createdAt)],
  ]);

  // --- Session Details -----------------------------------------------------
  layout.sectionTitle('Session Details');
  layout.keyValueGrid([
    ['Session ID', session._id.toString()],
    ['Status', session.status],
    ['Started at', fmtDate(session.startedAt)],
    ['Ended at', fmtDate(session.endedAt)],
    ['Duration', fmtDuration(session.summary?.durationSec ?? analysisResult?.durationSec)],
    ['Report generated', fmtDate(report.generatedAt || new Date())],
  ]);

  // --- Speech Metrics --------------------------------------------------
  layout.sectionTitle('Speech Metrics');
  layout.table(
    ['Metric', 'Value'],
    [
      ['Avg. articulation rate', fmt(analysisResult?.avgArticulationRateSPS, 2, ' syll/s')],
      ['Avg. speech rate', fmt(analysisResult?.avgSpeechRateWPM, 0, ' WPM')],
      ['Avg. pause ratio', fmtPercent(analysisResult?.avgPauseRatio)],
      ['Avg. pitch', fmt(analysisResult?.avgPitchHz, 0, ' Hz')],
      ['Avg. loudness', fmt(analysisResult?.avgLoudnessDb, 1, ' dB')],
      ['Voice activity', fmt(analysisResult?.voiceActivityPercent, 0, '%')],
      ['Speech consistency', fmt(analysisResult?.speechConsistency, 2)],
      ['Composite score', fmt(analysisResult?.compositeScore, 0)],
      ['Classifier confidence', fmtPercent(analysisResult?.confidence)],
    ],
    [0.55, 0.45]
  );

  // --- Graphs --------------------------------------------------------------
  layout.sectionTitle('Graphs');

  const breakdown = analysisResult?.classificationBreakdown;
  if (breakdown) {
    layout.barChart(
      [
        { label: 'Normal', value: (breakdown.normalRatio || 0) * 100, color: COLORS.good },
        { label: 'Tachylalia', value: (breakdown.tachylaliaRatio || 0) * 100, color: COLORS.critical },
        { label: 'Bradylalia', value: (breakdown.bradylaliaRatio || 0) * 100, color: '#2563EB' },
      ],
      { title: 'Classification breakdown (% of session windows)' }
    );
  }

  const points = downsample(metrics, 80);
  layout.lineChart(
    points.map((m) => m.articulationRateSPS ?? null),
    { title: 'Articulation rate over session', unit: 'syllables/sec', baseline: profile?.baselineArticulationRate ?? undefined }
  );
  layout.lineChart(
    points.map((m) => (m.pauseRatio != null ? m.pauseRatio * 100 : null)),
    { title: 'Pause ratio over session', unit: '%', baseline: profile?.baselinePauseRatio != null ? profile.baselinePauseRatio * 100 : undefined }
  );

  // --- Baseline Comparison ---------------------------------------------
  layout.sectionTitle('Baseline Comparison');
  const cmp = analysisResult?.baselineComparison || {};
  layout.table(
    ['Metric', 'Your baseline', 'This session', 'Change'],
    [
      [
        'Articulation rate',
        fmt(profile?.baselineArticulationRate, 2, ' syll/s'),
        fmt(analysisResult?.avgArticulationRateSPS, 2, ' syll/s'),
        fmtDelta(cmp.articulationRateDeltaPercent),
      ],
      [
        'Pause ratio',
        fmtPercent(profile?.baselinePauseRatio),
        fmtPercent(analysisResult?.avgPauseRatio),
        fmtDelta(cmp.pauseRatioDeltaPercent),
      ],
      [
        'Speech rate',
        fmt(profile?.baselineSpeechRateWPM, 0, ' WPM'),
        fmt(analysisResult?.avgSpeechRateWPM, 0, ' WPM'),
        fmtDelta(cmp.speechRateDeltaPercent),
      ],
    ],
    [0.32, 0.24, 0.24, 0.2]
  );

  // --- Detected Condition ------------------------------------------------
  layout.sectionTitle('Detected Condition');
  const classification = analysisResult?.overallClassification || CLASSIFICATION.NORMAL;
  layout.badge(CLASSIFICATION_LABEL[classification] || classification, CLASSIFICATION_COLOR[classification] || COLORS.accent);
  layout.keyValueGrid([
    ['Severity', SEVERITY_LABEL[analysisResult?.severity] || SEVERITY_LABEL[SEVERITY.NONE]],
    ['Confidence', fmtPercent(analysisResult?.confidence) || '—'],
    ['Tachylalia events', analysisResult?.tachylaliaEvents ?? 0],
    ['Bradylalia events', analysisResult?.bradylaliaEvents ?? 0],
  ]);

  // --- Recommendations -----------------------------------------------------
  layout.sectionTitle('Recommendations');
  const recommendations = analysisResult?.recommendations?.length
    ? analysisResult.recommendations
    : ['No specific recommendations were generated for this session.'];
  recommendations.forEach((rec) => layout.paragraph(`•  ${rec}`, { marginBottom: 4 }));

  layout.gap(10);
  layout.paragraph(
    'This report is generated automatically from recorded speech metrics and is intended to support, not replace, ' +
      'evaluation by a qualified speech-language clinician.',
    { size: 8, color: COLORS.inkFaint }
  );
}

function addFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const { left, right } = { left: doc.page.margins.left, right: doc.page.width - doc.page.margins.right };
    const y = doc.page.height - doc.page.margins.bottom + 14;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.inkFaint)
      .text(`Page ${i - range.start + 1} of ${range.count}`, left, y, { width: right - left, align: 'center' });
  }
}

module.exports = { buildSessionReportPdf };
