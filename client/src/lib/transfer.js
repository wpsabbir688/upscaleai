// One-shot file handoff from the homepage hero dropzone to the studio.
// A File object cannot live in a URL or storage, so it is held here in
// memory; a page refresh loses it and the studio's own dropzone remains.
let pending = null;

export function setPendingFile(file) {
  pending = file;
}

export function takePendingFile() {
  const f = pending;
  pending = null;
  return f;
}
