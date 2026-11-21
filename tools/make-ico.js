// Builds assets/app.ico from the Mac AppIcon.icns.
// Modern .icns files store their larger sizes as plain PNG blobs, and .ico files may
// embed PNGs directly (Vista+), so no image library is needed: pick the PNG entries,
// read their sizes from the IHDR chunk, and wrap them in an ICO directory.
// Usage: node tools/make-ico.js <path-to-AppIcon.icns> [out.ico]
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const out = process.argv[3] || path.join(__dirname, '..', 'assets', 'app.ico');
if (!src) { console.error('usage: node tools/make-ico.js <AppIcon.icns> [out.ico]'); process.exit(1); }

const buf = fs.readFileSync(src);
if (buf.toString('ascii', 0, 4) !== 'icns') throw new Error('not an icns file');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const pngs = new Map(); // size -> png buffer
for (let off = 8; off + 8 <= buf.length;) {
  const type = buf.toString('ascii', off, off + 4);
  const len = buf.readUInt32BE(off + 4);
  if (len < 8) break;
  const data = buf.subarray(off + 8, off + len);
  if (data.subarray(0, 8).equals(PNG_SIG)) {
    const w = data.readUInt32BE(16), h = data.readUInt32BE(20);
    console.log(`  ${type}: PNG ${w}x${h}`);
    if (w === h && !pngs.has(w)) pngs.set(w, data);
  } else {
    console.log(`  ${type}: ${len} bytes (not PNG, skipped)`);
  }
  off += len;
}

// ICO entries can describe at most 256px; Windows uses the nearest size it finds.
const sizes = [...pngs.keys()].filter(s => s <= 256).sort((a, b) => a - b);
if (!sizes.length) throw new Error('no PNG entries <=256px found in icns');

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let dataOff = 6 + dir.length;
const blobs = [];
sizes.forEach((s, i) => {
  const png = pngs.get(s);
  const e = i * 16;
  dir.writeUInt8(s === 256 ? 0 : s, e);      // 0 means 256
  dir.writeUInt8(s === 256 ? 0 : s, e + 1);
  dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(png.length, e + 8); dir.writeUInt32LE(dataOff, e + 12);
  dataOff += png.length; blobs.push(png);
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, dir, ...blobs]));
console.log(`wrote ${out} with sizes ${sizes.join(', ')}`);
