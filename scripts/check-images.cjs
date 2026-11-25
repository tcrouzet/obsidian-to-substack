const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

module.exports = (async () => {
 const bytes = (width, height) => Uint8Array.from(Buffer.from(width+'x'+height)).buffer;
 const base64 = value => Buffer.from(value).toString('base64');
 const data = (width, height, mime = 'image/png') => 'data:'+mime+';base64,'+base64(bytes(width,height));
 const dimensions = value => Buffer.from(value.split(',')[1], 'base64').toString().split('x').map(Number);
 let decoded = 0, downloads = 0, reads = 0;
 const draws = [];
 class Image {
  constructor(src = '') { this.src = src; }
  async decode() { decoded++; [this.naturalWidth,this.naturalHeight] = dimensions(this.src); if (!this.naturalWidth || !this.naturalHeight) throw Error('Invalid image'); }
  getAttribute(name) { return name === 'src' ? this.src : ''; }
 }
 const createEl = tag => {
  if (tag === 'img') return new Image();
  assert.equal(tag, 'canvas');
  return { width: 0, height: 0, getContext: () => ({ drawImage: (_image,x,y,width,height) => { assert.equal(x,0); assert.equal(y,0); draws.push([width,height]); } }),
   toDataURL(mime) { return data(this.width,this.height,mime); } };
 };
 class SubstackError extends Error {}
 const moduleForCheck = { exports: {} };
 const code = ts.transpileModule(readFileSync('plugin/images.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
 runInNewContext(code, { module: moduleForCheck, exports: moduleForCheck.exports, URL, createEl, require: name => {
  if (name === './substack') return { SubstackError };
  if (name === './i18n') return { t: key => key };
  assert.equal(name, 'obsidian');
  return { arrayBufferToBase64: base64, getLinkpath: value => value,
   requestUrl: async options => { downloads++; assert.equal(options.method,'GET'); return { status:200,headers:{'Content-Type':'image/png'},arrayBuffer:bytes(3200,2000) }; } };
 } });
 const { encodeRemoteImage, encodeImages } = moduleForCheck.exports;
 const remote = await encodeRemoteImage('https://example.test/large.png');
 assert.deepEqual(dimensions(remote), [1600,1000], 'Limit wide remote images before upload, keeping proportions');
 assert.equal(await encodeRemoteImage(data(800,600)), data(800,600), 'Never enlarge small images');
 assert.equal(await encodeRemoteImage(data(1600,1200)), data(1600,1200), 'Preserve images at the width limit');
 assert.deepEqual(dimensions(await encodeRemoteImage(data(3200,2000))), [1600,1000], 'Also limit existing data images at publication');
 assert.deepEqual(dimensions(await encodeRemoteImage(data(3200,1))), [1600,1], 'Keep a nonzero canvas height');
 await assert.rejects(encodeRemoteImage('data:image/png;base64,aW52YWxpZA=='), /imageEmbedFailed/);
 await assert.rejects(encodeRemoteImage('file:///private/image.png'), /imageEmbedFailed/);
 await assert.rejects(encodeRemoteImage('https://user:password@example.test/image.png'), /imageEmbedFailed/);
 const attachment = { path:'photos/local.jpg', name:'local.jpg', extension:'jpg' };
 const app = { metadataCache:{ getFirstLinkpathDest: link => link === 'photos/local.jpg' ? attachment : null }, vault:{
  readBinary: async () => { reads++; return bytes(4000,3000); },
  write: () => { throw Error('Never write encoded images into the vault'); }, modify: () => { throw Error('Never modify the original note'); }
 } };
 const images = [new Image('photos/local.jpg'),new Image('photos/local.jpg')];
 const before = decoded;
 await encodeImages(app,{path:'note.md'},{querySelectorAll: selector => selector === 'img' ? images : []});
 assert.deepEqual(dimensions(images[0].src),[1600,1200]);
 assert.ok(images[0].src.startsWith('data:image/jpeg;'));
 assert.equal(images[0].src,images[1].src); assert.equal(reads,1); assert.equal(decoded-before,1,'Cache duplicate local images');
 const remoteImages = [new Image('https://example.test/large.png'),new Image('https://example.test/large.png')];
 const beforeDownloads = downloads;
 await encodeImages(app,{path:'note.md'},{querySelectorAll: selector => selector === 'img' ? remoteImages : []});
 assert.equal(downloads-beforeDownloads,1,'Download a linked image once per publication');
 assert.deepEqual(dimensions(remoteImages[0].src),[1600,1000]);
 assert.ok(draws.every(([width]) => width === 1600));
 console.log('Publication images: remote/local/data sources capped at 1600px, aspect ratio, no enlargement, cache and no vault writes pass.');
})();
