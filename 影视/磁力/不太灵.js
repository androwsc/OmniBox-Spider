// @name 不太灵
// @author 梦
// @description 资源网：详情与资源列表已接入；支持磁力/网盘资源展示
// @dependencies cheerio
// @version 1.2.5
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/磁力/不太灵.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const BASE_URL = "https://web5.mukaku.com";
const API_BASE = `${BASE_URL}/prod/api/v1`;
const APP_ID = "83768d9ad4";
const IDENTITY = "23734adac0301bccdcb107c4aa21f96c";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const MAGNET_PLAY_HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Cookie: "",
};
const DRIVE_TYPE_CONFIG = (process.env.DRIVE_TYPE_CONFIG || "quark;uc;baidu;xunlei;ali;alipan;123pan;tianyi;115").split(';').map(t => t.trim().toLowerCase()).filter(Boolean);
const SOURCE_NAMES_CONFIG = (process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连").split(';').map(s => s.trim()).filter(Boolean);
const DRIVE_ORDER = (process.env.DRIVE_ORDER || "baidu;tianyi;quark;uc;115;xunlei;ali;123pan").split(';').map(s => s.trim().toLowerCase()).filter(Boolean);

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

async function requestApi(path, params = {}, options = {}) {
  const qs = new URLSearchParams({
    app_id: APP_ID,
    identity: IDENTITY,
    ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== "")),
  }).toString();
  const url = `${API_BASE}/${path}?${qs}`;
  await OmniBox.log("info", `[木卡库][api] ${url}`);
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: `${BASE_URL}/`,
      ...(options.headers || {}),
    },
    timeout: options.timeout || 20000,
  });
  if (!res || Number(res.statusCode) !== 200) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }
  const data = JSON.parse(res.body || "{}");
  if (data && data.code && Number(data.code) !== 200) {
    throw new Error(data.message || `API code=${data.code}`);
  }
  return data;
}

