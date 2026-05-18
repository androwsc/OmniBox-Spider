// @name 刮削拦截器
// @author OpenCode
// @description beforeDetail 做入参规范化，afterDetail 自动触发TMDB刮削并回填详情元数据
// @version 1.0.0
// @filter-stages detail_before,detail_after
// @filter-config-schema {"description":"beforeDetail 做详情入参规范化，afterDetail 对详情结果触发 TMDB 刮削并回填元数据","fields":[{"key":"forceRefresh","label":"强制刷新","type":"boolean","required":false,"placeholder":"忽略已有刮削结果重新刮削"},{"key":"normalizeVideoId","label":"规范化 videoId","type":"boolean","required":false,"placeholder":"默认开启"}]}

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

module.exports = { beforeDetail, afterDetail };
runner.run(module.exports);

/**
 * 作用: 从播放源名称推断网盘类型(参考木偶.js inferDriveTypeFromSourceName)
 */
function inferDriveType(name = "") {
  const raw = String(name).toLowerCase();
  if (raw.includes("百度")) return "baidu";
  if (raw.includes("天翼")) return "tianyi";
  if (raw.includes("夸克")) return "quark";
  if (raw === "uc" || raw.includes("uc")) return "uc";
  if (raw.includes("115")) return "115";
  if (raw.includes("迅雷")) return "xunlei";
  if (raw.includes("阿里")) return "ali";
  if (raw.includes("123")) return "123pan";
  return raw;
}

/**
 * 作用: 从剧集名称与文件列表中推测视频元数据映射(参考木偶.js buildScrapedFileName 思路)
 * 说明: 这是一个轻量级文件名解析器，不依赖外部刮削SDK
 */
function parseEpisodeFileName(fileName = "") {
  const cleaned = String(fileName)
    .replace(/\.[^.]+$/g, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const patterns = [
    /[sS](\d{1,2})\s*[eE](\d{1,2})/,
    /[sS]eason\s*(\d{1,2})\s*[eE]pisode\s*(\d{1,2})/i,
    /第\s*(\d{1,2})\s*季\s*第\s*(\d{1,2})\s*[集话]/,
    /[Ee](\d{1,2})/,
    /第\s*(\d{1,3})\s*[集话]/,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      if (match.length >= 3) {
        return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
      }
      return { season: 1, episode: parseInt(match[1], 10) };
    }
  }
  return { season: 1, episode: 0 };
}

function buildScrapedFileName(scrapeData, mapping, originalFileName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalFileName;
  }

  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    for (const episode of scrapeData.episodes) {
      if (episode.episodeNumber === mapping.episodeNumber && episode.seasonNumber === mapping.seasonNumber) {
        if (episode.name) {
          return `${episode.episodeNumber}.${episode.name}`;
        }
        break;
      }
    }
  }

  return originalFileName;
}

/**
 * 作用: 收集可刮削的视频文件列表(参考木偶.js buildMergedVideoFilesForScraping)
 */
function collectVideoFilesForScraping(item) {
  const fileList = [];
  const playSources = item?.vod_play_sources;
  if (!Array.isArray(playSources)) return fileList;

  for (const source of playSources) {
    const episodes = source?.episodes;
    if (!Array.isArray(episodes)) continue;
    for (const episode of episodes) {
      if (!episode?.playId) continue;
      fileList.push({
        file_name: episode.name || episode.rawName || "",
        fid: episode.playId,
        file_id: episode.playId,
        size: episode.size || 0,
      });
    }
  }
  return fileList;
}

function buildMergedVideoFilesForScraping(items = []) {
  const merged = [];
  const seen = new Set();

  for (const item of items) {
    const videoFiles = collectVideoFilesForScraping(item);
    for (const file of videoFiles) {
      const fileId = String(file?.file_id || file?.fid || "");
      if (!fileId || seen.has(fileId)) continue;
      seen.add(fileId);
      merged.push(file);
    }
  }

  return merged;
}

/**
 * 作用: 将刮削结果应用回视频项(参考木偶.js detail() 中构建vodDetail的逻辑)
 */
