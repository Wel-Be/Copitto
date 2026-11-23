(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Copitto
     ・入力文章は変数/DOMにのみ保持し、いかなるストレージにも保存しない
     ・localStorageに保存するのは「共有形式」の設定1項目のみ
     ------------------------------------------------------------------ */

  var APP = self.COPITTO || { name: 'Copitto', version: '1.0.0', company: 'Wel (Be)' };

  var SETTINGS_KEY = 'copitto.shareFormat';
  var FORMAT_APP = 'appname';
  var FORMAT_TEXT = 'textonly';
  var SHARE_PREFIX = 'Copittoで作成した文章：';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var main = $('#main');
  var ta = $('#text');
  var counter = $('#counter');
  var btnCopy = $('#btn-copy');
  var btnShare = $('#btn-share');
  var btnClear = $('#btn-clear');
  var toastEl = $('#toast');
  var confirmEl = $('#confirm');

  /* ---------- バージョン表示（一元管理） ---------- */
  $all('[data-version]').forEach(function (el) { el.textContent = 'Ver. ' + APP.version; });
  $all('[data-company]').forEach(function (el) { el.textContent = APP.company; });

  /* ---------- 共有形式の設定（localStorage） ---------- */
  function loadFormat() {
    try {
      var v = localStorage.getItem(SETTINGS_KEY);
      if (v === FORMAT_APP || v === FORMAT_TEXT) return v;
    } catch (e) { /* 保存できない環境では初期値を使う */ }
    return FORMAT_APP;
  }
  function saveFormat(v) {
    try { localStorage.setItem(SETTINGS_KEY, v); return true; }
    catch (e) { return false; }
  }

  var shareFormat = loadFormat();
  $all('input[name="shareFormat"]').forEach(function (r) {
    r.checked = (r.value === shareFormat);
    r.addEventListener('change', function () {
      if (!r.checked) return;
      shareFormat = r.value;
      saveFormat(shareFormat);
      toast('設定を保存しました');
    });
  });

  /* ---------- トースト ---------- */
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-show'); }, 2000);
  }

  /* ---------- 文字数 ---------- */
  // 改行・半角/全角スペース・タブなどの空白文字は含めない
  var segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;

  function countChars(str) {
    var s = str.replace(/\s/g, '');
    if (!s) return 0;
    // 絵文字を1文字として数える（極端に長い文章では処理を軽くする）
    if (segmenter && s.length <= 20000) {
      var n = 0;
      var it = segmenter.segment(s)[Symbol.iterator]();
      while (!it.next().done) n++;
      return n;
    }
    return Array.from(s).length;
  }

  function refresh() {
    var n = countChars(ta.value);
    counter.textContent = n.toLocaleString('ja-JP') + '文字';
    var empty = (n === 0);
    btnCopy.disabled = empty;
    btnShare.disabled = empty;
    btnClear.disabled = (ta.value.length === 0);
  }
  ta.addEventListener('input', refresh);

  /* ---------- コピー ---------- */
  function legacyCopy(text) {
    var tmp = document.createElement('textarea');
    tmp.value = text;
    tmp.setAttribute('readonly', '');
    tmp.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;';
    document.body.appendChild(tmp);
    var ok = false;
    try {
      tmp.select();
      tmp.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(tmp);
    return ok;
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch (e) { /* フォールバックへ */ }
    }
    return legacyCopy(text);
  }

  btnCopy.addEventListener('click', async function () {
    if (countChars(ta.value) === 0) return;
    var ok = false;
    try { ok = await copyText(ta.value); } catch (e) { ok = false; }
    toast(ok ? 'コピーしました' : 'コピーできませんでした');
  });

  /* ---------- 共有 ---------- */
  function buildShareText() {
    return shareFormat === FORMAT_TEXT ? ta.value : SHARE_PREFIX + '\n' + ta.value;
  }

  btnShare.addEventListener('click', async function () {
    if (countChars(ta.value) === 0) return;
    var text = buildShareText();
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ text: text }))) {
      toast('この環境では共有機能を利用できません');
      return;
    }
    try {
      await navigator.share({ text: text });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 利用者が共有をキャンセル
      toast('この環境では共有機能を利用できません');
    }
  });

  /* ---------- クリア（確認ダイアログ） ---------- */
  var confirmOpen = false;

  function openConfirm() {
    if (ta.value.length === 0) return;
    confirmOpen = true;
    confirmEl.classList.add('is-open');
    confirmEl.setAttribute('aria-hidden', 'false');
    main.inert = true;
    $('#confirm-cancel').focus();
  }
  function closeConfirm(focusText) {
    confirmOpen = false;
    confirmEl.classList.remove('is-open');
    confirmEl.setAttribute('aria-hidden', 'true');
    main.inert = false;
    if (focusText) { try { ta.focus(); } catch (e) {} }
    else { btnClear.focus(); }
  }

  btnClear.addEventListener('click', openConfirm);
  $('#confirm-cancel').addEventListener('click', function () { closeConfirm(false); });
  $('#confirm-ok').addEventListener('click', function () {
    ta.value = '';
    refresh();
    closeConfirm(true);
  });
  confirmEl.addEventListener('click', function (e) { if (e.target === confirmEl) closeConfirm(false); });

  /* ---------- 画面の重ね表示（履歴と連動） ---------- */
  var stack = [];       // 開いている画面ID（下から順）
  var openers = [];     // 各画面を開いた要素（閉じたときにフォーカスを戻す）
  var views = {};
  $all('.view').forEach(function (v) { views[v.id.replace('view-', '')] = v; });

  function render() {
    Object.keys(views).forEach(function (id) {
      var v = views[id];
      var idx = stack.indexOf(id);
      var isOpen = idx >= 0;
      var isTop = idx === stack.length - 1;
      v.classList.toggle('is-open', isOpen);
      v.style.zIndex = isOpen ? String(10 + idx) : '';
      v.inert = !(isOpen && isTop);
    });
    if (!confirmOpen) main.inert = stack.length > 0;
  }

  function openView(id, opener) {
    if (!views[id] || stack.indexOf(id) >= 0) return;
    stack.push(id);
    openers.push(opener || null);
    try { history.pushState({ d: stack.length }, ''); } catch (e) { /* 履歴が使えない環境でも画面は開く */ }
    render();
    var v = views[id];
    v.scrollTop = 0;
    var first = $('.icon-btn', v);
    if (first) first.focus({ preventScroll: true });
  }

  function popTo(depth) {
    var lastOpener = null;
    while (stack.length > depth) {
      stack.pop();
      lastOpener = openers.pop();
    }
    render();
    if (lastOpener && document.contains(lastOpener)) {
      try { lastOpener.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function back() {
    if (!stack.length) return;
    try { history.back(); } catch (e) { popTo(stack.length - 1); }
  }
  function closeAll() {
    if (!stack.length) return;
    try { history.go(-stack.length); } catch (e) { popTo(0); }
  }

  window.addEventListener('popstate', function (e) {
    var d = (e.state && typeof e.state.d === 'number') ? e.state.d : 0;
    popTo(Math.min(d, stack.length));
  });

  // 再読み込み時に古い履歴状態を持ち越さない
  try { history.replaceState({ d: 0 }, ''); } catch (e) {}

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a');
    if (!t) return;
    if (t.id === 'btn-settings') { openView('settings', t); return; }
    if (t.hasAttribute('data-open')) { openView(t.getAttribute('data-open'), t); return; }
    if (t.hasAttribute('data-back')) { back(); return; }
    if (t.hasAttribute('data-close-all')) { closeAll(); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (confirmOpen) { closeConfirm(false); return; }
    if (stack.length) back();
  });

  /* ---------- 文章を残さないための処理 ---------- */
  // 入力がある状態でページを離れる場合、ブラウザ標準の確認を出す
  // （表示文言はブラウザ側で決まり、変更できません）
  window.addEventListener('beforeunload', function (e) {
    if (ta.value.length > 0) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // 戻る・進む（bfcache）で復元された場合も、新しい空の入力画面にする
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { ta.value = ''; refresh(); }
  });

  /* ---------- 初期化 ---------- */
  ta.value = '';
  refresh();
  render();
  try { ta.focus({ preventScroll: true }); } catch (e) {}

  /* ---------- Service Worker（PWA） ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      try {
        navigator.serviceWorker.register('service-worker.js').catch(function () {});
      } catch (e) {}
    });
  }

  // 想定外のエラーでアプリ全体が止まらないようにする
  window.addEventListener('error', function () {});
  window.addEventListener('unhandledrejection', function (e) { e.preventDefault(); });
})();
