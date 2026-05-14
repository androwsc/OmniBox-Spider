// @name Jellyfin
// @author Copilot
// @description 直连 Jellyfin/Emby 接口，填好服务器地址、账号密码即可使用。支持多服务器、多库、剧集/电影播放
// @dependencies: axios
// @version 1.3.0
// @indexs 影视
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/流媒体/Jellyfin.js

/**
 * ============================================================================
 * Jellyfin OmniBox 爬虫
 * ============================================================================
 * 说明：
 * 1. 直连 Jellyfin 接口（兼容 Emby API），填好服务器地址、账号密码即可使用。
 * 2. Jellyfin 使用与 Emby 兼容的 API（/emby/ 路径前缀），可直接复用。
 * 3. 支持多 Jellyfin 服务器配置，直接修改下方的 accounts 数组。
 * 4. 自动处理登录认证、库列表、分类列表、详情（含剧集各季/各集）、搜索和播放。
 * ============================================================================
 * 配置方式：直接修改下方 accounts 数组中的 server/username/password
 *   [{"server":"http://...","username":"...","password":"...","name":"..."}]
 * ============================================================================
 */

const axios = require("axios");
const http = require("http");
const https = require("https");

let OmniBox;
try { OmniBox = require("omnibox_sdk"); }
catch (_) { OmniBox = { log(l, m) { console.log(`[${l}] ${m}`); } }; }

// ==================== 账号配置（直接在这里填写你的 Jellyfin 信息）====================
const defaultAccounts = [
  {
    server: "", // 例：http://192.168.1.100:8096
    username: "", // Jellyfin 用户名
    password: "", // Jellyfin 密码
    name: "ServerName",
  },
];

let accounts = [...defaultAccounts];

// ==================== 设备配置 ====================
const DEVICE_PROFILE = {
  DeviceProfile: {
    SubtitleProfiles: [
      { Method: "Embed", Format: "ass" },
      { Format: "ssa", Method: "Embed" },
      { Format: "subrip", Method: "Embed" },
      { Format: "sub", Method: "Embed" },
      { Method: "Embed", Format: "pgssub" },
      { Format: "subrip", Method: "External" },
      { Method: "External", Format: "sub" },
      { Method: "External", Format: "ass" },
      { Format: "ssa", Method: "External" },
      { Method: "External", Format: "vtt" },
    ],
    CodecProfiles: [
      {
        Codec: "h264",
        Type: "Video",
        ApplyConditions: [
          { Property: "IsAnamorphic", Value: "true", Condition: "NotEquals", IsRequired: false },
          { IsRequired: false, Value: "high|main|baseline|constrained baseline", Condition: "EqualsAny", Property: "VideoProfile" },
          { IsRequired: false, Value: "80", Condition: "LessThanEqual", Property: "VideoLevel" },
          { IsRequired: false, Value: "true", Condition: "NotEquals", Property: "IsInterlaced" },
        ],
      },
      {
        Codec: "hevc",
        ApplyConditions: [
          { Property: "IsAnamorphic", Value: "true", Condition: "NotEquals", IsRequired: false },
          { IsRequired: false, Value: "high|main|main 10", Condition: "EqualsAny", Property: "VideoProfile" },
          { Property: "VideoLevel", Value: "175", Condition: "LessThanEqual", IsRequired: false },
          { IsRequired: false, Value: "true", Condition: "NotEquals", Property: "IsInterlaced" },
        ],
        Type: "Video",
      },
    ],
    MaxStreamingBitrate: 40000000,
    TranscodingProfiles: [
      {
        Container: "ts",
        AudioCodec: "aac,mp3,wav,ac3,eac3,flac,opus",
        VideoCodec: "hevc,h264,mpeg4",
        BreakOnNonKeyFrames: true,
        Type: "Video",
        MaxAudioChannels: "6",
        Protocol: "hls",
        Context: "Streaming",
        MinSegments: 2,
      },
    ],
    DirectPlayProfiles: [
      {
        Container: "mov,mp4,mkv,hls,webm",
        Type: "Video",
        VideoCodec: "h264,hevc,dvhe,dvh1,h264,hevc,hev1,mpeg4,vp9",
        AudioCodec: "aac,mp3,wav,ac3,eac3,flac,truehd,dts,dca,opus,pcm,pcm_s24le",
      },
    ],
    ResponseProfiles: [{ MimeType: "video/mp4", Type: "Video", Container: "m4v" }],
    ContainerProfiles: [],
    MusicStreamingTranscodingBitrate: 40000000,
    MaxStaticBitrate: 40000000,
  },
};

