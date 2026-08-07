const COLORS = {
  ink: '#111827',
  inkSecondary: '#374151',
  inkMuted: '#6B7280',
  inkFaint: '#9CA3AF',
  border: '#D1D5DB',
  borderFaint: '#E5E7EB',
  gridline: '#F3F4F6',
  headerBg: '#374151',
  rowAltBg: '#F9FAFB',
  accent: '#4F46E5',
  baseline: '#F59E0B',
  good: '#16A34A',
  warn: '#D97706',
  critical: '#DC2626',
};

/**
 * Manual top-down cursor over a PDFKit document. PDFKit's own text-flow
 * cursor (`doc.x`/`doc.y`) doesn't compose well with multi-column grids and
 * hand-drawn charts, so every section here tracks its own `y` and advances
 * it explicitly — `ensureSpace` is what triggers page breaks.
 */
class PdfLayout {
  constructor(doc) {
    this.doc = doc;
    this.left = doc.page.margins.left;
    this.right = doc.page.width - doc.page.margins.right;
    this.width = this.right - this.left;
    this.y = doc.page.margins.top;
  }

  ensureSpace(height) {
    const bottom = this.doc.page.height - this.doc.page.margins.bottom;
    if (this.y + height > bottom) {
      this.doc.addPage();
      this.y = this.doc.page.margins.top;
    }
  }

  gap(h = 8) {
    this.y += h;
  }