function applyScrapeData(item, scrapeData = {}, videoMappings = []) {
  const next = Object.assign({}, item);

  if (scrapeData.title) {
    next.vod_name = scrapeData.title;
  }
  if (scrapeData.overview && !next.vod_content) {
    next.vod_content = scrapeData.overview;
  }
  if (scrapeData.posterPath) {
    next.vod_pic = "https://image.tmdb.org/t/p/w500" + scrapeData.posterPath;
  }
  if (scrapeData.voteAverage) {
    next.vod_douban_score = String(scrapeData.voteAverage.toFixed(1));
  }
  if (scrapeData.releaseDate && !/^\d{4}$/.test(next.vod_year || "")) {
    next.vod_year = scrapeData.releaseDate.substring(0, 4);
  }

  const playSources = next.vod_play_sources;
  if (!Array.isArray(playSources)) return next;

  for (const source of playSources) {
    const episodes = source?.episodes;
    if (!Array.isArray(episodes)) continue;
    for (const episode of episodes) {
      const mapping = videoMappings.find(
        (m) => m && m.fileId === episode.playId
      );
      if (!mapping) continue;
      const renamedEpisode = buildScrapedFileName(scrapeData, mapping, episode.name || episode.rawName || "");
      if (renamedEpisode) {
        episode.name = renamedEpisode;
      }
      if (mapping.seasonNumber !== undefined) {
        episode._seasonNumber = mapping.seasonNumber;
      }
      if (mapping.episodeNumber !== undefined) {
        episode._episodeNumber = mapping.episodeNumber;
      }
      if (mapping.episodeName) episode.episodeName = mapping.episodeName;
      if (mapping.episodeOverview) episode.episodeOverview = mapping.episodeOverview;
      if (mapping.episodeAirDate) episode.episodeAirDate = mapping.episodeAirDate;
      if (mapping.episodeStillPath) episode.episodeStillPath = mapping.episodeStillPath;
      if (mapping.episodeVoteAverage !== undefined) episode.episodeVoteAverage = mapping.episodeVoteAverage;
      if (mapping.episodeRuntime !== undefined) episode.episodeRuntime = mapping.episodeRuntime;
    }
  }
  return next;
}

/**
 * 作用: 拦截详情返回结果，为每个影片触发TMDB刮削(参考木偶.js detail() 中的刮削调用)
 */
async function beforeDetail(params) {
  const next = Object.assign({}, params?.params || {});
  const extend = params?.extend || {};
  const normalizeVideoId = extend.normalizeVideoId !== false;

  if (normalizeVideoId && next.videoId !== undefined && next.videoId !== null) {
    const normalizedVideoId = String(next.videoId).trim();
    if (normalizedVideoId !== next.videoId) {
      await OmniBox.log("info", `刮削拦截器(beforeDetail): 规范化 videoId -> ${normalizedVideoId}`);
    }
    next.videoId = normalizedVideoId;
  }

  if (next.source !== undefined && next.source !== null) {
    next.source = String(next.source).trim();
  }

  return next;
}

async function afterDetail(params) {
  const data = params?.data || {};
  const extend = params?.extend || {};
  const forceRefresh = Boolean(extend.forceRefresh);

  if (!Array.isArray(data.list) || data.list.length === 0) {
    return data;
  }

  const scrapeItems = data.list.filter((item) => item && typeof item === "object" && item.vod_id);
  const primaryItem = scrapeItems.find((item) => collectVideoFilesForScraping(item).length > 0);

  if (!primaryItem) {
    return data;
  }

  const videoId = String(primaryItem.vod_id || "");
  const vodName = String(primaryItem.vod_name || "");
  const mergedVideoFiles = buildMergedVideoFilesForScraping(scrapeItems);

  if (!videoId || mergedVideoFiles.length === 0) {
    return data;
  }

  let metadata = null;

  try {
    let scrapeCompleted = false;

    if (!forceRefresh) {
      try {
        const existing = await OmniBox.getScrapeMetadata(videoId);
        if (existing?.scrapeData && existing.scrapeData.title) {
          metadata = existing;
          scrapeCompleted = true;
          await OmniBox.log("info", "刮削拦截器: 命中已有刮削数据 videoId=" + videoId);
        }
      } catch (_) { /* 忽略缓存读取错误 */ }
    }

    if (!scrapeCompleted) {
      await OmniBox.log("info", "刮削拦截器: 开始统一刮削 videoId=" + videoId + " 文件数=" + mergedVideoFiles.length + " 条目数=" + scrapeItems.length);
      await OmniBox.processScraping(videoId, vodName, vodName, mergedVideoFiles);
      metadata = await OmniBox.getScrapeMetadata(videoId);
    }
  } catch (error) {
    await OmniBox.log("warn", "刮削拦截器: 统一刮削失败 videoId=" + videoId + " " + error.message);
    return data;
  }

  if (!metadata?.scrapeData || !metadata.scrapeData.title) {
    return data;
  }

  await OmniBox.log("info", "刮削拦截器: 统一刮削成功 videoId=" + videoId + " 标题=" + metadata.scrapeData.title);

  const results = [];
  for (const item of data.list) {
    if (!item || typeof item !== "object") {
      results.push(item);
      continue;
    }
    results.push(applyScrapeData(item, metadata.scrapeData, metadata.videoMappings || []));
  }

  data.list = results;
  return data;
}