const axiosInstance = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  httpAgent: new http.Agent({ keepAlive: true }),
  validateStatus: (status) => status >= 200,
});

// ==================== 日志工具 ====================
const logInfo = (message, data = null) => {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("info", `[Jellyfin] ${output}`);
};

const logError = (message, error) => {
  OmniBox.log("error", `[Jellyfin] ${message}: ${error?.message || error}`);
};

// ==================== 基础工具 ====================
function cleanText(text) {
  return String(text || "").trim();
}

function parseExtendAccounts(extend) {
  if (!extend) return null;
  if (Array.isArray(extend)) return extend;
  try {
    const raw = Buffer.from(String(extend || ""), "base64").toString("utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {
    try {
      const parsed = JSON.parse(String(extend || ""));
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      logError("extend 参数解析失败", e);
    }
  }
  return null;
}

function normalizeServer(server) {
  const raw = String(server || "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function getImageUrl(baseUrl, itemId, imageTags) {
  if (!itemId || !imageTags?.Primary) return "";
  return `${baseUrl}/emby/Items/${itemId}/Images/Primary?maxWidth=400&tag=${imageTags.Primary}&quality=90`;
}

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 构建 Jellyfin 认证头
 * Jellyfin 使用 X-Emby-Authorization 格式（不是单独的 X-Emby-Client 等头）
 */
function buildAuthHeader(deviceId, token) {
  let header = `MediaBrowser Client="Jellyfin-OmniBox", Device="OmniBox", DeviceId="${deviceId}", Version="1.0.0"`;
  if (token) {
    header += `, Token="${token}"`;
  }
  return header;
}

async function requestJson(url, options, authToken) {
  const start = Date.now();
  try {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    if (authToken) {
      headers["X-Emby-Authorization"] = authToken;
    }
    const res = await axiosInstance.request({ url, ...options, headers });
    const cost = Date.now() - start;
    logInfo(`请求完成 ${url.substring(0, 120)}`, { status: res.status, cost: `${cost}ms` });
    if (res.status >= 400) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.data;
  } catch (error) {
    const cost = Date.now() - start;
    logError(`请求失败 ${url.substring(0, 120)} cost=${cost}ms`, error);
    throw error;
  }
}

/**
 * 解析复合 ID：accountIndex@itemId
 */
function parseId(compositeId) {
  const parts = String(compositeId || "").split("@", 2);
  if (parts.length !== 2) {
    throw new Error(`无效的复合ID格式: ${compositeId}`);
  }
  const accountIndex = parseInt(parts[0], 10);
  const itemId = parts[1];
  if (Number.isNaN(accountIndex) || accountIndex < 0 || accountIndex >= accounts.length) {
    throw new Error(`账号索引越界: ${accountIndex}, 总数: ${accounts.length}`);
  }
  return { account: accounts[accountIndex], accountIndex, itemId };
}

/**
 * Jellyfin 登录认证（含缓存）
 * 两层缓存：内存 + OmniBox 持久化，减少重复登录请求
 */
async function jellyfinLogin(account) {
  const baseUrl = normalizeServer(account.server);
  if (!baseUrl) throw new Error("Jellyfin 服务器地址未配置");

  const CACHE_PREFIX = "jf:login:";
  const CACHE_TTL = 86400 * 7; // 7 天

  // 内存缓存
  if (account._loginCache && account._loginCache.baseUrl === baseUrl) {
    return account._loginCache;
  }

  // 持久化缓存
  const cacheKey = `${CACHE_PREFIX}${baseUrl}_${account.username}`;
  try {
    const cached = await OmniBox.getCache(cacheKey);
    if (cached) {
      const p = JSON.parse(cached);
      // 快速验证 token 是否仍有效
      const testAuth = buildAuthHeader(p.deviceId, p.token);
      const test = await axiosInstance.get(`${baseUrl}/emby/Users/${p.userId}`, {
        headers: { "X-Emby-Authorization": testAuth, Accept: "application/json" },
        timeout: 3000,
      });
      if (test.status === 200) {
        logInfo("命中登录缓存");
        account._loginCache = { ...p, baseUrl, authHeader: testAuth };
        return account._loginCache;
      }
    }
  } catch (_) {}

  // 重新登录
  const deviceId = generateUUID();
  const authHeader = buildAuthHeader(deviceId);

  const data = await requestJson(
    `${baseUrl}/emby/Users/AuthenticateByName`,
    { method: "POST", data: { Username: account.username, Pw: account.password } },
    authHeader
  );

  const token = data.AccessToken;
  const userId = data.User.Id;
  const authedAuthHeader = buildAuthHeader(deviceId, token);

  const result = { token, userId, baseUrl, authHeader: authedAuthHeader, deviceId };
  account._loginCache = result;

  try { await OmniBox.setCache(cacheKey, JSON.stringify({ token, userId, deviceId }), CACHE_TTL); } catch (_) {}

  return result;
}

// ==================== Handler 实现 ====================

module.exports = { home, category, detail, search, play };
let runner;
try { runner = require("spider_runner"); }
catch (_) { runner = { run() {} }; }
runner.run(module.exports);

/**
 * 首页 - 获取 Jellyfin 媒体库列表
 * 返回所有已配置 Jellyfin 服务器的媒体库作为分类
 */
async function home(params) {
  logInfo("进入首页，开始获取媒体库列表");

  // 支持通过 extend 参数动态传入账号
  const externalAccounts = parseExtendAccounts(params.extend || params.ext || params.config);
  if (externalAccounts && externalAccounts.length > 0) {
    accounts = externalAccounts;
    logInfo("使用外部账号配置", { count: accounts.length });
  } else if (accounts.length === 0 || (accounts.length === 1 && !accounts[0].server)) {
    logError("未配置 Jellyfin 账号信息", new Error("请在脚本中填写服务器地址和账号密码"));
    return { class: [], list: [] };
  }

  const classList = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    try {
      if (!account.server) continue;
      const { userId, baseUrl, authHeader } = await jellyfinLogin(account);
      const url = `${baseUrl}/emby/Users/${userId}/Views`;
      const data = await requestJson(url, {}, authHeader);
      const typeInfos = data.Items || [];
      const accountName = account.name || `Server ${i + 1}`;

      // Jellyfin 的媒体库类型过滤：排除播放列表、相机上传等
      for (const typeInfo of typeInfos) {
        const name = typeInfo.Name || "";
        if (name.includes("播放列表") || name.includes("相机") || name.includes("Playlist") || name.includes("Camera")) {
          continue;
        }

        // 只保留视频相关的媒体库类型
        const collectionType = typeInfo.CollectionType || "";
        if (collectionType && !["movies", "tvshows", "mixed", "homevideos", "photos"].includes(collectionType)) {
          continue;
        }

        const compositeCid = `${i}@${typeInfo.Id}`;
        classList.push({
          type_id: compositeCid,
          type_name: `[${accountName}] ${name}`,
        });
      }

      logInfo(`服务器 ${accountName} 媒体库获取完成`, { count: typeInfos.length });
    } catch (e) {
      logError(`首页获取失败 ${account.name || `Server ${i + 1}`}`, e);
    }
  }

  return { class: classList, list: [] };
}

/**
 * 分类分页 - 获取媒体库中的视频列表
 */
async function category(params) {
  const categoryId = params.categoryId || params.type_id || params.t || "";
  const pg = Math.max(1, parseInt(params.page || params.pg || "1", 10));
  logInfo("请求分类列表", { categoryId, page: pg });

  try {
    const { account, itemId, accountIndex } = parseId(categoryId);
    const { userId, baseUrl, authHeader } = await jellyfinLogin(account);

    const url = `${baseUrl}/emby/Users/${userId}/Items`;
    const paramsQuery = {
      SortBy: "ProductionYear,SortName",
      IncludeItemTypes: "Movie,Series,BoxSet",
      SortOrder: "Descending",
      ParentId: itemId,
      Recursive: "true",
      Limit: "30",
      ImageTypeLimit: 1,
      StartIndex: String((pg - 1) * 30),
      EnableImageTypes: "Primary,Backdrop,Thumb,Banner",
      Fields: "BasicSyncInfo,CanDelete,Container,PrimaryImageAspectRatio,ProductionYear,CommunityRating,Status,CriticRating,EndDate,Path",
      EnableUserData: "true",
    };

    const data = await requestJson(`${url}?${new URLSearchParams(paramsQuery)}`, {}, authHeader);
    const videoList = data.Items || [];

    const list = videoList.map((video) => {
      const compositeVodId = `${accountIndex}@${video.Id}`;
      const year = video.ProductionYear ? String(video.ProductionYear) : "";
      const type_name = (video.Type === "Series" ? "剧集" : video.Type === "Movie" ? "电影" : "") || video.Type || "";
      return {
        vod_id: compositeVodId,
        vod_name: cleanText(video.Name),
        vod_pic: getImageUrl(baseUrl, video.Id, video.ImageTags),
        vod_remarks: year,
        type_name: type_name,
        vod_year: year,
      };
    });

    const total = data.TotalRecordCount || list.length;
    const pagecount = total > 0 ? Math.ceil(total / 30) : pg;

    return {
      list,
      page: pg,
      pagecount,
      total,
    };
  } catch (e) {
    logError("分类请求失败", e);
    return { list: [], page: pg, pagecount: 0, total: 0 };
  }
}

/**
 * 详情 - 获取视频/剧集详情和播放源
 * - 电影：直接返回单集
 * - 剧集：获取各季和各集
 */
async function detail(params) {
  const ids = params.ids || params.id || params.videoId || "";
  const idList = Array.isArray(ids)
    ? ids
    : String(ids)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  logInfo("请求详情", { ids: idList });
  const result = { list: [] };

  for (const id of idList) {
    try {
      const { account, itemId, accountIndex } = parseId(id);
      const { userId, baseUrl, authHeader } = await jellyfinLogin(account);

      // 获取视频基本信息（含媒体流、时长、评分）
      const infoUrl = `${baseUrl}/emby/Users/${userId}/Items/${itemId}?` +
        `Fields=BasicSyncInfo,CommunityRating,MediaStreams,Overview,People,Studios,RunTimeTicks,Path`;
      const info = await requestJson(infoUrl, {}, authHeader);

      const vod = {
        vod_id: id,
        vod_name: info.Name || "",
        vod_pic: getImageUrl(baseUrl, itemId, info.ImageTags),
        type_name: info.Type === "Series" ? "剧集" : info.Type === "Movie" ? "电影" : "",
        vod_year: info.ProductionYear ? String(info.ProductionYear) : "",
        vod_area: info.ProductionLocations ? info.ProductionLocations.join(",") : "",
        vod_content: (info.Overview || "").replace(/\xa0/g, " ").replace(/\n\n/g, "\n").trim(),
        vod_remarks: info.Status ? `${info.Status} ${info.ProductionYear || ""}`.trim() : (info.ProductionYear ? String(info.ProductionYear) : ""),
      };

      // 提取演员信息（取前 5 个）
      if (info.People && Array.isArray(info.People)) {
        const actors = info.People.filter(p => p.Type === "Actor" || p.Type === "Person").slice(0, 5);
        vod.vod_actor = actors.map(a => a.Name).filter(Boolean).join(",");
        const directors = info.People.filter(p => p.Type === "Director");
        vod.vod_director = directors.map(d => d.Name).filter(Boolean).join(",");
      }

      // 类型标签：取 genres 前几个作为补充，不覆盖"电影/剧集"
      if (info.Genres && Array.isArray(info.Genres) && info.Genres.length > 0) {
        const genres = info.Genres.slice(0, 5).join("/");
        if (vod.type_name) {
          vod.type_name = `${vod.type_name} ${genres}`;
        } else {
          vod.type_name = genres;
        }
      }

      // 音频语言
      if (info.MediaStreams && Array.isArray(info.MediaStreams)) {
        vod.vod_lang = Array.from(
          new Set(
            info.MediaStreams.filter(s => s.Type === "Audio" && s.Language).map(s => s.Language)
          )
        ).join(" / ");
      }

      // 时长
      if (info.RunTimeTicks) {
        const mins = Math.floor(info.RunTimeTicks / 600000000);
        const hours = Math.floor(mins / 60);
        vod.vod_time = hours > 0 ? `${hours}时${mins % 60}分` : `${mins}分`;
      }

      // 评分
      if (info.CommunityRating) {
        vod.vod_douban_score = String(info.CommunityRating);
      }

      // 构建播放源
      const playSources = [];

      if (!info.IsFolder) {
        // 非文件夹（电影、单视频）：直接作为一条线路
        const compositePid = `${accountIndex}@${info.Id}`;
        playSources.push({
          name: "Jellyfin",
          episodes: [{ name: cleanText(info.Name) || "正片", playId: compositePid }],
        });
      } else {
        // 文件夹（剧集）：获取各季和各集
        const seasonsUrl = `${baseUrl}/emby/Shows/${itemId}/Seasons`;
        const seasonParams = {
          UserId: userId,
          EnableImages: "true",
          Fields: "BasicSyncInfo,CanDelete,Container,PrimaryImageAspectRatio,ProductionYear,CommunityRating",
          EnableUserData: "true",
          EnableTotalRecordCount: "false",
        };

        try {
          // 获取所有季
          const seasonsData = await requestJson(`${seasonsUrl}?${new URLSearchParams(seasonParams)}`, {}, authHeader);
          const seasons = seasonsData.Items || [];

          for (const season of seasons) {
            // 跳过"无季"或空季
            if (!season.Id || season.Name === "无季" || season.Name === "No Season") continue;

            // 获取该季的所有剧集
            const episodesUrl = `${baseUrl}/emby/Shows/${season.Id}/Episodes`;
            const episodeParams = {
              SeasonId: season.Id,
              UserId: userId,
              Fields: "BasicSyncInfo,CanDelete,CommunityRating,PrimaryImageAspectRatio,ProductionYear,Overview",
            };

            const episodesData = await requestJson(`${episodesUrl}?${new URLSearchParams(episodeParams)}`, {}, authHeader);
            const episodes = (episodesData.Items || []).map((episode) => {
              const compositePid = `${accountIndex}@${episode.Id}`;
              return {
                name: `第${season.IndexNumber || ""}季 第${episode.IndexNumber || ""}集 ${cleanText(episode.Name) || ""}`.trim(),
                playId: compositePid,
              };
            });

            if (episodes.length > 0) {
              playSources.push({
                name: season.Name || `第${season.IndexNumber || seasons.indexOf(season) + 1}季`,
                episodes,
              });
            }
          }
        } catch (seasonError) {
          // 如果按季获取失败，退回到获取所有子项
          logError(`按季获取剧集失败，回退到子项列表`, seasonError);
          const itemsUrl = `${baseUrl}/emby/Users/${userId}/Items`;
          const itemsParams = {
            ParentId: itemId,
            Fields: "BasicSyncInfo,CanDelete,Container,PrimaryImageAspectRatio,ProductionYear,CommunityRating,CriticRating",
            ImageTypeLimit: "1",
            StartIndex: "0",
            EnableUserData: "true",
            IncludeItemTypes: "Episode",
            Recursive: "true",
            SortBy: "SortName",
          };

          const itemsData = await requestJson(`${itemsUrl}?${new URLSearchParams(itemsParams)}`, {}, authHeader);
          const episodes = (itemsData.Items || [])
            .filter((item) => !item.IsFolder)
            .map((item) => ({
              name: `第${item.ParentIndexNumber || ""}季 第${item.IndexNumber || ""}集 ${cleanText(item.Name) || ""}`.trim(),
              playId: `${accountIndex}@${item.Id}`,
            }));

          if (episodes.length > 0) {
            playSources.push({ name: "全部剧集", episodes });
          }
        }
      }

      vod.vod_play_sources = playSources;
      result.list.push(vod);
    } catch (e) {
      logError(`详情获取失败 id=${id}`, e);
      result.list.push({
        vod_id: id,
        vod_name: "获取详情失败",
        vod_play_sources: [],
      });
    }
  }

  return result;
}

/**
 * 搜索 - 在所有已配置的 Jellyfin 服务器中搜索
 */
async function search(params) {
  const keyword = params.keyword || params.wd || "";
  const pg = Math.max(1, parseInt(params.page || params.pg || "1", 10));
  logInfo("搜索", { keyword, page: pg });

  if (!keyword) {
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }

  const list = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    try {
      if (!account.server) continue;

      const { userId, baseUrl, authHeader } = await jellyfinLogin(account);

      const url = `${baseUrl}/emby/Users/${userId}/Items`;
      const paramsQuery = {
        SortBy: "SortName",
        SortOrder: "Ascending",
        Fields: "BasicSyncInfo,CanDelete,Container,PrimaryImageAspectRatio,ProductionYear,Status,EndDate",
        StartIndex: String((pg - 1) * 50),
        EnableImageTypes: "Primary,Backdrop,Thumb",
        ImageTypeLimit: "1",
        Recursive: "true",
        SearchTerm: keyword,
        IncludeItemTypes: "Movie,Series,BoxSet",
        GroupProgramsBySeries: "true",
        Limit: "50",
        EnableTotalRecordCount: "true",
      };

      const data = await requestJson(`${url}?${new URLSearchParams(paramsQuery)}`, {}, authHeader);
      const vodList = data.Items || [];
      const accountName = account.name || `Server ${i + 1}`;

      for (const vod of vodList) {
        const compositeVodId = `${i}@${vod.Id}`;
        list.push({
          vod_id: compositeVodId,
          vod_name: cleanText(vod.Name),
          vod_pic: getImageUrl(baseUrl, vod.Id, vod.ImageTags),
          vod_remarks: vod.ProductionYear ? String(vod.ProductionYear) : "",
          type_name: `[${accountName}]`,
        });
      }
    } catch (e) {
      logError(`搜索失败 ${account.name || `Server ${i + 1}`}`, e);
    }
  }

  return {
    list,
    page: pg,
    pagecount: pg,
    total: list.length,
  };
}