  heading(text, subtitle) {
    this.ensureSpace(subtitle ? 46 : 32);
    this.doc.font('Helvetica-Bold').fontSize(19).fillColor(COLORS.ink).text(text, this.left, this.y, { width: this.width });
    this.y = this.doc.y + 2;
    if (subtitle) {
      this.doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.inkMuted).text(subtitle, this.left, this.y, { width: this.width });
      this.y = this.doc.y;
    }
    this.y += 10;
  }

  sectionTitle(text) {
    this.ensureSpace(30);
    this.doc.font('Helvetica-Bold').fontSize(12.5).fillColor(COLORS.inkSecondary).text(text, this.left, this.y);
    this.y = this.doc.y + 4;
    this.doc.moveTo(this.left, this.y).lineTo(this.right, this.y).strokeColor(COLORS.border).lineWidth(1).stroke();
    this.y += 10;
  }

  paragraph(text, opts = {}) {
    this.ensureSpace(20);
    this.doc
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(opts.size ?? 9.5)
      .fillColor(opts.color ?? COLORS.ink)
      .text(text, this.left, this.y, { width: this.width, align: opts.align });
    this.y = this.doc.y + (opts.marginBottom ?? 6);
  }

  /** Two-column label/value grid — used for patient/session detail blocks. */
  keyValueGrid(pairs, columns = 2) {
    const colWidth = this.width / columns;
    const rowHeight = 17;
    const rows = Math.ceil(pairs.length / columns);
    this.ensureSpace(rows * rowHeight + 8);

    pairs.forEach(([label, value], i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = this.left + col * colWidth;
      const y = this.y + row * rowHeight;
      this.doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(COLORS.inkSecondary)
        .text(label, x, y, { width: colWidth * 0.46, lineBreak: false });
      this.doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLORS.ink)
        .text(value == null || value === '' ? '—' : String(value), x + colWidth * 0.48, y, {
          width: colWidth * 0.5,
          lineBreak: false,
        });
    });

    this.y += rows * rowHeight + 8;
  }

  /** headers: string[]; rows: string[][]; widths: number[] (fractions of this.width, sum to 1). */
  table(headers, rows, widths) {
    const rowHeight = 19;
    const colWidths = widths.map((w) => w * this.width);
    this.ensureSpace(rowHeight * 2);

    const drawRow = (cells, { bg, bold, color } = {}) => {
      this.ensureSpace(rowHeight);
      if (bg) this.doc.rect(this.left, this.y, this.width, rowHeight).fill(bg);
      this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(color ?? COLORS.ink);
      let x = this.left;
      cells.forEach((cell, i) => {
        this.doc.text(cell == null || cell === '' ? '—' : String(cell), x + 6, this.y + 5, {
          width: colWidths[i] - 10,
          lineBreak: false,
        });
        x += colWidths[i];
      });
      this.doc
        .moveTo(this.left, this.y + rowHeight)
        .lineTo(this.right, this.y + rowHeight)
        .strokeColor(COLORS.borderFaint)
        .lineWidth(0.75)
        .stroke();
      this.y += rowHeight;
    };

    drawRow(headers, { bg: COLORS.headerBg, bold: true, color: '#FFFFFF' });
    rows.forEach((row, i) => drawRow(row, { bg: i % 2 === 1 ? COLORS.rowAltBg : undefined }));

    this.y += 8;
  }

  /** data: [{ label, value (0-100), color }]. Renders a simple percentage bar chart. */
  barChart(data, { title, height = 90 } = {}) {
    this.ensureSpace(height + 44);
    if (title) {
      this.doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.inkSecondary).text(title, this.left, this.y);
      this.y = this.doc.y + 8;
    }

    const chartTop = this.y;
    const barGap = 18;
    const barWidth = Math.min(80, (this.width - barGap * (data.length - 1)) / data.length);
    const totalWidth = barWidth * data.length + barGap * (data.length - 1);
    let x = this.left + (this.width - totalWidth) / 2;
    const max = Math.max(1, ...data.map((d) => d.value || 0));

    data.forEach((d) => {
      const barHeight = Math.max(2, ((d.value || 0) / max) * height);
      const barY = chartTop + height - barHeight;
      this.doc.rect(x, barY, barWidth, barHeight).fill(d.color || COLORS.accent);
      this.doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(COLORS.ink)
        .text(`${Math.round(d.value || 0)}%`, x, barY - 12, { width: barWidth, align: 'center' });
      this.doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.inkMuted)
        .text(d.label, x, chartTop + height + 5, { width: barWidth, align: 'center' });
      x += barWidth + barGap;
    });

    this.doc
      .moveTo(this.left, chartTop + height)
      .lineTo(this.right, chartTop + height)
      .strokeColor(COLORS.border)
      .lineWidth(1)
      .stroke();

    this.y = chartTop + height + 24;
  }

  /** series: (number|null)[]. A single-line time-series chart with an optional dashed baseline. */
  lineChart(series, { title, unit, baseline, height = 108 } = {}) {
    this.ensureSpace(height + 42);
    if (title) {
      this.doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.inkSecondary).text(title, this.left, this.y);
      this.y = this.doc.y + 8;
    }

    const chartTop = this.y;
    const axisWidth = 30;
    const chartLeft = this.left + axisWidth;
    const chartRight = this.right;
    const values = series.filter((v) => v != null);

    if (!values.length) {
      this.doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLORS.inkFaint)
        .text('No data available for this session.', this.left, chartTop);
      this.y = chartTop + height * 0.4;
      return;
    }

    const dataMin = Math.min(...values, baseline ?? values[0]);
    const dataMax = Math.max(...values, baseline ?? values[0]);
    const pad = (dataMax - dataMin) * 0.15 || Math.abs(dataMax) * 0.1 || 1;
    const min = dataMin - pad;
    const max = dataMax + pad;
    const span = max - min || 1;

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i += 1) {
      const gy = chartTop + (height * i) / gridLines;
      const val = max - (span * i) / gridLines;
      this.doc.moveTo(chartLeft, gy).lineTo(chartRight, gy).strokeColor(COLORS.gridline).lineWidth(0.75).stroke();
      this.doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(COLORS.inkFaint)
        .text(val.toFixed(1), this.left, gy - 3, { width: axisWidth - 4, align: 'right' });
    }

    if (baseline != null) {
      const by = chartTop + height - ((baseline - min) / span) * height;
      this.doc.dash(4, { space: 3 }).moveTo(chartLeft, by).lineTo(chartRight, by).strokeColor(COLORS.baseline).lineWidth(1).stroke();
      this.doc.undash();
    }

    const stepX = series.length > 1 ? (chartRight - chartLeft) / (series.length - 1) : 0;
    let drawing = false;
    this.doc.strokeColor(COLORS.accent).lineWidth(1.5);
    series.forEach((v, i) => {
      if (v == null) {
        drawing = false;
        return;
      }
      const px = chartLeft + i * stepX;
      const py = chartTop + height - ((v - min) / span) * height;
      if (!drawing) {
        this.doc.moveTo(px, py);
        drawing = true;
      } else {
        this.doc.lineTo(px, py);
      }
    });
    this.doc.stroke();

    this.doc.moveTo(chartLeft, chartTop + height).lineTo(chartRight, chartTop + height).strokeColor(COLORS.border).lineWidth(1).stroke();

    this.y = chartTop + height + 8;
    if (unit || baseline != null) {
      const legend = [unit ? `Unit: ${unit}` : null, baseline != null ? '- - - your calibrated baseline' : null]
        .filter(Boolean)
        .join('    ');
      this.doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.inkFaint).text(legend, this.left, this.y);
      this.y = this.doc.y + 6;
    }
  }

  /** A rounded, filled pill of text — used for the detected-condition badge. */
  badge(text, color) {
    this.ensureSpace(30);
    this.doc.font('Helvetica-Bold').fontSize(11);
    const paddingX = 12;
    const textWidth = this.doc.widthOfString(text);
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = 22;
    this.doc.roundedRect(this.left, this.y, boxWidth, boxHeight, 11).fill(color);
    this.doc.fillColor('#FFFFFF').text(text, this.left + paddingX, this.y + 6);
    this.y += boxHeight + 10;
  }
}

module.exports = { PdfLayout, COLORS };
