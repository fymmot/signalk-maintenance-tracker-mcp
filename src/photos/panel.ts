/**
 * The photo panel, rendered inline in the conversation by Claude (MCP Apps).
 *
 * Hand-written JSON-RPC over postMessage. Load-bearing details learned while
 * building it against Claude:
 *
 *   - The handshake is `ui/initialize` with `params.appInfo`; claude.ai rejects
 *     it without that field (the spec says `clientInfo`). Both are sent.
 *   - The host sizes the frame from `ui/notifications/size-changed`; a panel
 *     that never sends one is clipped.
 *   - The sandbox CSP is `default-src 'none'`, `img-src 'self' data:`, so a
 *     `blob:` preview is silently dropped. Previews are data: URLs.
 *   - The host keeps only the last `ui/update-model-context`, so Done sends
 *     every photo in ONE update, then a `ui/message` to wake the model.
 *
 * Each photo is decoded and redrawn on a canvas before upload: that strips
 * EXIF (GPS included) and shrinks it to ~300 KB, because every byte lands in a
 * git history that never shrinks. A second, smaller copy (1024 px) goes into
 * the model's context so Claude can read a nameplate or a printed expiry date.
 *
 * In the Claude Android app (1.261104.19) a multi-select picker reports every
 * pick as cancelled, so on Android the picker takes one photo at a time.
 *
 * The upload tool is app-only (`visibility: ['app']`): the model never sees it
 * or the base64, and the iframe holds no token — the host calls the tool with
 * the connector's own auth.
 */
