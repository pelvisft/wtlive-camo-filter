// ==UserScript==
// @name         WT Live Camo Filter
// @namespace    https://live.warthunder.com/
// @version      0.9.2
// @description  Filters camouflages on the War Thunder Live camouflage feed.
// @match        https://live.warthunder.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // The site's own filters can't hide universal/anime/fictional bullshit, so
  // this does it client-side. The fun part: the feed is rendered from an XHR
  // response we have to edit before the site ever sees the damn thing.

  var STORE = 'wtlf-settings';

  var CATS = [
    {
      key: 'universal',
      label: 'Universal camos',
      short: 'Universal',
      tags: ['#universal', '#alltanks', '#all_tanks', '#all_vehicles', '#allvehicles', '#any_vehicle', '#универсальн']
    },
    {
      key: 'anime',
      label: 'Anime',
      short: 'Anime',
      tags: [
        '#anime', '#animu', '#waifu', '#weeb', '#otaku', '#manga',
        '#girls_und_panzer', '#girlsundpanzer', '#gup',
        '#kantai_collection', '#kancolle', '#azur_lane', '#azurlane',
        '#blue_archive', '#bluearchive', '#hatsune_miku', '#miku',
        '#hololive', '#touhou', '#konosuba', '#nekopara', '#senran_kagura',
        '#loli', '#lolicon', '#ecchi', '#hentai', '#ahegao'
      ]
    },
    {
      key: 'fictional',
      label: 'Fictional',
      short: 'Fictional',
      tags: [
        '#fiction', '#what_if', '#whatif', '#alternate_history', '#alt_history',
        '#fantasy', '#sci_fi', '#scifi', '#unhistorical', '#non_historical',
        '#ahistorical', '#фантастик', '#вымышлен'
      ]
    }
  ];

  var TAB_LABELS = CATS.map(function (cat) {
    return { key: cat.key, label: cat.short };
  }).concat([{ key: 'authors', label: 'Authors' }]);

  var defaults = makeDefaults();

  function makeDefaults() {
    var enabled = {};
    var tags = {};
    CATS.forEach(function (cat) {
      enabled[cat.key] = true;
      tags[cat.key] = cat.tags.slice();
    });
    return { enabled: enabled, tags: tags, authors: [] };
  }

  function readSettings() {
    var out = makeDefaults();
    var raw = localStorage.getItem(STORE);
    if (!raw) return out;

    var saved = JSON.parse(raw);
    if (saved.enabled) {
      CATS.forEach(function (cat) {
        if (typeof saved.enabled[cat.key] === 'boolean') out.enabled[cat.key] = saved.enabled[cat.key];
      });
    }
    if (saved.tags) {
      CATS.forEach(function (cat) {
        if (Array.isArray(saved.tags[cat.key])) out.tags[cat.key] = cleanTags(saved.tags[cat.key]);
      });
    }
    if (Array.isArray(saved.authors)) out.authors = cleanAuthors(saved.authors);
    return out;
  }

  function cleanTags(list) {
    var tags = list.map(function (item) {
      return String(item).trim();
    }).filter(Boolean);
    return unique(tags);
  }

  function cleanAuthors(list) {
    var authors = list.map(function (item) {
      var value = String(item).trim();
      var match = value.match(/\/user\/(\d+)/i);
      return match ? match[1] : value;
    }).filter(Boolean);
    return unique(authors);
  }

  function unique(list) {
    var seen = {};
    return list.filter(function (item) {
      var key = item.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  var settings = readSettings();
  var cache = null;
  var orderCounter = 0;
  var packNeeded = false;

  function save() {
    localStorage.setItem(STORE, JSON.stringify(settings));
    cache = null;
    packNeeded = true;
  }

  // Lowercase, strip # _ -, collapse whitespace. The site can't decide how to
  // spell anything, and apparently neither can the people writing the tags.
  function flattenText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[#_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Multi-word tags only match hashtags. Looking at you, historical Mirage post
  // that just had to say "what if" in a sentence like an absolute idiot.
  function buildTagTrap(tag) {
    var value = flattenText(tag);
    if (!value) return null;
    var body = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var tail = value.length <= 4 ? '(?=$|[^\\p{L}\\p{N}])' : '';
    return {
      pattern: new RegExp('(?:^|[^\\p{L}\\p{N}])' + body + tail, 'u'),
      tagOnly: value.indexOf(' ') !== -1
    };
  }

  function buildTagTraps() {
    if (cache) return cache;
    cache = {};
    CATS.forEach(function (cat) {
      cache[cat.key] = settings.tags[cat.key].map(buildTagTrap).filter(Boolean);
    });
    return cache;
  }

  function cardAuthor(card) {
    var link = card.querySelector('.top .left a.nickname');
    if (!link) return null;
    var match = (link.getAttribute('href') || '').match(/\/user\/(\d+)/);
    return { name: link.textContent.trim(), id: match ? match[1] : '' };
  }

  // An entry is a nickname or a numeric user ID. Pasted profile URLs get cut
  // down to the ID because people are lazy, and so are we.
  function isThisGuyBanned(card) {
    if (!settings.authors.length) return false;
    var author = cardAuthor(card);
    if (!author || !author.name) return false;
    for (var i = 0; i < settings.authors.length; i++) {
      var entry = settings.authors[i];
      if (/^\d+$/.test(entry) ? entry === author.id : flattenText(entry) === flattenText(author.name)) {
        return true;
      }
    }
    return false;
  }

  // Hashtags show up as anchor links, hidden extra text, or plain text because
  // people just type that shit wherever. Collect all of it.
  function grabHashtags(value) {
    var tokens = String(value || '').match(/#[^\s#]+/g) || [];
    return tokens.join(' ');
  }

  function collectCardTags(card) {
    var description = card.querySelector('.description');
    var nodes = card.querySelectorAll('.description a.WTL-Embed-Hashtag, .description .wtlf-extra-tags');
    var parts = [grabHashtags(description ? description.textContent : '')];
    for (var i = 0; i < nodes.length; i++) parts.push(nodes[i].textContent);
    return flattenText(parts.join(' '));
  }

  // Blocked authors win before any tag matching. If you banned someone, you
  // don't give a shit what their post is tagged.
  function shouldHideThisThing(card) {
    if (isThisGuyBanned(card)) return true;

    var text = card.__wtlfText;
    if (text === undefined) {
      var description = card.querySelector('.description');
      text = flattenText(description ? description.textContent : '');
      card.__wtlfText = text;
    }
    var tags = card.__wtlfTags;
    if (tags === undefined) {
      tags = collectCardTags(card);
      card.__wtlfTags = tags;
    }
    if (card.__wtlfDetail) {
      text += ' ' + card.__wtlfDetail;
      tags += ' ' + card.__wtlfDetailTags;
    }
    if (!text) return false;

    var all = text + ' ' + tags;
    var matchers = buildTagTraps();
    for (var i = 0; i < CATS.length; i++) {
      var cat = CATS[i];
      if (!settings.enabled[cat.key]) continue;
      var list = matchers[cat.key];
      for (var j = 0; j < list.length; j++) {
        var matcher = list[j];
        if (matcher.tagOnly ? matcher.pattern.test(tags) : matcher.pattern.test(all)) return true;
      }
    }
    return false;
  }

  var packTimer = 0;

  // Remember the order cards first showed up so repacking doesn't shuffle them
  // on every pass. Otherwise the feed twitches around like it's having a
  // fucking seizure.
  function hideTheCrap() {
    var cards = document.querySelectorAll('#feedWrapper .posts .feed_item');
    var newCards = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].__wtlfOrder == null) {
        cards[i].__wtlfOrder = ++orderCounter;
        newCards++;
      }
      cards[i].classList.toggle('wtlf-hidden', shouldHideThisThing(cards[i]));
    }
    killThePhantomMargin();
    if (newCards) packNeeded = true;
    if (packNeeded) {
      packNeeded = false;
      if (!packTimer) {
        packTimer = setTimeout(function () {
          packTimer = 0;
          repackTheDuctTape();
        }, 150);
      }
    }
  }

  // The site uses three independent flex columns and never rebalances them
  // after cards disappear. So we repack the visible ones ourselves. It's
  // masonry, but worse, and held together with duct tape and regret.
  function repackTheDuctTape() {
    var columns = [].slice.call(document.querySelectorAll('#feedWrapper .posts .gridColumn'));
    if (columns.length < 2) return;
    var cards = [].slice.call(document.querySelectorAll('#feedWrapper .posts .feed_item:not(.wtlf-hidden)'));
    if (!cards.length) return;

    cards.sort(function (a, b) { return a.__wtlfOrder - b.__wtlfOrder; });
    var heights = columns.map(function () { return 0; });

    for (var i = 0; i < cards.length; i++) {
      var target = 0;
      for (var c = 1; c < columns.length; c++) {
        if (heights[c] < heights[target]) target = c;
      }
      var card = cards[i];
      if (card.parentNode !== columns[target]) columns[target].appendChild(card);
      heights[target] += card.getBoundingClientRect().height + 15;
    }
    killThePhantomMargin();
  }

  // .feed_item + .feed_item still adds a top margin when the previous card is
  // display:none, so the first visible card in a column floats down like an
  // idiot. Kill that margin before somebody files a damn bug.
  function killThePhantomMargin() {
    var columns = document.querySelectorAll('#feedWrapper .posts .gridColumn');
    for (var c = 0; c < columns.length; c++) {
      var children = columns[c].children;
      var first = null;
      for (var i = 0; i < children.length; i++) {
        if (!children[i].classList.contains('wtlf-hidden')) {
          first = children[i];
          break;
        }
      }
      for (var j = 0; j < children.length; j++) {
        children[j].classList.toggle('wtlf-first', children[j] === first);
      }
    }
  }

  function onCamoFeed() {
    if (location.pathname.indexOf('/feed/camouflages') === 0) return true;
    return !!document.getElementById('camouflagesFeedHead') ||
           !!document.getElementById('camouflagesUnloggedHead');
  }

  // Two different head ids depending on whether you're logged in. Of course.
  // Why would the page be consistent?
  function findTheFilterRow() {
    return document.querySelector('#camouflagesFeedHead .filtersHolder') ||
           document.querySelector('#camouflagesUnloggedHead .filtersHolder') ||
           document.querySelector('#feedWrapper .headWrapper .filtersHolder');
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildTheGizmo() {
    var root = element('div', 'bDropDown filterItem');
    root.id = 'wtlf';

    root.elementInited = true;

    var placeholder = element('div', 'placeholder');
    placeholder.tabIndex = 0;
    placeholder.setAttribute('aria-haspopup', 'true');
    placeholder.setAttribute('aria-expanded', 'false');
    root.appendChild(placeholder);

    var menu = element('div', 'dropdown hidden');
    root.appendChild(menu);

    menu.appendChild(element('div', 'separator', 'Hide posts tagged'));
    CATS.forEach(function (cat) {
      var option = element('div', 'option', cat.label);
      option.setAttribute('data-cat', cat.key);
      option.setAttribute('role', 'checkbox');
      option.tabIndex = 0;
      menu.appendChild(option);
    });

    menu.appendChild(element('div', 'separator', 'Authors'));
    menu.appendChild(actionOption('authors', 'Hide authors...'));
    menu.appendChild(actionOption('unhide-authors', 'Unhide all authors'));
    menu.appendChild(actionOption('edit', 'Edit tags...'));
    menu.appendChild(actionOption('clear', 'Clear filters'));

    placeholder.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setControlOpen(!root.classList.contains('opened'));
    });

    menu.addEventListener('click', function (event) {
      var option = event.target.closest ? event.target.closest('.option') : null;
      if (!option || !menu.contains(option)) return;
      event.preventDefault();
      event.stopPropagation();
      handleOption(option);
    });

    return root;
  }

  function actionOption(action, label) {
    var option = element('div', 'option', label);
    option.setAttribute('data-action', action);
    option.tabIndex = 0;
    return option;
  }

  function setControlOpen(open) {
    var root = document.getElementById('wtlf');
    if (!root) return;
    root.classList.toggle('opened', open);
    var menu = root.querySelector('.dropdown');
    if (menu) menu.classList.toggle('hidden', !open);
    var placeholder = root.querySelector('.placeholder');
    if (placeholder) placeholder.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function handleOption(option) {
    var cat = option.getAttribute('data-cat');
    if (cat) {
      settings.enabled[cat] = !settings.enabled[cat];
      save();
      refreshTheGizmo();
      hideTheCrap();
      return;
    }

    var action = option.getAttribute('data-action');
    if (action === 'edit') {
      setControlOpen(false);
      openTheSettingsThing('universal');
    } else if (action === 'authors') {
      setControlOpen(false);
      openTheSettingsThing('authors');
    } else if (action === 'unhide-authors') {
      settings.authors = [];
      save();
      refreshTheGizmo();
      hideTheCrap();
    } else if (action === 'clear') {
      CATS.forEach(function (item) {
        settings.enabled[item.key] = false;
      });
      save();
      refreshTheGizmo();
      hideTheCrap();
    }
  }

  function refreshTheGizmo() {
    var root = document.getElementById('wtlf');
    if (!root) return;

    var active = CATS.filter(function (cat) { return settings.enabled[cat.key]; });
    var authors = settings.authors.length;
    var parts = active.map(function (cat) { return cat.short; });
    if (authors) parts.push('Authors');

    var label = 'Hide: Off';
    if (parts.length === 1) label = 'Hide: ' + parts[0];
    else if (parts.length > 1) label = 'Hide: ' + parts[0] + ' +' + (parts.length - 1);

    root.classList.toggle('active', parts.length > 0);
    var placeholder = root.querySelector('.placeholder');
    if (placeholder) {
      placeholder.textContent = label;
      placeholder.title = parts.length ? 'Hiding: ' + parts.join(', ') : 'No filters active';
    }

    var options = root.querySelectorAll('.option[data-cat]');
    for (var i = 0; i < options.length; i++) {
      var on = !!settings.enabled[options[i].getAttribute('data-cat')];
      options[i].classList.toggle('selected', on);
      options[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }

    var authorsOption = root.querySelector('.option[data-action="authors"]');
    if (authorsOption) authorsOption.textContent = authors ? 'Hidden authors (' + authors + ')...' : 'Hide authors...';

    var unhide = root.querySelector('.option[data-action="unhide-authors"]');
    if (unhide) unhide.classList.toggle('wtlf-hidden-option', authors === 0);
  }

  function closeControl() {
    setControlOpen(false);
  }

  function ensureControl() {
    var bar = findTheFilterRow();
    if (!bar) return;
    var root = document.getElementById('wtlf');
    if (root && root.parentNode === bar) {
      refreshTheGizmo();
      return;
    }
    if (root) root.parentNode.removeChild(root);
    bar.appendChild(buildTheGizmo());
    refreshTheGizmo();
  }

  // The site filters its context menu by posttype, so this has to carry
  // posttype="all" or the menu builder hides it. Stupid, but that's the site.
  function sneakInTheBanButton() {
    var cards = document.querySelectorAll('#feedWrapper .posts .feed_item');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.__wtlfAuthorItem) continue;
      var menu = card.querySelector('.top .right .post_context_menu .menu');
      if (!menu) continue;
      var author = cardAuthor(card);
      if (!author || !author.name) continue;

      var item = element('div', 'menu_item wtlf-hide-author', 'Hide this author');
      item.setAttribute('posttype', 'all');
      item.addEventListener('click', (function (hiddenAuthor) {
        return function (event) {
          event.preventDefault();
          event.stopPropagation();
          banThisGuy(hiddenAuthor);
        };
      })(author));

      var report = menu.querySelector('.menu_item.complaint');
      if (report) menu.insertBefore(item, report);
      else menu.appendChild(item);
      card.__wtlfAuthorItem = true;
    }
  }

  // We only get a nickname from the card, so the block dies if they rename.
  // Numeric IDs pasted into the authors list still work, because at least that
  // shit is stable.
  function banThisGuy(author) {
    var known = settings.authors.some(function (entry) {
      return /^\d+$/.test(entry)
        ? entry === author.id
        : flattenText(entry) === flattenText(author.name);
    });
    if (known) return;

    settings.authors.push(author.name);
    save();
    refreshTheGizmo();
    hideTheCrap();
    if (typeof window.Snackbar === 'function') window.Snackbar('Author hidden');
  }

  var editor = null;
  var editorTab = 'universal';
  var editorValues = {};

  // One textarea, four tabs, no scrolling. That's the whole settings menu and
  // I'm not building more UI for this thing.
  function buildTheSettingsThing() {
    var box = element('div', 'hidden');
    box.id = 'wtlf-editor';

    var panel = element('div', 'wtlf-panel');
    box.appendChild(panel);
    panel.appendChild(element('div', 'wtlf-title', 'Camo feed filter'));

    var close = element('div', 'wtlf-close', '\u00d7');
    close.setAttribute('role', 'button');
    close.setAttribute('aria-label', 'Close');
    close.tabIndex = 0;
    close.addEventListener('click', closeTheSettingsThing);
    panel.appendChild(close);

    var tabs = element('div', 'wtlf-tabs');
    TAB_LABELS.forEach(function (tab) {
      var button = element('div', 'wtlf-tab', tab.label);
      button.setAttribute('data-tab', tab.key);
      button.tabIndex = 0;
      button.addEventListener('click', function () {
        rememberEditorValue();
        editorTab = tab.key;
        renderEditor();
      });
      tabs.appendChild(button);
    });
    panel.appendChild(tabs);

    var input = element('textarea', 'wtlf-input');
    input.rows = 7;
    input.spellcheck = false;
    panel.appendChild(input);

    panel.appendChild(element('p', 'wtlf-note', ''));
    input.addEventListener('input', rememberEditorValue);

    var actions = element('div', 'wtlf-actions');
    var setDefaults = element('div', 'wtlf-link', 'Defaults');
    setDefaults.setAttribute('role', 'button');
    setDefaults.tabIndex = 0;
    setDefaults.addEventListener('click', restoreDefaults);

    var cancel = element('div', 'bButton outline', 'Cancel');
    cancel.setAttribute('role', 'button');
    cancel.tabIndex = 0;
    cancel.addEventListener('click', closeTheSettingsThing);

    var saveButton = element('div', 'bButton', 'Save');
    saveButton.setAttribute('role', 'button');
    saveButton.tabIndex = 0;
    saveButton.addEventListener('click', saveEditor);

    actions.appendChild(setDefaults);
    actions.appendChild(cancel);
    actions.appendChild(saveButton);
    panel.appendChild(actions);

    box.addEventListener('click', function (event) {
      if (event.target === box) closeTheSettingsThing();
    });

    return box;
  }

  function rememberEditorValue() {
    if (!editor) return;
    var input = editor.querySelector('.wtlf-input');
    if (input) editorValues[editorTab] = input.value;
  }

  function renderEditor() {
    if (!editor) return;
    var tabs = editor.querySelectorAll('.wtlf-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === editorTab);
    }
    var input = editor.querySelector('.wtlf-input');
    if (input) input.value = editorValues[editorTab] || '';
    var note = editor.querySelector('.wtlf-note');
    if (note) note.textContent = editorTab === 'authors'
      ? 'One nickname or user ID per line.'
      : 'One tag per line.';
  }

  function openTheSettingsThing(tab) {
    if (!editor) {
      editor = buildTheSettingsThing();
      document.body.appendChild(editor);
    }
    editorValues = {};
    CATS.forEach(function (cat) {
      editorValues[cat.key] = settings.tags[cat.key].join('\n');
    });
    editorValues.authors = settings.authors.join('\n');
    editorTab = tab || 'universal';
    renderEditor();
    editor.classList.remove('hidden');
    document.body.classList.add('wtlf-editor-open');
    var input = editor.querySelector('.wtlf-input');
    if (input) input.focus();
  }

  function closeTheSettingsThing() {
    if (!editor || editor.classList.contains('hidden')) return;
    editor.classList.add('hidden');
    document.body.classList.remove('wtlf-editor-open');
  }

  function restoreDefaults() {
    var fresh = makeDefaults();
    editorValues = {};
    CATS.forEach(function (cat) {
      editorValues[cat.key] = fresh.tags[cat.key].join('\n');
    });
    editorValues.authors = '';
    editorTab = 'universal';
    renderEditor();
  }

  function saveEditor() {
    rememberEditorValue();
    CATS.forEach(function (cat) {
      settings.tags[cat.key] = cleanTags(parseLines(editorValues[cat.key]));
    });
    settings.authors = cleanAuthors(parseLines(editorValues.authors));
    save();
    closeTheSettingsThing();
    refreshTheGizmo();
    hideTheCrap();
  }

  function parseLines(value) {
    return String(value || '').split(/\r?\n/).map(function (line) {
      return line.trim();
    }).filter(Boolean);
  }

  var DETAIL_STORE = 'wtlf-details';
  var details = readDetails();
  var detailPending = {};
  var detailSaveTimer = 0;

  // Cached full post text, keyed by lang_group. Otherwise every scroll page
  // re-asks the API for posts we already know everything about. Fuck that.
  function readDetails() {
    var raw = localStorage.getItem(DETAIL_STORE);
    if (!raw) return {};
    var saved = JSON.parse(raw);
    return saved && typeof saved === 'object' ? saved : {};
  }

  // localStorage has a size limit. I don't know what it is, and I don't want
  // to find out the hard way, so trim the oldest entries and hope for the best.
  function saveDetails() {
    if (detailSaveTimer) return;
    detailSaveTimer = setTimeout(function () {
      detailSaveTimer = 0;
      var keys = Object.keys(details);
      if (keys.length > 250) {
        for (var i = 0; i < keys.length - 250; i++) delete details[keys[i]];
      }
      localStorage.setItem(DETAIL_STORE, JSON.stringify(details));
    }, 800);
  }

  function slurpPostText(post) {
    var text = '';
    var tags = '';
    if (post.description) {
      var parsed = new DOMParser().parseFromString(post.description, 'text/html');
      if (parsed.body) {
        text = parsed.body.textContent;
        var anchors = parsed.body.querySelectorAll('a.WTL-Embed-Hashtag');
        var parts = [];
        for (var i = 0; i < anchors.length; i++) parts.push(anchors[i].textContent);
        parts.push(grabHashtags(text));
        tags = parts.join(' ');
      }
    }
    if (post.file && post.file.name) text += ' ' + post.file.name;
    if (post.gameItemTags && post.gameItemTags.length) tags += ' ' + post.gameItemTags.join(' ');
    return { text: flattenText(text), tags: flattenText(tags) };
  }

  function readTheSoup(html) {
    var parsed = new DOMParser().parseFromString(html || '', 'text/html');
    var body = parsed.body;
    var text = body ? body.textContent : '';
    var anchors = body ? body.querySelectorAll('a.WTL-Embed-Hashtag') : [];
    var parts = [grabHashtags(text)];
    for (var i = 0; i < anchors.length; i++) parts.push(anchors[i].textContent);
    return { text: flattenText(text), tags: flattenText(parts.join(' ')) };
  }

  // The site slaps "..." on the end when it truncates. If it's there, the good
  // tags are probably gone. Thanks, site.
  function looksTruncated(text) {
    return /(\.\.\.|…)$/.test(text);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Hidden copy. This exists purely so the matcher can see tags that the card
  // builder never received, because apparently passing data through was too
  // much to ask.
  function smuggleTagsIn(description, detail) {
    return (description || '') +
      '<span class="wtlf-extra-text" style="display:none">' + escapeHtml(detail.text) + '</span>' +
      '<span class="wtlf-extra-tags" style="display:none">' + escapeHtml(detail.tags) + '</span>';
  }

  // The post endpoint returns text/html with a JSON body, because of course it
  // does. Nothing about this is normal. Ask it nicely anyway.
  function begForPostDetails(langGroup, language) {
    if (details[langGroup]) return Promise.resolve(details[langGroup]);
    if (detailPending[langGroup]) return detailPending[langGroup];

    var promise = fetch('/api/posts/get/', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'lang_group=' + encodeURIComponent(langGroup) + '&language=' + encodeURIComponent(language || 'en')
    }).then(function (response) {
      return response.ok ? response.json() : null;
    }).then(function (post) {
      details[langGroup] = post ? slurpPostText(post) : { text: '', tags: '' };
    }).catch(function () {
      details[langGroup] = { text: '', tags: '' };
    }).then(function () {
      delete detailPending[langGroup];
      saveDetails();
      return details[langGroup];
    });

    detailPending[langGroup] = promise;
    return promise;
  }

  // The feed uses XMLHttpRequest, not fetch. If that ever changes, this
  // entire script turns into a fucking pumpkin and nobody's going to tell us.
  function hijackFeedRequests() {
    var proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!proto || proto.__wtlfPatched) return;
    proto.__wtlfPatched = true;

    var open = proto.open;
    var send = proto.send;

    proto.open = function (method, url) {
      this.__wtlfUrl = String(url || '');
      return open.apply(this, arguments);
    };

    proto.send = function (body) {
      if ((this.__wtlfUrl || '').indexOf('/api/feed/get_regular/') === -1 ||
          location.pathname.indexOf('/feed/camouflages') !== 0) {
        return send.apply(this, arguments);
      }

      var xhr = this;
      var handler = xhr.onreadystatechange;

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) {
          if (handler) handler.call(xhr);
          return;
        }
        if (xhr.__wtlfRewritten) {
          if (handler) handler.call(xhr);
          return;
        }
        xhr.__wtlfRewritten = true;
        holdTheFeedHostage(xhr, function () {
          if (handler) handler.call(xhr);
        });
      };

      return send.apply(this, arguments);
    };
  }

  // The feed truncates descriptions right before the tags, because nothing is
  // allowed to be easy. Hold the response until the post API gives us the full
  // text, then stuff the missing tags into the HTML before the site renders it.
  // Yes, this is a hack. It's also the only way to stop cards from flashing in
  // and disappearing like a fucking magic trick.
  function holdTheFeedHostage(xhr, done) {
    if (!onCamoFeed()) {
      done();
      return;
    }

    var raw = xhr.responseText;
    if (!raw || raw.charAt(0) !== '{') {
      done();
      return;
    }

    Promise.resolve().then(function () {
      var data = JSON.parse(raw);
      var list = data && data.data && data.data.list;
      if (!Array.isArray(list)) return null;

      var jobs = [];
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var parsed = readTheSoup(item.description);
        item.__wtlfCut = looksTruncated(parsed.text);
        if (item.__wtlfCut && !details[item.lang_group]) {
          jobs.push(begForPostDetails(item.lang_group, item.language));
        }
      }

      return Promise.all(jobs).then(function () {
        for (var j = 0; j < list.length; j++) {
          var entry = list[j];
          var detail = details[entry.lang_group];
          if (entry.__wtlfCut && detail && (detail.text || detail.tags)) {
            entry.description = smuggleTagsIn(entry.description, detail);
          }
          delete entry.__wtlfCut;
        }

        // Give the site back its response. It thinks it fetched a normal feed.
        // It did not. Sucker.
        var patched = JSON.stringify(data);
        Object.defineProperty(xhr, 'responseText', {
          configurable: true,
          get: function () { return patched; }
        });
        Object.defineProperty(xhr, 'response', {
          configurable: true,
          get: function () { return patched; }
        });
      });
    }).then(done, done);
  }

  function isCardCutOff(card) {
    var description = card.querySelector('.description');
    if (!description) return false;
    return /(\.\.\.|…)$/.test(description.textContent.replace(/\s+/g, ' ').trim());
  }

  function doubleCheckTheLazyFetches() {
    var cards = document.querySelectorAll('#feedWrapper .posts .feed_item');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var id = card.getAttribute('lang_group');
        if (!id) return;

        var detail = details[id];
        if (detail) {
          card.__wtlfDetail = detail.text;
          card.__wtlfDetailTags = detail.tags;
          return;
        }
        if (!isCardCutOff(card)) return;

        begForPostDetails(id, card.getAttribute('language') || 'en').then(function (loaded) {
          card.__wtlfDetail = loaded.text;
          card.__wtlfDetailTags = loaded.tags;
          packNeeded = true;
          hideTheCrap();
        });
      }(cards[i]));
    }
  }

  function refresh() {
    if (!onCamoFeed()) return;
    ensureControl();
    sneakInTheBanButton();
    hideTheCrap();
    doubleCheckTheLazyFetches();
    hideTheCrap();
  }

  var queued = null;

  function queueRefresh() {
    if (queued) return;
    queued = setTimeout(function () {
      queued = null;
      refresh();
    }, 100);
  }

  var CSS = [
    '.wtlf-hidden { display: none !important; }',
    '.wtlf-hidden-option { display: none !important; }',
    '.wtlf-first { margin-top: 0 !important; }',
    '#wtlf > .dropdown { min-width: 23rem; }',
    '#wtlf.active > .placeholder { box-shadow: inset 0 0 0 2px #839EB4, 0 1px rgba(255, 255, 255, 0.6); }',
    'body.wtlf-editor-open { overflow: hidden !important; }',
    '#wtlf-editor { position: fixed; inset: 0; z-index: 12000; display: flex; align-items: center; justify-content: center; }',
    '#wtlf-editor.hidden { display: none !important; }',
    '#wtlf-editor::before { content: ""; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); }',
    '.wtlf-panel { position: relative; width: 52rem; max-width: calc(100vw - 4rem); box-sizing: border-box; background: #FFFFFF; color: #353535; border-radius: 2px; box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.5); padding: 2rem 2.4rem; font-family: "Roboto", sans-serif; font-size: 1.75rem; line-height: 2.4rem; }',
    '.wtlf-title { font-size: 2.2rem; line-height: 3rem; font-weight: 500; padding-right: 3rem; }',
    '.wtlf-close { position: absolute; top: 1.4rem; right: 1.8rem; width: 3rem; height: 3rem; color: rgba(0, 0, 0, 0.54); font-size: 3rem; line-height: 3rem; text-align: center; cursor: pointer; }',
    '.wtlf-close:hover { color: #000000; }',
    '.wtlf-tabs { display: flex; gap: 1.6rem; margin-top: 1.4rem; border-bottom: 1px solid rgba(0, 0, 0, 0.15); }',
    '.wtlf-tab { padding: 0 0 0.8rem; margin-bottom: -1px; border-bottom: 2px solid transparent; font-size: 1.3rem; line-height: 2rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(0, 0, 0, 0.54); cursor: pointer; }',
    '.wtlf-tab:hover { color: #353535; }',
    '.wtlf-tab.active { color: #353535; border-bottom-color: #607D8B; }',
    '.wtlf-input { display: block; width: 100%; margin-top: 1.2rem; min-height: 7rem; box-sizing: border-box; padding: 1rem 1.2rem; border: 1px solid rgba(0, 0, 0, 0.25); border-radius: 2px; outline: none; resize: vertical; background: #FFFFFF; color: #353535; font-family: "Roboto", sans-serif; font-size: 1.5rem; line-height: 2.2rem; }',
    '.wtlf-input:focus { border-color: #839EB4; }',
    '.wtlf-note { margin: 0.8rem 0 0; font-size: 1.3rem; line-height: 2rem; color: rgba(0, 0, 0, 0.54); }',
    '.wtlf-actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.8rem; }',
    '.wtlf-link { margin-right: auto; font-size: 1.4rem; font-weight: 600; color: #738FA7; cursor: pointer; }',
    '.wtlf-link:hover { color: #6085A5; text-decoration: underline; }',
    '#wtlf-editor .bButton { border: 0; font-family: "Roboto", sans-serif; }'
  ].join('\n');

  function slapOnStyles() {
    var style = document.createElement('style');
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function watchTheFeed() {
    if (!window.MutationObserver) return;

    new MutationObserver(function (mutations) {
      var feedChanged = false;
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type !== 'childList') continue;
        var target = mutation.target;
        if (target && target.closest && target.closest('#feedWrapper .posts')) {
          feedChanged = true;
          break;
        }
      }
      if (!feedChanged) {
        queueRefresh();
        return;
      }
      hideTheCrap();
      doubleCheckTheLazyFetches();
      ensureControl();
      sneakInTheBanButton();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // The XHR hook is already armed at document-start. Everything that needs a
  // DOM waits for DOMContentLoaded, because apparently you can't touch the DOM
  // before then. Who knew.
  function wakeUp() {
    slapOnStyles();
    watchTheFeed();
    refresh();
  }

  hijackFeedRequests();

  document.addEventListener('click', function (event) {
    if (!event.target.closest || !event.target.closest('#wtlf')) closeControl();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    closeControl();
    closeTheSettingsThing();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wakeUp);
  } else {
    wakeUp();
  }

  window.addEventListener('load', queueRefresh);
  window.addEventListener('popstate', queueRefresh);
})();