function mapVideo(item) {
  return {
    vod_id: String(item?.idcode || item?.id || ""),
    vod_name: String(item?.title || ""),
    vod_pic: String(item?.image || ""),
    vod_year: String(item?.years || ""),
    type_id: String(item?.type || ""),
    type_name: String(item?.type_name || ""),
    vod_remarks: String(item?.alias || ""),
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSeedType(type, link) {
  const t = String(type || "").trim().toLowerCase();
  const u = String(link || "").trim().toLowerCase();
  if (u.includes("pan.quark.cn")) return "quark";
  if (u.includes("pan.baidu.com")) return "baidu";
  if (u.includes("pan.xunlei.com")) return "xunlei";
  if (u.includes("alipan.com") || u.includes("aliyundrive.com")) return "ali";
  if (u.startsWith("magnet:")) return "magnet";
  if (u.startsWith("ed2k://")) return "ed2k";
  if (/\.torrent($|\?)/i.test(u)) return "torrent";
  if (u.includes("cloud.189.cn")) return "tianyi";
  if (u.includes("123684.com") || u.includes("123912.com") || u.includes("123pan.com")) return "123pan";
  if (u.includes("drive.uc.cn") || u.includes("disk.uc.cn")) return "uc";
  if (u.includes("115.com")) return "115";
  if (t === 'alipan') return 'ali';
  if (t === 'magnet' || t === 'magnet_url' || t === 'magnet_link') return 'magnet';
  if (t === 'ed2k' || t === 'ed2k_url' || t === 'ed2k_link') return 'ed2k';
  if (t === 'torrent') return 'torrent';
  return t || "other";
}

function getDriveDisplayName(driveType, displayName = "") {
  const raw = String(displayName || "").trim();
  if (raw) return raw;
  const t = String(driveType || "").toLowerCase();
  if (t === 'baidu') return '百度';
  if (t === 'quark') return '夸克';
  if (t === 'xunlei') return '迅雷';
  if (t === 'ali') return '阿里';
  if (t === 'uc') return 'UC';
  if (t === '115') return '115';
  if (t === 'tianyi') return '天翼';
  if (t === '123pan') return '123盘';
  return t || '网盘';
}

function getSeedSourcePrefix(seedType) {
  const t = String(seedType || '').toLowerCase();
  if (t === 'magnet') return '🧲磁力';
  if (t === 'ed2k') return '⚡电驴';
  if (t === 'torrent') return '🧩种子';
  return '资源';
}

function sortPlaySourcesByDriveOrder(playSources = []) {
  if (!Array.isArray(playSources) || playSources.length <= 1 || !DRIVE_ORDER.length) return playSources;
  const orderMap = new Map(DRIVE_ORDER.map((name, idx) => [name, idx]));
  return [...playSources].sort((a, b) => {
    const aType = String(a?.driveType || '').toLowerCase();
    const bType = String(b?.driveType || '').toLowerCase();
    const aOrder = orderMap.has(aType) ? orderMap.get(aType) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(bType) ? orderMap.get(bType) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

function formatFileSize(size) {
  const n = Number(size || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  const unit = 1024;
  const units = ["B", "K", "M", "G", "T"];
  let value = n;
  let exp = 0;
  while (value >= unit && exp < units.length - 1) {
    value /= unit;
    exp++;
  }
  return value === Math.floor(value) ? `${Math.floor(value)}${units[exp]}` : `${value.toFixed(2)}${units[exp]}`;
}

function cleanEpisodeTitle(name) {
  return normalizeText(String(name || "").replace(/\.[a-z0-9]{2,5}$/i, ""));
}

function isDirectPlayableSeedType(seedType) {
  const t = String(seedType || "").toLowerCase();
  return t !== "magnet" && t !== "ed2k";
}

function extractEpisodeNumber(name) {
  const text = String(name || "");
  const patterns = [
    /S\d{1,2}E(\d{1,3})/i,
    /第\s*(\d{1,3})\s*[集话]/,
    /\[(\d{1,3})\s*[集话]\]/,
    /(?:^|[^A-Z0-9])E[P]?(\d{1,3})(?:[^A-Z0-9]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const ep = Number(match[1]);
      if (Number.isFinite(ep) && ep > 0) return ep;
    }
  }
  return null;
}

function extractEpisodeRange(name) {
  const text = String(name || "");
  const patterns = [
    /\[第\s*(\d{1,3})\s*[-—~～至]\s*(\d{1,3})\s*[集话]\]/,
    /第\s*(\d{1,3})\s*[-—~～至]\s*(\d{1,3})\s*[集话]/,
    /\[(\d{1,3})\s*[-—~～至]\s*(\d{1,3})\s*[集话]\]/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
        return { start, end };
      }
    }
  }
  return null;
}

function formatEpisodeLabel(ep, fallbackTitle) {
  if (Number.isFinite(ep) && ep > 0) return `第${String(ep).padStart(2, '0')}集`;
  return fallbackTitle || '资源';
}

function formatEpisodeRangeLabel(range, fallbackTitle) {
  if (range && Number.isFinite(range.start) && Number.isFinite(range.end)) {
    return `第${String(range.start).padStart(2, '0')}-${String(range.end).padStart(2, '0')}集`;
  }
  return fallbackTitle || '资源';
}

function sortEpisodesByEpisodeNumber(episodes = []) {
  return [...episodes].sort((a, b) => {
    const aRangeStart = Number.isFinite(a?.episodeRangeStart) ? a.episodeRangeStart : null;
    const bRangeStart = Number.isFinite(b?.episodeRangeStart) ? b.episodeRangeStart : null;
    const aEp = Number.isFinite(a?.episodeNumber) ? a.episodeNumber : (aRangeStart ?? Number.MAX_SAFE_INTEGER);
    const bEp = Number.isFinite(b?.episodeNumber) ? b.episodeNumber : (bRangeStart ?? Number.MAX_SAFE_INTEGER);
    if (aEp !== bEp) return aEp - bEp;
    const aRangeEnd = Number.isFinite(a?.episodeRangeEnd) ? a.episodeRangeEnd : aEp;
    const bRangeEnd = Number.isFinite(b?.episodeRangeEnd) ? b.episodeRangeEnd : bEp;
    if (aRangeEnd !== bRangeEnd) return aRangeEnd - bRangeEnd;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hans-CN');
  });
}

function buildSeedEpisode(item, fallbackTitle, extra = {}) {
  const link = String(
    item?.link ||
    item?.zlink ||
    item?.magnet ||
    item?.magnet_url ||
    item?.magnet_link ||
    item?.ed2k ||
    item?.ed2k_url ||
    item?.ed2k_link ||
    item?.torrent ||
    extra.shareURL ||
    ""
  ).trim();
  const seedType = normalizeSeedType(item?.type || extra.seedType || "", link);
  const isDriveFile = Boolean(extra.fromDriveFile);
  const rawTitle = isDriveFile
    ? cleanEpisodeTitle(item?.name || item?.file_name || fallbackTitle || "资源")
    : normalizeText(item?.seed_name || item?.zname || fallbackTitle || "资源");
  const quality = isDriveFile ? "" : normalizeText(item?.zqxd || item?.definition_group || extra.quality || "");
  const size = isDriveFile ? formatFileSize(item?.size || item?.obj_size || 0) : normalizeText(item?.zsize || item?.size || "");
  const createdAt = isDriveFile ? "" : normalizeText(item?.created_at || item?.ezt || "");
  const remarkBits = [size, quality, createdAt].filter(Boolean);

  const episodeRange = extra.fromDriveFile ? null : extractEpisodeRange(rawTitle);
  const episodeNumber = extra.fromDriveFile ? null : (episodeRange ? null : extractEpisodeNumber(rawTitle));
  const episodeLabel = (seedType === 'magnet' || seedType === 'ed2k' || seedType === 'torrent')
    ? (episodeRange ? formatEpisodeRangeLabel(episodeRange, rawTitle) : formatEpisodeLabel(episodeNumber, rawTitle))
    : rawTitle;
  let displayName = rawTitle;
  if (isDriveFile) {
    displayName = remarkBits.length ? `[${remarkBits.join(' / ')}] ${rawTitle}` : rawTitle;
  } else if (seedType === 'magnet' || seedType === 'ed2k' || seedType === 'torrent') {
    displayName = remarkBits.length ? `${episodeLabel} [${remarkBits.join(" / ")}]` : episodeLabel;
  } else {
    displayName = remarkBits.length ? `${rawTitle} [${remarkBits.join(" / ")}]` : rawTitle;
  }

  const playMeta = {
    link,
    seedType,
    title: rawTitle,
    displayName,
    quality,
    size,
    createdAt,
    code: String(item?.code || ""),
    down: String(item?.down || ""),
    vodName: String(extra.vodName || ""),
    pic: String(extra.pic || ""),
    shareURL: String(extra.shareURL || ""),
    fileId: String(extra.fileId || item?.fid || item?.file_id || ""),
    routeType: String(extra.routeType || "服务端代理"),
    directPlayable: Boolean(extra.directPlayable ?? isDirectPlayableSeedType(seedType)),
    episodeNumber,
    episodeRange,
  };

  const simplePlayId = Boolean(extra.simplePlayId) && (seedType === 'magnet' || seedType === 'ed2k' || seedType === 'torrent');

  return {
    name: (seedType === 'magnet' || seedType === 'ed2k' || seedType === 'torrent') ? episodeLabel : displayName,
    seedType,
    episodeNumber,
    episodeRangeStart: episodeRange?.start ?? null,
    episodeRangeEnd: episodeRange?.end ?? null,
    playId: simplePlayId ? link : JSON.stringify(playMeta),
  };
}

function isVideoFile(file) {
  if (!file || typeof file !== "object") return false;
  const name = String(file.name || file.file_name || "").toLowerCase();
  if (/\.(mp4|mkv|avi|mov|wmv|m4v|flv|ts|m2ts|webm|mpg|mpeg)$/i.test(name)) return true;
  const cat = String(file.category || file.type || file.mime_type || file.file_type || "").toLowerCase();
  if (cat.includes("video")) return true;
  return false;
}

async function getAllVideoFiles(shareURL, files) {
  if (!Array.isArray(files) || !files.length) return [];
  const out = [];
  for (const file of files) {
    if (file?.file && isVideoFile(file)) {
      out.push(file);
    } else if (file?.dir) {
      try {
        const sub = await OmniBox.getDriveFileList(shareURL, file.fid);
        if (sub?.files && Array.isArray(sub.files)) {
          const subVideos = await getAllVideoFiles(shareURL, sub.files);
          out.push(...subVideos);
        }
      } catch (e) {
        await OmniBox.log("warn", `[不太灵][detail] 读取网盘子目录失败 shareURL=${shareURL}, fid=${file?.fid || ""}, message=${e.message}`);
      }
    }
  }
  return out;
}

async function home(params, context) {
  try {
    const data = await requestApi("getVideoList", { page: 1 });
    const list = (((data || {}).data || {}).data || []).map(mapVideo);
    return {
      class: [
        { type_id: "movie", type_name: "电影" },
        { type_id: "tv", type_name: "剧集" },
        { type_id: "resource", type_name: "资源" },
      ],
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[不太灵][home] ${e.message}`);
    return { class: [], list: [] };
  }
}

async function category(params, context) {
  try {
    const page = Number(params.page || 1) || 1;
    const categoryId = String(params.categoryId || params.type_id || "recommend");

    let list = [];
    let limit = 24;

    if (categoryId === "recommend" || categoryId === "latest") {
      const data = await requestApi("getVideoList", { page, limit: 24 });
      list = (((data || {}).data || {}).data || []).map(mapVideo);
      limit = (((data || {}).data || {}).data || []).length || 24;
    } else if (categoryId === "movie") {
      const data = await requestApi("getVideoMovieList", { sa: 1, sg: 1, page, pfrs: 0, pfqj: "0x10", imdb: 0, iswp: 0 });
      list = (((data || {}).data || {}).list || []).map((item) => ({
        vod_id: String(item?.doub_id || item?.id || ""),
        vod_name: String(item?.title || ""),
        vod_pic: String(item?.epic || item?.image || ""),
        vod_year: String(item?.niandai || ""),
        type_id: "movie",
        type_name: "电影",
        vod_remarks: String(item?.eqxd || item?.ejs || ""),
      }));
      limit = (((data || {}).data || {}).limit || 24);
    } else if (categoryId === "tv") {
      const data = await requestApi("getVideoMovieList", { sa: 2, sg: 1, page, pfrs: 0, pfqj: "0x10", imdb: 0, iswp: 0, status: 0 });
      list = (((data || {}).data || {}).list || []).map((item) => ({
        vod_id: String(item?.doub_id || item?.id || ""),
        vod_name: String(item?.title || ""),
        vod_pic: String(item?.epic || item?.image || ""),
        vod_year: String(item?.niandai || ""),
        type_id: "tv",
        type_name: "剧集",
        vod_remarks: String(item?.ejs || item?.eqxd || ""),
      }));
      limit = (((data || {}).data || {}).limit || 24);
    } else if (categoryId === "resource") {
      const data = await requestApi("getVideoMovieList", { sa: 1, sg: 1, page, pfrs: 0, pfqj: "0x10", imdb: 0, iswp: 1 });
      list = (((data || {}).data || {}).list || []).map((item) => ({
        vod_id: String(item?.doub_id || item?.id || ""),
        vod_name: String(item?.title || ""),
        vod_pic: String(item?.epic || item?.image || ""),
        vod_year: String(item?.niandai || ""),
        type_id: "resource",
        type_name: "资源",
        vod_remarks: String(item?.eqxd || item?.ejs || "资源网"),
      }));
      limit = (((data || {}).data || {}).limit || 24);
    }

    await OmniBox.log("info", `[不太灵][category] category=${categoryId}, page=${page}, count=${list.length}`);
    return {
      page,
      pagecount: page + (list.length >= limit ? 1 : 0),
      total: page * limit + list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[不太灵][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params.videoId || params.id || params.vod_id || "").trim();
    if (!videoId) return { list: [] };

    const res = await requestApi("getVideoDetail", { id: videoId });
    const v = (res || {}).data || {};
    const playSources = [];

    // 磁力/电驴等资源：当前站点返回的多数是“单集磁力”，可按标题识别集数后作为真分集展示
    const ecca = (v && typeof v.ecca === "object" && v.ecca) ? v.ecca : {};
    for (const [group, items] of Object.entries(ecca)) {
      if (!Array.isArray(items) || !items.length) continue;
      const episodes = sortEpisodesByEpisodeNumber(items.map((item, idx) => buildSeedEpisode(item, `${v.title || '资源'}_${group}_${idx + 1}`, {
        quality: group,
        vodName: v.title,
        pic: v.image,
        index: idx + 1,
        directPlayable: true,
        simplePlayId: true,
      })));
      if (episodes.length) {
        const prefix = getSeedSourcePrefix(episodes[0]?.seedType || 'magnet');
        playSources.push({ name: `${prefix}·${group}`, episodes: episodes.map(({ seedType, episodeNumber, episodeRangeStart, episodeRangeEnd, ...rest }) => rest) });
      }
    }

    // 兜底：如果 ecca 没给够，可从 all_seeds 再补一组
    if (!playSources.length && Array.isArray(v.all_seeds) && v.all_seeds.length) {
      const episodes = sortEpisodesByEpisodeNumber(v.all_seeds.map((item, idx) => buildSeedEpisode(item, `${v.title || '资源'}_${idx + 1}`, {
        quality: item?.definition_group || item?.zqxd || "",
        vodName: v.title,
        pic: v.image,
        index: idx + 1,
        directPlayable: true,
        simplePlayId: true,
      })));
      if (episodes.length) {
        const prefix = getSeedSourcePrefix(episodes[0]?.seedType || 'magnet');
        playSources.push({ name: `${prefix}资源`, episodes: episodes.map(({ seedType, episodeNumber, episodeRangeStart, episodeRangeEnd, ...rest }) => rest) });
      }
    }

    // 网盘资源：按单个分享链接拆线路；展开失败则不显示该线路
    const seeds = v.movies_online_seed || {};
    const netdiskCounters = {};
    for (const [group, items] of Object.entries(seeds)) {
      if (!Array.isArray(items) || !items.length) continue;

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const shareURL = String(item?.link || "").trim();
        const seedType = normalizeSeedType(item?.type, shareURL);
        const episodes = [];

        if (DRIVE_TYPE_CONFIG.includes(seedType) && /^https?:\/\//i.test(shareURL)) {
          try {
            const driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
            await OmniBox.log("info", `[不太灵][detail] 网盘识别成功 group=${group}, seedType=${seedType}, displayName=${driveInfo?.displayName || ""}`);
            const root = await OmniBox.getDriveFileList(shareURL, "0");
            const files = root?.files && Array.isArray(root.files) ? root.files : [];
            const videoFiles = await getAllVideoFiles(shareURL, files);

            if (videoFiles.length) {
              for (const file of videoFiles) {
                episodes.push(buildSeedEpisode(file, file?.name || `${group}_${idx + 1}`, {
                  vodName: v.title,
                  pic: v.image,
                  shareURL,
                  fileId: file?.fid || file?.file_id || "",
                  routeType: "服务端代理",
                  quality: file?.category || "",
                  seedType,
                  fromDriveFile: true,
                }));
              }
            }
          } catch (e) {
            await OmniBox.log("warn", `[不太灵][detail] 网盘展开失败 group=${group}, shareURL=${shareURL}, message=${e.message}`);
          }
        }

        if (!episodes.length) {
          await OmniBox.log("info", `[不太灵][detail] 跳过未展开的网盘线路 group=${group}, shareURL=${shareURL}`);
          continue;
        }

        const driveDisplayName = getDriveDisplayName(seedType, "");
        netdiskCounters[driveDisplayName] = (netdiskCounters[driveDisplayName] || 0) + 1;
        const lineIndex = netdiskCounters[driveDisplayName];

        for (const sourceName of SOURCE_NAMES_CONFIG) {
          const routeType = sourceName || "服务端代理";
          const routedEpisodes = episodes.map((ep) => {
            let meta = {};
            try {
              meta = JSON.parse(ep.playId);
            } catch {
              meta = {};
            }
            return {
              name: ep.name,
              playId: JSON.stringify({
                ...meta,
                routeType,
              }),
            };
          });
          const lineName = `网盘·${driveDisplayName}${lineIndex}-${routeType}`;
          playSources.push({ name: lineName, episodes: routedEpisodes, driveType: seedType });
        }
      }
    }

    const sortedPlaySources = sortPlaySourcesByDriveOrder(playSources);
    await OmniBox.log("info", `[不太灵][detail] id=${videoId}, sources=${sortedPlaySources.length}, eccaGroups=${Object.keys(ecca).length}, netdiskGroups=${Object.keys(seeds).length}, order=${sortedPlaySources.map(s => s.name).join(' | ')}`);
    return {
      list: [{
        vod_id: String(v.idcode || videoId),
        vod_name: String(v.title || ""),
        vod_pic: String(v.image || ""),
        vod_subtitle: normalizeText(v.alias || v.otitle || ""),
        vod_year: String(v.years || ""),
        vod_area: normalizeText(v.production_area || ""),
        vod_lang: normalizeText(v.language || ""),
        vod_director: normalizeText(v.director || ""),
        vod_actor: normalizeText(v.performer || ""),
        vod_content: normalizeText(v.abstract || ""),
        vod_remarks: `豆瓣:${v.doub_score || "-"} IMDb:${v.IMDB_score || "-"}`,
        type_name: normalizeText(v.class || "") || (Array.isArray(v.biaoqian) ? v.biaoqian.filter(Boolean).join(" / ") : ""),
        vod_play_sources: sortedPlaySources.map(({ driveType, ...rest }) => rest),
      }],
    };
  } catch (e) {
    await OmniBox.log("error", `[不太灵][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  const keyword = String(params.keyword || params.key || params.wd || "").trim();
  const page = Number(params.page || 1) || 1;
  try {
    const data = await requestApi("getVideoList", { sb: keyword, page, limit: 24 });
    const list = (((data || {}).data || {}).data || []).map(mapVideo);
    await OmniBox.log("info", `[不太灵][search] keyword=${keyword}, page=${page}, count=${list.length}`);
    return {
      page,
      pagecount: page + (list.length >= 24 ? 1 : 0),
      total: page * 24 + list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[不太灵][search] ${e.message}`);
    return {
      page,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }
}

async function play(params, context) {
  try {
    const raw = String(params.playId || params.play_id || "").trim();
    if (!raw) return { parse: 0, urls: [] };
    let meta = {};
    try {
      meta = JSON.parse(raw);
    } catch {
      meta = { link: raw, title: "资源", displayName: "资源" };
    }

    const link = String(meta.link || meta.shareURL || raw || "").trim();
    const seedType = String(meta.seedType || normalizeSeedType("", link));
    const directPlayable = Boolean(meta.directPlayable ?? isDirectPlayableSeedType(seedType));
    await OmniBox.log("info", `[不太灵][play] type=${seedType}, directPlayable=${directPlayable}, link=${link}, shareURL=${meta.shareURL || ""}, fileId=${meta.fileId || ""}`);

    if (meta.shareURL && meta.fileId) {
      try {
        const source = context?.from || "web";
        let routeType = source === "web" ? (SOURCE_NAMES_CONFIG[1] || "服务端代理") : (SOURCE_NAMES_CONFIG[2] || "直连");
        if (params.flag && String(params.flag).includes("-")) {
          const flagParts = String(params.flag).split("-");
          routeType = flagParts[flagParts.length - 1];
        }
        await OmniBox.log("info", `[不太灵][play] 使用网盘线路: ${routeType}`);

        const playInfo = await OmniBox.getDriveVideoPlayInfo(meta.shareURL, meta.fileId, routeType);
        if (!playInfo || !playInfo.url || !Array.isArray(playInfo.url) || playInfo.url.length === 0) {
          throw new Error("无法获取网盘播放地址");
        }

        const urlsResult = [];
        for (const item of playInfo.url) {
          urlsResult.push({
            name: item?.name || meta.title || seedType || "播放",
            url: item?.url || "",
          });
        }

        const header = playInfo.header || {};
        return {
          urls: urlsResult.filter(it => it.url),
          flag: meta.shareURL,
          header,
          headers: header,
          parse: 0,
          danmaku: playInfo.danmaku || [],
        };
      } catch (e) {
        await OmniBox.log("warn", `[不太灵][play] 网盘播放解析失败 shareURL=${meta.shareURL}, fileId=${meta.fileId}, message=${e.message}`);
      }
    }

    // 资源网外链兜底
    if (/^(https?:\/\/|magnet:|ed2k:\/\/)/i.test(link)) {
      const header = /^(magnet:|ed2k:\/\/)/i.test(link) ? MAGNET_PLAY_HEADERS : {};
      const playFlag = seedType === 'magnet' ? 'magnet' : seedType === 'ed2k' ? 'ed2k' : seedType || 'resource';
      return {
        parse: 0,
        url: link,
        urls: [{ name: meta.displayName || meta.title || getSeedSourcePrefix(seedType) || "资源", url: link }],
        flag: playFlag,
        header,
        headers: header,
      };
    }

    return {
      parse: 1,
      url: link,
      urls: [{ name: meta.title || "资源页", url: link }],
      flag: seedType || "resource",
    };
  } catch (e) {
    await OmniBox.log("error", `[不太灵][play] ${e.message}`);
    return { parse: 0, urls: [] };
  }
}
