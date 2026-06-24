/**
 * Recipe Box — email → GitHub glue.
 *
 * Runs on a time trigger (e.g. every 5 minutes). It reads new (unread) emails in
 * the connected Gmail account, pulls the first link out of each, treats the rest
 * of the message as a note, fetches the recipe's title, and appends an entry to
 * recipes.json in your GitHub repo. Processed emails are marked read + labeled.
 *
 * SETUP (see README for the full walkthrough):
 *   1. Project Settings → Script properties, add:
 *        GITHUB_TOKEN    = a fine-grained PAT with Contents read+write on the repo
 *        GITHUB_OWNER    = your GitHub username
 *        GITHUB_REPO     = the repository name (e.g. recipe-box)
 *        GITHUB_BRANCH   = main            (optional, defaults to "main")
 *        ALLOWED_SENDERS = comma-separated whitelist of sender email addresses,
 *                          e.g. "me@gmail.com, partner@gmail.com". Only emails
 *                          from these addresses are added. Leave unset to allow
 *                          everyone (not recommended).
 *   2. Run `processInbox` once manually to authorize Gmail + external requests.
 *   3. Run `createTrigger` once to schedule it every 5 minutes.
 */

var FILE_PATH = 'recipes.json';
var PROCESSED_LABEL = 'Reciped';

function cfg(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v === null || v === '') ? fallback : v;
}

/** Main entry point — called by the time trigger. */
function processInbox() {
  var label = getOrCreateLabel(PROCESSED_LABEL);
  // Unread, in inbox, not already processed. Newest threads first.
  var threads = GmailApp.search('is:unread in:inbox -label:' + PROCESSED_LABEL, 0, 25);

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      if (!msg.isUnread()) continue;
      try {
        handleMessage(msg);
      } catch (err) {
        Logger.log('Error on message "' + msg.getSubject() + '": ' + err);
      }
    }
    threads[t].markRead();
    threads[t].addLabel(label);
  }
}

function handleMessage(msg) {
  var sender = parseEmail(msg.getFrom());
  if (!isAllowedSender(sender)) {
    Logger.log('Sender "' + sender + '" not on the whitelist — skipping.');
    return;
  }

  var subject = msg.getSubject() || '';
  var body = msg.getPlainBody() || '';
  var combined = subject + '\n' + body;

  var url = extractUrl(combined);
  if (!url) {
    Logger.log('No URL found in "' + subject + '" — skipping.');
    return;
  }

  // Skip if we already have this URL.
  var current = readRecipes();
  for (var i = 0; i < current.list.length; i++) {
    if (current.list[i].url === url) {
      Logger.log('Already have ' + url + ' — skipping.');
      return;
    }
  }

  var note = buildNote(body, url, subject);
  var title = fetchTitle(url) || subject || url;
  var site = hostname(url);

  var entry = {
    id: Utilities.getUuid(),
    title: title,
    url: url,
    site: site,
    note: note,
    from: sender,
    date: msg.getDate().toISOString()
  };

  current.list.unshift(entry);
  writeRecipes(current.list, current.sha, 'Add recipe: ' + title);
  Logger.log('Added: ' + title);
}

/* ----------------------- Parsing helpers ----------------------- */

function extractUrl(text) {
  var match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!match) return null;
  // Trim trailing punctuation that often clings to pasted links.
  return match[0].replace(/[.,;:!?)\]"']+$/, '');
}

