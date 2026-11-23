/* Nazeer's Motor Spares — a small PDF writer (one A4 page: text, lines and boxes).
   Uses the two built-in PDF fonts (Helvetica and Helvetica-Bold), so the file needs no font data
   and opens on every phone. Coordinates are in points from the top-left corner (A4 = 595 × 842). */
(function (root) {
  'use strict';
  // character widths (per 1000) for codes 32–255 in the Windows-1252 encoding
  const W = { r: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500], b: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556] };
  const CP1252 = { 0x20ac: 128, 0x201a: 130, 0x192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2c6: 136, 0x2030: 137, 0x160: 138, 0x2039: 139, 0x152: 140, 0x17d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2dc: 152, 0x2122: 153, 0x161: 154, 0x203a: 155, 0x153: 156, 0x17e: 158, 0x178: 159 };
  const SWAP = { 0x2212: '-', 0x2713: '', 0x2714: '', 0xa0: ' ', 0x2009: ' ', 0x202f: ' ' };

  /* text as Windows-1252 codes; anything the built-in fonts cannot show becomes '?' */
  function codes(str) {
    const out = [];
    for (const ch of String(str == null ? '' : str)) {
      const cp = ch.codePointAt(0);
      if (SWAP[cp] !== undefined) { for (const c of SWAP[cp]) out.push(c.charCodeAt(0)); continue; }
      if ((cp >= 32 && cp < 127) || (cp >= 160 && cp <= 255)) out.push(cp);
      else if (CP1252[cp]) out.push(CP1252[cp]);
      else if (cp === 10 || cp === 9) out.push(32);
      else out.push(63);
    }
    return out;
  }
  const esc = (cs) => cs.map((c) => (c === 40 || c === 41 || c === 92 ? '\\' : '') + String.fromCharCode(c)).join('');
  function rgb(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '#000000');
    const n = parseInt(m ? m[1] : '000000', 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((x) => +x.toFixed(3)).join(' ');
  }
  const f = (n) => +(+n).toFixed(2);

  function create() {
    const H = 842, ops = [];
    const width = (str, size, bold) => codes(str).reduce((a, c) => a + ((bold ? W.b : W.r)[c - 32] || 556), 0) * size / 1000;
    return {
      width,
      /* shorten text to fit a width, ending in '…' */
      fit(str, size, bold, max) {
        let s = String(str == null ? '' : str);
        if (width(s, size, bold) <= max) return s;
        while (s.length > 1 && width(s + '…', size, bold) > max) s = s.slice(0, -1);
        return s.replace(/\s+$/, '') + '…';
      },
      text(x, y, str, o) {
        o = o || {};
        const size = o.size || 10, bold = !!o.bold, cs = codes(str);
        if (!cs.length) return;
        let tx = x;
        if (o.align === 'right') tx = x - width(str, size, bold);
        else if (o.align === 'center') tx = x - width(str, size, bold) / 2;
        ops.push(`BT ${rgb(o.color)} rg /${bold ? 'F2' : 'F1'} ${f(size)} Tf ${f(tx)} ${f(H - y)} Td (${esc(cs)}) Tj ET`);
      },
      rect(x, y, w, h, color, radius) {
        ops.push(`${rgb(color)} rg`);
        if (!radius) { ops.push(`${f(x)} ${f(H - y - h)} ${f(w)} ${f(h)} re f`); return; }
        const r = Math.min(radius, w / 2, h / 2), k = r * 0.5523, X = x, Y = H - y - h;
        ops.push(`${f(X + r)} ${f(Y)} m ${f(X + w - r)} ${f(Y)} l ${f(X + w - r + k)} ${f(Y)} ${f(X + w)} ${f(Y + r - k)} ${f(X + w)} ${f(Y + r)} c `
          + `${f(X + w)} ${f(Y + h - r)} l ${f(X + w)} ${f(Y + h - r + k)} ${f(X + w - r + k)} ${f(Y + h)} ${f(X + w - r)} ${f(Y + h)} c `
          + `${f(X + r)} ${f(Y + h)} l ${f(X + r - k)} ${f(Y + h)} ${f(X)} ${f(Y + h - r + k)} ${f(X)} ${f(Y + h - r)} c `
          + `${f(X)} ${f(Y + r)} l ${f(X)} ${f(Y + r - k)} ${f(X + r - k)} ${f(Y)} ${f(X + r)} ${f(Y)} c f`);
      },
      line(x1, y1, x2, y2, color, lw, dash) {
        ops.push(`${rgb(color)} RG ${f(lw || 0.6)} w ${dash ? '[' + dash + '] 0 d' : '[] 0 d'} ${f(x1)} ${f(H - y1)} m ${f(x2)} ${f(H - y2)} l S`);
      },
      /* the finished file as bytes */
      output(title) {
        const content = ops.join('\n');
        const objs = [
          '<< /Type /Catalog /Pages 2 0 R >>',
          '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
          '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
          `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
          `<< /Title (${esc(codes(title || 'Pay slip'))}) /Producer (Nazeer's Motor Spares) >>`,
        ];
        let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
        const offs = [];
        objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
        const xref = pdf.length;
        pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
        pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        const bytes = new Uint8Array(pdf.length);
        for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 255;
        return bytes;
      },
    };
  }

  /* hand the file to the phone's share sheet (WhatsApp, Mail, Save to Files…), or download it */
  async function share(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    let file = null;
    try { file = new File([blob], filename, { type: 'application/pdf' }); } catch (e) { /* very old browser */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return 'downloaded';
  }

  root.NMSPdf = { create, share, codes };
})(typeof self !== 'undefined' ? self : this);
