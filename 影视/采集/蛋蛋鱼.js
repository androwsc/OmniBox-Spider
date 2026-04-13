// @name 蛋蛋鱼
// @author 梦
// @description 页面解析：首页/分类/详情已接入；搜索直接走 ymck 聚合兜底；播放优先解析 yuplayer 接口并还原真实直链，失败时再回退 SDK 嗅探
// @version 1.4.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/蛋蛋鱼.js
// @dependencies axios,cheerio

const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const vm = require("vm");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = "https://www.dandanyu.fun";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const CLASS_LIST = [
  { type_id: "1", type_name: "电影" },
  { type_id: "2", type_name: "剧集" },
  { type_id: "3", type_name: "综艺" },
  { type_id: "4", type_name: "动漫" }
];

const http = axios.create({
  timeout: 20000,
  validateStatus: () => true,
  headers: {
    "User-Agent": UA,
    Referer: `${HOST}/`
  }
});

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function log(level, msg) {
  try { OmniBox.log(level, `[蛋蛋鱼] ${msg}`); } catch {}
}

function absUrl(url, base = HOST) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  try {
    return new URL(value, /^https?:\/\//i.test(base) ? base : `${HOST}/`).toString();
  } catch {
    if (value.startsWith('/')) return `${HOST}${value}`;
    return `${HOST}/${value.replace(/^\/+/, '')}`;
  }
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchText(url, options = {}) {
  const res = await http.get(url, {
    headers: {
      "User-Agent": UA,
      Referer: options.referer || `${HOST}/`,
      ...(options.headers || {})
    },
    responseType: options.responseType || 'text'
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.data;
}

function dedupeBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function createYuplayerSandbox() {
  const sandbox = {
    console,
    self: {},
    top: {},
    window: { location: { search: '?vid=test' }, parent: { document: { title: 'x' } } },
    document: {
      cookie: '',
      title: '',
      getElementById() {
        return { addEventListener() {}, pause() {}, play() {}, currentTime: 0, innerHTML: '' };
      }
    },
    location: { search: '?vid=test', reload() {} },
    localStorage: { getItem() { return 0; }, setItem() {}, removeItem() {} },
    navigator: { userAgent: UA },
    unescape,
    escape,
    decodeURIComponent,
    encodeURIComponent,
    setTimeout: () => 0,
    clearTimeout: () => {},
    Array,
    Date,
    Math,
    String,
    Number,
    RegExp,
    JSON,
    Hls: function () {},
    DPlayer: function () { return { on() {}, video: { currentTime: 0 }, play() {} }; },
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    md5: (s) => crypto.createHash('md5').update(String(s)).digest('hex')
  };

  function jq() {
    return {
      html() { return this; },
      show() { return this; },
      hide() { return this; },
      append() { return this; },
      on() { return this; },
      click() { return this; },
      addClass() { return this; },
      removeClass() { return this; },
      attr() { return this; },
      text() { return this; },
      ready() { return this; },
      get() { return [{}]; }
    };
  }
  jq.post = function () {};
  sandbox.$ = jq;
  sandbox.jQuery = jq;
  return sandbox;
}

async function decodeYuplayerUrlByPage({ encoded, urlMode, vid, playPageUrl }) {
  const playerPageUrl = `${HOST}/yuplayer/index.php?vid=${encodeURIComponent(vid)}`;
  const html = await fetchText(playerPageUrl, { referer: playPageUrl });
  const startTag = '<script type="text/javascript">';
  const start = html.indexOf(startTag, html.indexOf('<body>'));
  const end = html.lastIndexOf('</script>');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('yuplayer decoder script not found');
  }

  const scriptCode = html.slice(start + startTag.length, end);
  const sandbox = createYuplayerSandbox();
  vm.createContext(sandbox);
  vm.runInContext(scriptCode, sandbox, { timeout: 5000 });

  const decoder = Number(urlMode) === 2 ? sandbox.Decode2 : sandbox.Decode1;
  if (!decoder || typeof decoder.get !== 'function') {
    throw new Error(`yuplayer decoder unavailable for mode=${urlMode}`);
  }

  return String(decoder.get(String(encoded || '')) || '').trim();
}

async function resolveYuplayer(playId) {
  const pageUrl = absUrl(playId);
  const pageHtml = await fetchText(pageUrl, { referer: `${HOST}/` });
  const playerMatch = pageHtml.match(/var\s+player_aaaa\s*=\s*(\{.*?\})<\/script>/s);
  if (!playerMatch) throw new Error('player_aaaa not found');

  const playerData = JSON.parse(playerMatch[1]);
  const encryptedVid = String(playerData?.url || '').trim();
  if (!encryptedVid) throw new Error('empty yuplayer vid');

  const apiUrl = `${HOST}/yuplayer/api.php`;
  const apiRes = await http.post(
    apiUrl,
    new URLSearchParams({ vid: encryptedVid }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${HOST}/yuplayer/index.php?vid=${encodeURIComponent(encryptedVid)}`
      }
    }
  );

  const payload = apiRes?.data;
  const data = payload?.data;
  if (!payload || Number(payload.code) !== 200 || !data) {
    throw new Error(`yuplayer api invalid: ${JSON.stringify(payload).slice(0, 300)}`);
  }

  let finalUrl = String(data.url || '').trim();
  const urlMode = Number(data.urlmode || 0);
  if (urlMode === 1 || urlMode === 2) {
    finalUrl = await decodeYuplayerUrlByPage({
      encoded: finalUrl,
      urlMode,
      vid: encryptedVid,
      playPageUrl: pageUrl
    });
  }

  if (!isHttpUrl(finalUrl)) {
    throw new Error(`yuplayer final url invalid: ${String(finalUrl).slice(0, 300)}`);
  }

  return {
    url: finalUrl,
    type: String(data.type || '').trim(),
    poster: String(data.poster || '').trim(),
    player: String(data.player || '').trim(),
    urlMode
  };
}

function parseVodCards(html) {
  const raw = String(html || '');
  const list = [];
  const boxMatches = raw.match(/<div class="stui-vodlist__box">[\s\S]*?<\/div>\s*<\/li>/gi) || [];

  for (const box of boxMatches) {
    const href = (box.match(/href="([^"]*\/voddetail\/\d+\.html)"/i) || [])[1] || '';
    const vodId = (href.match(/\/voddetail\/(\d+)\.html/i) || [])[1] || '';
    if (!vodId) continue;

    const title =
      (box.match(/title="([^"]+)"/i) || [])[1] ||
      (box.match(/<h4 class="title[^"]*">[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) || [])[1] ||
      '';
    const pic =
      (box.match(/data-original="([^"]+)"/i) || [])[1] ||
      (box.match(/data-src="([^"]+)"/i) || [])[1] ||
      (box.match(/<img[^>]+src="([^"]+)"/i) || [])[1] ||
      '';
    const remarks = (box.match(/<span class="pic-text[^"]*">([^<]+)<\/span>/i) || [])[1] || '';

    list.push({
      vod_id: vodId,
      vod_name: stripHtml(title),
      vod_pic: absUrl(pic),
      vod_remarks: stripHtml(remarks)
    });
  }

  return dedupeBy(list, (item) => item.vod_id);
}

function extractPageCount(html, currentPage = 1) {
  const matches = [...String(html || "").matchAll(/vodtype\/\d+-(\d+)\.html/gi)].map((m) => Number(m[1]));
  const maxPage = matches.length ? Math.max(...matches) : currentPage;
  return maxPage || currentPage;
}

async function home() {
  try {
    const html = await fetchText(`${HOST}/`);
    let list = parseVodCards(html).slice(0, 40);
    if (!list.length) {
      // 首页结构偶尔变动时，回退到剧集分类第一页，避免首页全空。
      const fallbackHtml = await fetchText(`${HOST}/vodtype/2.html`);
      list = parseVodCards(fallbackHtml).slice(0, 40);
    }
    log('info', `home list=${list.length}`);
    return { class: CLASS_LIST, list };
  } catch (e) {
    log('error', `home ${e.message}`);
    return { class: CLASS_LIST, list: [] };
  }
}

async function category(params) {
  try {
    const categoryId = String(params?.categoryId || '1');
    const page = Math.max(1, Number(params?.page || 1) || 1);
    const url = page > 1 ? `${HOST}/vodtype/${categoryId}-${page}.html` : `${HOST}/vodtype/${categoryId}.html`;
    const html = await fetchText(url);
    const list = parseVodCards(html);
    const pagecount = Math.max(page, extractPageCount(html, page));
    log('info', `category category=${categoryId} page=${page} list=${list.length} pagecount=${pagecount}`);
    return { page, pagecount, total: list.length, list };
  } catch (e) {
    log('error', `category ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function aggregateApiSearch(keyword, page) {
  try {
    const searchUrl = `https://www.ymck.pro/API/v2.php?q=${encodeURIComponent(keyword)}&size=50`;
    const base64Data = await fetchText(searchUrl, { referer: HOST + '/' });
    if (!base64Data) return { list: [], page, pagecount: 0, total: 0 };

    const decoded = Buffer.from(String(base64Data).trim(), 'base64').toString('utf8');
    const searchResults = JSON.parse(decoded) || [];
    const targetSites = ["蛋蛋鱼", "蛋蛋", "dandanyu"];
    const list = [];

    for (const item of searchResults) {
      if (!item || typeof item !== 'object') continue;
      const website = String(item.website || '');
      if (!targetSites.some((name) => website.includes(name))) continue;
      const url = String(item.url || '');
      const vodId = (url.match(/\/voddetail\/(\d+)\.html/i) || [])[1] || '';
      if (!vodId) continue;
      list.push({
        vod_id: vodId,
        vod_name: String(item.text || keyword),
        vod_pic: absUrl(item.icon || ''),
        vod_remarks: Array.isArray(item.tags) ? item.tags.filter(Boolean).join(' ') : ''
      });
    }

    return { page: 1, pagecount: 1, total: list.length, list: dedupeBy(list, (item) => item.vod_id) };
  } catch (e) {
    log('error', `aggregate search ${e.message}`);
    return { list: [], page, pagecount: 0, total: 0 };
  }
}

async function detail(params) {
  try {
    const videoId = String(params?.videoId || '').trim();
    if (!videoId) return { list: [] };

    const html = await fetchText(`${HOST}/voddetail/${videoId}.html`);
    const $ = cheerio.load(html, { decodeEntities: false });

    const vodName = stripHtml($('.stui-content__detail .title').first().text()) || stripHtml($('title').first().text()).replace(/详情介绍.*$/, '').trim();
    const vodPic = absUrl($('.stui-content__thumb img').first().attr('data-original') || $('.stui-content__thumb img').first().attr('src') || '');
    const infoLines = $('.stui-content__detail .data').map((_, el) => stripHtml($(el).text())).get();
    const typeLine = infoLines.find((line) => line.includes('类型：')) || '';
    const actorLine = infoLines.find((line) => line.includes('主演：')) || '';
    const directorLine = infoLines.find((line) => line.includes('导演：')) || '';
    const updateLine = infoLines.find((line) => line.includes('更新：')) || '';
    const desc = stripHtml($('.detail-content').first().text()) || stripHtml($('.detail-sketch').first().text()) || stripHtml($('meta[name="description"]').attr('content') || '');

    const typeName = (typeLine.match(/类型：([^/]+)/) || [])[1]?.trim() || '';
    const area = (typeLine.match(/地区：([^/]+)/) || [])[1]?.trim() || '';
    const year = (typeLine.match(/年份：([^/]+)/) || [])[1]?.trim() || '';
    const actor = actorLine.replace(/^主演：/, '').trim();
    const director = directorLine.replace(/^导演：/, '').trim();
    const remarks = updateLine.replace(/^更新：/, '').trim();

    const vodPlaySources = [];
    let currentSource = null;
    $('.stui-vodlist__head, .stui-content__playlist').each((_, el) => {
      const $el = $(el);
      if ($el.hasClass('stui-vodlist__head')) {
        currentSource = stripHtml($el.find('h3').first().text()) || `线路${vodPlaySources.length + 1}`;
        return;
      }
      const episodes = [];
      $el.find('a[href*="/vodplay/"]').each((__, a) => {
        const $a = $(a);
        const href = $a.attr('href') || '';
        const name = stripHtml($a.text()) || stripHtml($a.attr('title') || '');
        if (!href) return;
        episodes.push({ name: name || `第${episodes.length + 1}集`, playId: absUrl(href) });
      });
      if (episodes.length) {
        vodPlaySources.push({ name: currentSource || `线路${vodPlaySources.length + 1}`, episodes });
      }
    });

    log('info', `detail id=${videoId} sources=${vodPlaySources.length}`);
    return {
      list: [{
        vod_id: videoId,
        vod_name: vodName,
        vod_pic: vodPic,
        type_name: typeName,
        vod_area: area,
        vod_year: year,
        vod_actor: actor,
        vod_director: director,
        vod_content: desc,
        vod_remarks: remarks,
        vod_play_sources: vodPlaySources
      }]
    };
  } catch (e) {
    log('error', `detail ${e.message}`);
    return { list: [] };
  }
}

async function search(params) {
  const keyword = String(params?.keyword || params?.wd || '').trim();
  const page = Math.max(1, Number(params?.page || 1) || 1);
  if (!keyword) return { list: [], page, pagecount: 0, total: 0 };

  // 站内搜索需要验证码，这里不自动过验证，直接走 ymck 聚合兜底。
  const result = await aggregateApiSearch(keyword, page);
  log('info', `search keyword=${keyword} list=${result.list.length}`);
  return result;
}

async function play(params) {
  const playId = String(params?.playId || '').trim();
  if (!playId) return { urls: [], parse: 1, header: {} };

  try {
    log('info', `play yuplayer ${playId}`);
    const resolved = await resolveYuplayer(playId);
    log('info', `play yuplayer resolved type=${resolved.type} player=${resolved.player} url=${resolved.url.slice(0, 300)}`);
    return {
      urls: [{ name: '默认线路', url: resolved.url }],
      parse: 0,
      header: {
        'User-Agent': UA,
        'Referer': `${HOST}/`
      }
    };
  } catch (e) {
    log('error', `play yuplayer ${e.message}`);
  }

  try {
    log('info', `play sniff ${playId}`);
    const sniffed = await OmniBox.sniffVideo(playId, {
      'User-Agent': UA,
      'Referer': `${HOST}/`
    });
    log('info', `play sniff result=${JSON.stringify(sniffed).slice(0, 800)}`);

    if (typeof sniffed === 'string' && isHttpUrl(sniffed)) {
      return {
        urls: [{ name: '默认线路', url: sniffed }],
        parse: 0,
        header: {
          'User-Agent': UA,
          'Referer': `${HOST}/`
        }
      };
    }

    if (sniffed && Array.isArray(sniffed.urls) && sniffed.urls.length) {
      return {
        urls: sniffed.urls,
        flag: sniffed.flag || 'play',
        parse: sniffed.parse ?? 0,
        header: sniffed.headers || sniffed.header || {
          'User-Agent': UA,
          'Referer': `${HOST}/`
        }
      };
    }

    if (sniffed && sniffed.url && isHttpUrl(sniffed.url)) {
      return {
        urls: [{ name: '默认线路', url: sniffed.url }],
        flag: sniffed.flag || 'play',
        parse: sniffed.parse ?? 0,
        header: sniffed.headers || sniffed.header || {
          'User-Agent': UA,
          'Referer': `${HOST}/`
        }
      };
    }
  } catch (e) {
    log('error', `play sniff ${e.message}`);
  }

  return {
    urls: [{ name: '默认线路', url: playId }],
    parse: 1,
    header: {
      'User-Agent': UA,
      'Referer': `${HOST}/`
    }
  };
}