/**
 * 播放 - 获取 Jellyfin 视频的直接播放地址
 */
async function play(params, context) {
  const rawPlayId = params.playId || params.id || "";
  const from = context?.from || "web";
  logInfo("准备播放", { playId: rawPlayId, from });

  try {
    const { account, itemId } = parseId(rawPlayId);
    const { userId, baseUrl, authHeader, token } = await jellyfinLogin(account);

    // 方案一：先尝试通过 PlaybackInfo 获取直链
    try {
      const url = `${baseUrl}/emby/Items/${itemId}/PlaybackInfo?UserId=${encodeURIComponent(userId)}&IsPlayback=false&AutoOpenLiveStream=false`;
      const result = await requestJson(
        url,
        {
          method: "POST",
          data: DEVICE_PROFILE,
        },
        authHeader
      );

      const mediaSource = result?.MediaSources?.[0];
      if (mediaSource?.DirectStreamUrl) {
        let playUrl = mediaSource.DirectStreamUrl;
        if (playUrl.startsWith("/")) {
          playUrl = `${baseUrl}${playUrl}`;
        }
        logInfo("播放地址获取成功 (PlaybackInfo)");
        return {
          parse: 0,
          urls: [{ name: "播放", url: playUrl }],
          flag: "Jellyfin",
          header: { Referer: `${baseUrl}/` },
        };
      }
    } catch (e) {
      logError("PlaybackInfo 方式获取播放地址失败", e);
    }

    // 方案二：直接构造静态流地址（Jellyfin 常用）
    const staticUrl = `${baseUrl}/emby/Videos/${itemId}/stream?Static=true&api_key=${token}`;
    logInfo("播放地址 (静态流)", { url: staticUrl.substring(0, 80) });

    return {
      parse: 0,
      urls: [{ name: "播放", url: staticUrl }],
      flag: "Jellyfin",
      header: { Referer: `${baseUrl}/` },
    };
  } catch (e) {
    logError("播放解析失败", e);
    return {
      parse: 1,
      urls: [],
      flag: String(params.flag || "Jellyfin"),
      header: {},
      msg: `播放错误: ${e.message}`,
    };
  }
}