export const PHOTO_PANEL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Add photos</title>
<style>
  :root { color-scheme: light dark; --fg: #10233f; --bg: #fff; --line: #c9d3e0; --ok: #0a6b3d; --bad: #a3131f;
          --muted: #52627a; --accent: #1b4b8f; --on-accent: #fff; }
  @media (prefers-color-scheme: dark) { :root { --fg: #eaf0f8; --bg: #10233f; --line: #3b4d68; --ok: #6fd39b;
          --bad: #ff9a9a; --muted: #a9b7c9; --accent: #8fb4ee; --on-accent: #0b1a30; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 16px/1.5 system-ui, -apple-system, sans-serif; color: var(--fg); background: var(--bg); }
  h1 { font-size: 17px; margin: 0 0 2px; }
  p.sub { margin: 0 0 14px; color: var(--muted); font-size: 14px; }
  .vh { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); border: 0; }
  #pick { display: block; border: 2px dashed var(--line); border-radius: 12px; padding: 22px 16px; text-align: center;
          cursor: pointer; font-size: 16px; font-weight: 600; color: var(--fg); }
  #pick small { display: block; font-weight: 400; font-size: 14px; color: var(--muted); margin-top: 4px; }
  #pick:focus-within { outline: 3px solid var(--accent); outline-offset: 2px; }
  #pick.over { border-color: var(--accent); border-style: solid; }
  #pick.busy { opacity: 0.6; pointer-events: none; }
  #status { margin: 12px 0 0; font-size: 14px; }
  #status:empty { display: none; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }
  ul { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
  ul:empty { display: none; }
  li { display: flex; gap: 12px; align-items: center; border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
  li img { width: 72px; height: 54px; object-fit: cover; border-radius: 6px; flex: none; background: #8884; }
  li p { flex: 1; margin: 0; font-size: 14px; }
  button { font: inherit; cursor: pointer; min-height: 44px; }
  button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  button.remove { background: none; border: 1px solid var(--line); border-radius: 8px; color: var(--fg); font-size: 14px; padding: 6px 12px; }
  #done { margin-top: 14px; width: 100%; background: var(--accent); color: var(--on-accent); border: 0; border-radius: 10px;
          font-weight: 600; padding: 12px 18px; }
  #done[hidden] { display: none; }
</style>
</head>
<body>
<h1>Add photos</h1>
<p class="sub" id="sub">They're shrunk and their location removed before they leave this device.</p>

<label id="pick">
  <input type="file" id="file" class="vh" accept="image/*">
  <span id="pick-label">Take or choose photos</span>
  <small id="pick-hint">You can also paste or drop them here.</small>
</label>

<p id="status" role="status" aria-live="polite"></p>
<ul id="list"></ul>
<button type="button" id="done" hidden>Done</button>

<script>
(function () {
  var statusEl = document.getElementById('status');
  var listEl = document.getElementById('list');
  var pickEl = document.getElementById('pick');
  var fileEl = document.getElementById('file');
  var doneEl = document.getElementById('done');
  var subEl = document.getElementById('sub');
  var nextId = 1, pending = {}, ready = false, toolArgs = {}, items = [], busy = false;

  // The Claude Android app reports a multi-select pick as cancelled: one photo per pick there.
  var isAndroid = /Android/i.test(navigator.userAgent);
  if (isAndroid) {
    document.getElementById('pick-label').textContent = 'Take or choose a photo';
    document.getElementById('pick-hint').textContent = 'One at a time.';
  } else {
    fileEl.multiple = true;
  }

  /* Upload copy: long edge and JPEG quality, retried smaller until it fits the byte budget. */
  var STEPS = [[2000, 0.82], [1600, 0.8], [1280, 0.78]];
  var BUDGET = 450 * 1024;
  /* The copy Claude sees: enough to read a nameplate, small enough for several in one message. */
  var MODEL_EDGE = 1024, MODEL_Q = 0.8;

  function send(method, params, timeoutMs) {
    var id = nextId++;
    window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
    return new Promise(function (res, rej) {
      pending[id] = { resolve: res, reject: rej };
      setTimeout(function () { if (pending[id]) { delete pending[id]; rej({ message: 'no answer' }); } }, timeoutMs || 90000);
    });
  }
  function notify(method, params) { window.parent.postMessage({ jsonrpc: '2.0', method: method, params: params }, '*'); }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.jsonrpc !== '2.0') return;
    if (d.method === 'ui/notifications/tool-input' && d.params && d.params.arguments) toolArgs = d.params.arguments;
    // Requests from the host (teardown, ping) expect an answer.
    if (d.method && d.id != null) {
      window.parent.postMessage({ jsonrpc: '2.0', id: d.id, result: {} }, '*');
      return;
    }
    if (d.id != null && pending[d.id]) {
      var p = pending[d.id]; delete pending[d.id];
      if (d.error) p.reject(d.error); else p.resolve(d.result);
    }
  });

  var lastH = 0;
  function publishSize() {
    var h = Math.ceil(document.documentElement.scrollHeight);
    if (h !== lastH) { lastH = h; notify('ui/notifications/size-changed', { height: h }); }
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(publishSize).observe(document.documentElement);
  window.addEventListener('load', publishSize);
  setInterval(publishSize, 1200);

  function status(cls, msg) { statusEl.className = cls; statusEl.textContent = msg; publishSize(); }
  function errText(err) { return (err && err.message) || 'unknown error'; }
  function photos(n) { return n === 1 ? '1 photo' : n + ' photos'; }

  var ME = { name: 'signalk-maintenance-photos', version: '1.0.0' };
  send('ui/initialize', { protocolVersion: '2026-01-26', appInfo: ME, clientInfo: ME, capabilities: {},
                          appCapabilities: { availableDisplayModes: ['inline'] } }, 15000)
    .then(function () { notify('ui/notifications/initialized', {}); })
    // tools/call can work without a completed handshake, so stay usable either way.
    .catch(function () {})
    .then(function () { ready = true; publishSize(); });

  function loadImage(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaDataUrl(file); });
    }
    return viaDataUrl(file);
  }
  function viaDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onerror = function () { rej(new Error("Couldn't read the file.")); };
      r.onload = function () {
        var img = new Image();
        img.onload = function () { res(img); };
        img.onerror = function () { rej(new Error("This device can't open that image format. Try a JPEG.")); };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }
  function encode(img, edge, quality) {
    var w = img.width, h = img.height, scale = Math.min(1, edge / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var url = c.toDataURL('image/jpeg', quality);
    var b64 = url.slice(url.indexOf(',') + 1);
    return { b64: b64, bytes: Math.floor(b64.length * 3 / 4) };
  }
  function shrink(img) {
    var out;
    for (var i = 0; i < STEPS.length; i++) {
      out = encode(img, STEPS[i][0], STEPS[i][1]);
      if (out.bytes <= BUDGET) break;
    }
    return out;
  }

  function isImage(f) {
    return f && (/^image\\//.test(f.type) || (!f.type && /\\.(jpe?g|png|webp|gif|heic|avif)$/i.test(f.name || '')));
  }

  function setBusy(b) { busy = b; pickEl.classList.toggle('busy', b); doneEl.disabled = b; }

  function addFiles(list) {
    var files = Array.prototype.filter.call(list || [], isImage);
    if (!files.length) { status('bad', 'No photo found in that.'); return; }
    if (busy) return;
    var start = function () {
      setBusy(true);
      var before = items.length, lastError = '';
      (function next(i) {
        if (i < files.length) {
          status('', files.length === 1 ? 'Adding the photo…' : 'Adding photo ' + (i + 1) + ' of ' + files.length + '…');
          upload(files[i]).then(function () { next(i + 1); }, function (err) { lastError = errText(err); next(i + 1); });
          return;
        }
        setBusy(false);
        var added = items.length - before;
        if (added === files.length) status('', '');
        else if (added === 0) status('bad', "Couldn't add the photo. " + lastError);
        else status('bad', added + ' of ' + files.length + ' added. ' + lastError);
        render();
      })(0);
    };
    // Waits out the handshake rather than turning a quick first pick away.
    if (ready) start();
    else { status('', 'Connecting…'); var wait = setInterval(function () { if (ready) { clearInterval(wait); start(); } }, 200); }
  }

  function upload(file) {
    return loadImage(file).then(function (img) {
      var big = shrink(img);
      var small = encode(img, MODEL_EDGE, MODEL_Q);
      if (img.close) img.close();
      var takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : undefined;
      return send('tools/call', { name: 'maintenance_photo_upload', arguments: {
        content_base64: big.b64, taken_at: takenAt, note: toolArgs.note
      } }).then(function (res) {
        var sc = res && res.structuredContent;
        if (!sc || !sc.handle) {
          var said = res && res.content && res.content[0] && res.content[0].text;
          throw new Error(said || "The boat didn't store it.");
        }
        items.push({ handle: sc.handle, thumb: small.b64 });
      });
    });
  }

  function render() {
    listEl.textContent = '';
    items.forEach(function (it, i) {
      var li = document.createElement('li');
      var img = document.createElement('img');
      img.src = 'data:image/jpeg;base64,' + it.thumb;   // data:, because blob: is outside img-src
      img.alt = '';
      li.appendChild(img);
      var p = document.createElement('p'); p.textContent = 'Photo ' + (i + 1); li.appendChild(p);
      var rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'remove'; rm.textContent = 'Remove';
      rm.setAttribute('aria-label', 'Remove photo ' + (i + 1));
      rm.addEventListener('click', function () { remove(it); });
      li.appendChild(rm);
      listEl.appendChild(li);
    });
    doneEl.hidden = items.length === 0;
    doneEl.textContent = items.length === 1 ? 'Done — show it to Claude' : 'Done — show them to Claude';
    publishSize();
  }

  function remove(it) {
    send('tools/call', { name: 'maintenance_photo_discard', arguments: { handles: [it.handle] } })
      .then(function () {
        items = items.filter(function (x) { return x.handle !== it.handle; });
        render();
        status('', '');
      })
      .catch(function (err) { status('bad', "Couldn't remove it: " + errText(err) + '. Try again.'); });
  }

  doneEl.addEventListener('click', function () {
    if (!items.length) return;
    doneEl.disabled = true;
    var target = toolArgs.for ? ' for ' + toolArgs.for : '';
    var content = [{ type: 'text', text:
      'The user added ' + photos(items.length) + target + ' in the photo panel. Handles, in order: ' +
      items.map(function (i) { return i.handle; }).join(', ') + '. ' +
      'Attach them with photos: [{handle, caption}] on the write tool you use next, or with maintenance_link_photos ' +
      'for a record that already exists. Captions are a few words on what each shows. Read the photos for details ' +
      'worth recording (model, serial, expiry date), but confirm anything you infer with the user.' }];
    items.forEach(function (it) { content.push({ type: 'image', data: it.thumb, mimeType: 'image/jpeg' }); });
    send('ui/update-model-context', { content: content })
      .then(function () {
        doneEl.disabled = false;
        status('ok', 'Claude can see ' + photos(items.length) + '.');
        subEl.textContent = 'You can still add or remove photos, then press Done again.';
        notify('ui/message', { role: 'user', content: [{ type: 'text', text: 'I added the photos.' }] });
      })
      .catch(function (err) {
        doneEl.disabled = false;
        status('bad', "Couldn't show them to Claude (" + errText(err) + '). They are stored; tell Claude these handles: ' +
                      items.map(function (i) { return i.handle; }).join(', '));
      });
  });

  // Some Android hosts fire 'input' rather than 'change' after the picker; take whichever comes,
  // once per pick.
  var taken = null;
  function takeFromInput() {
    var f = fileEl.files;
    if (!f || !f.length) return;
    var sig = Array.prototype.map.call(f, function (x) { return x.name + x.size + x.lastModified; }).join('|');
    if (sig === taken) return;
    taken = sig;
    var copy = Array.prototype.slice.call(f);
    fileEl.value = '';
    addFiles(copy);
  }
  fileEl.addEventListener('change', takeFromInput);
  fileEl.addEventListener('input', takeFromInput);
  pickEl.addEventListener('dragover', function (e) { e.preventDefault(); pickEl.classList.add('over'); });
  pickEl.addEventListener('dragleave', function () { pickEl.classList.remove('over'); });
  pickEl.addEventListener('drop', function (e) { e.preventDefault(); pickEl.classList.remove('over'); addFiles(e.dataTransfer && e.dataTransfer.files); });
  document.addEventListener('paste', function (e) {
    var f = e.clipboardData && e.clipboardData.files;
    if (f && f.length) { e.preventDefault(); addFiles(f); }
  });
})();
</script>
</body>
</html>`