function buildNote(body, url, subject) {
  var note = (body || '').replace(url, ' ');
  // Drop common forwarded-mail boilerplate lines.
  note = note.replace(/^[>].*$/gm, '');
  note = note.replace(/sent from my .*/gi, '');
  note = note.replace(/https?:\/\/[^\s<>"')\]]+/g, ' '); // any other links
  note = note.replace(/\s+/g, ' ').trim();
  if (note.length > 600) note = note.slice(0, 597) + '…';
  return note;
}

function parseEmail(from) {
  var m = (from || '').match(/<([^>]+)>/);
  return (m ? m[1] : (from || '')).trim().toLowerCase();
}

/** True if `sender` is on the ALLOWED_SENDERS whitelist (or the list is empty). */
function isAllowedSender(sender) {
  var raw = cfg('ALLOWED_SENDERS', '');
  if (!raw.trim()) return true; // no whitelist configured → allow all
  var allowed = raw.split(',').map(function (s) { return s.trim().toLowerCase(); })
                   .filter(function (s) { return s; });
  return allowed.indexOf((sender || '').toLowerCase()) !== -1;
}

function hostname(url) {
  var m = url.match(/^https?:\/\/([^\/]+)/i);
  return m ? m[1].replace(/^www\./, '') : '';
}

/** Best-effort recipe title: JSON-LD Recipe name → og:title → <title>. */
function fetchTitle(url) {
  var html;
  try {
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecipeBox/1.0)' }
    });
    if (res.getResponseCode() >= 400) return null;
    html = res.getContentText();
  } catch (e) {
    return null;
  }

  // 1) schema.org Recipe via JSON-LD
  var scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (var i = 0; i < scripts.length; i++) {
    var inner = scripts[i].replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
    var name = recipeNameFromJsonLd(inner);
    if (name) return clean(name);
  }

  // 2) Open Graph title
  var og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
           html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og) return clean(og[1]);

  // 3) <title>
  var t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return clean(t[1]);

  return null;
}

function recipeNameFromJsonLd(jsonText) {
  var data;
  try { data = JSON.parse(jsonText); } catch (e) { return null; }
  var nodes = [];
  if (Array.isArray(data)) nodes = data;
  else if (data['@graph']) nodes = data['@graph'];
  else nodes = [data];

  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (!n || typeof n !== 'object') continue;
    var type = n['@type'];
    var isRecipe = type === 'Recipe' || (Array.isArray(type) && type.indexOf('Recipe') !== -1);
    if (isRecipe && n.name) return typeof n.name === 'string' ? n.name : null;
  }
  return null;
}

function clean(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); });
}

/* ----------------------- GitHub I/O ----------------------- */

function apiUrl() {
  return 'https://api.github.com/repos/' + cfg('GITHUB_OWNER') + '/' +
         cfg('GITHUB_REPO') + '/contents/' + FILE_PATH;
}

function ghHeaders() {
  return {
    'Authorization': 'Bearer ' + cfg('GITHUB_TOKEN'),
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function readRecipes() {
  var branch = cfg('GITHUB_BRANCH', 'main');
  var res = UrlFetchApp.fetch(apiUrl() + '?ref=' + branch, {
    method: 'get', headers: ghHeaders(), muteHttpExceptions: true
  });
  if (res.getResponseCode() === 404) return { list: [], sha: null };
  if (res.getResponseCode() >= 400) {
    throw new Error('GitHub read failed: ' + res.getResponseCode() + ' ' + res.getContentText());
  }
  var meta = JSON.parse(res.getContentText());
  var content = Utilities.newBlob(Utilities.base64Decode(meta.content)).getDataAsString();
  var list;
  try { list = JSON.parse(content); } catch (e) { list = []; }
  return { list: Array.isArray(list) ? list : [], sha: meta.sha };
}

function writeRecipes(list, sha, message) {
  var branch = cfg('GITHUB_BRANCH', 'main');
  var json = JSON.stringify(list, null, 2) + '\n';
  var payload = {
    message: message,
    content: Utilities.base64Encode(json, Utilities.Charset.UTF_8),
    branch: branch
  };
  if (sha) payload.sha = sha;

  var res = UrlFetchApp.fetch(apiUrl(), {
    method: 'put', headers: ghHeaders(),
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) {
    throw new Error('GitHub write failed: ' + res.getResponseCode() + ' ' + res.getContentText());
  }
}

/* ----------------------- Gmail label ----------------------- */

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/* ----------------------- Trigger setup ----------------------- */

/** Run once to schedule processInbox every 5 minutes. */
function createTrigger() {
  // Remove existing triggers for this function first to avoid duplicates.
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processInbox') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
  Logger.log('Trigger created: processInbox every 5 minutes.');
}
