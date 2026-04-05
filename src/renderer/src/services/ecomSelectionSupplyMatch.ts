type EcomCollectRunner = (data: Record<string, unknown>) => Promise<{
  success: boolean;
  status?: string;
  data?: {
    records?: Array<Record<string, any>>;
    snapshots?: Array<Record<string, any>>;
    summary?: Record<string, any> | null;
    debugMeta?: Record<string, any> | null;
  };
  message?: string;
}>;

interface ExecuteSupplyMatchOptions {
  runId: string;
  taskId: string;
  matchType?: string;
  sourceProducts: Array<Record<string, any>>;
  sourceSummary?: Record<string, any> | null;
  optionsData?: Record<string, any> | null;
  timeoutMs?: number;
  workspaceDir?: string;
  runCollect: EcomCollectRunner;
}

interface SupplyMatchOptions {
  supplierPlatforms: string[];
  maxSourceItems: number;
  maxMatchesPerSource: number;
  maxDetailPerSource: number;
  maxSearchItemsPerQuery: number;
  queryCount: number;
  captureSnapshots: boolean;
}

function normalizeText(value: unknown) {
  if (value == null) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeOptions(
  input: Record<string, any> | null | undefined,
): SupplyMatchOptions {
  const supplierPlatforms = Array.from(
    new Set(
      (Array.isArray(input?.supplierPlatforms)
        ? input.supplierPlatforms
        : ["1688"]
      )
        .map((item) => normalizeText(item))
        .filter(Boolean),
    ),
  );

  return {
    supplierPlatforms: supplierPlatforms.length ? supplierPlatforms : ["1688"],
    maxSourceItems: clampNumber(input?.maxSourceItems, 1, 20, 5),
    maxMatchesPerSource: clampNumber(input?.maxMatchesPerSource, 1, 20, 5),
    maxDetailPerSource: clampNumber(input?.maxDetailPerSource, 0, 10, 3),
    maxSearchItemsPerQuery: clampNumber(
      input?.maxSearchItemsPerQuery,
      1,
      20,
      8,
    ),
    queryCount: clampNumber(input?.queryCount, 1, 6, 3),
    captureSnapshots: normalizeBoolean(input?.captureSnapshots, false),
  };
}

function normalizeSourceProduct(input: Record<string, any>) {
  const attributes =
    input?.attributes && typeof input.attributes === "object"
      ? Object.entries(input.attributes).reduce(
          (result, [key, value]) => {
            const text = normalizeText(value);
            if (text) {
              result[key] = text;
            }
            return result;
          },
          {} as Record<string, string>,
        )
      : {};

  return {
    sourceRecordId: normalizeText(input?.sourceRecordId || input?.id),
    analysisRunId: normalizeText(input?.analysisRunId),
    sourcePlatform: normalizeText(input?.sourcePlatform || input?.platform),
    sourceTitle: normalizeText(input?.sourceTitle || input?.title),
    sourceUrl: normalizeText(input?.sourceUrl || input?.url),
    brand: normalizeText(input?.brand),
    priceText: normalizeText(input?.priceText),
    imageUrl: normalizeText(input?.imageUrl),
    summaryText: normalizeText(input?.summaryText),
    attributes,
  };
}

function extractPriceValue(value: unknown) {
  const normalized = normalizeText(value).replace(/,/g, "");
  if (!normalized) {
    return null;
  }
  const matched = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!matched) {
    return null;
  }
  const numeric = Number(matched[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractCjkTokens(text: string, limit = 16) {
  const phrases = text.match(/[\u3400-\u9fff]{2,}/g) || [];
  const tokens: string[] = [];

  phrases.forEach((phrase) => {
    if (tokens.length >= limit) {
      return;
    }

    tokens.push(phrase);
    if (phrase.length > 4) {
      for (let size = 2; size <= Math.min(4, phrase.length); size += 1) {
        for (let index = 0; index <= phrase.length - size; index += 1) {
          tokens.push(phrase.slice(index, index + size));
          if (tokens.length >= limit) {
            return;
          }
        }
      }
    }
  });

  return tokens.slice(0, limit);
}

function extractKeywordTokens(text: string, limit = 30) {
  const normalized = normalizeText(text).toLowerCase();
  const englishTokens = normalized.match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) || [];
  const cjkTokens = extractCjkTokens(normalized, limit);
  const stopWords = new Set([
    "amazon",
    "amazon.com",
    "basics",
    "pagetitle",
    "title",
    "about",
    "item",
    "items",
    "office",
    "product",
    "products",
    "support",
    "the",
    "and",
    "with",
    "for",
    "new",
    "sale",
    "pack",
    "set",
    "piece",
    "pieces",
    "pcs",
    "款",
    "新款",
    "批发",
    "厂家",
    "现货",
    "热卖",
    "包邮",
  ]);

  return Array.from(
    new Set(
      [...englishTokens, ...cjkTokens]
        .map((item) => item.trim())
        .filter(
          (item) =>
            item.length >= 2 &&
            !stopWords.has(item) &&
            !/^\d+(?:\.\d+)?$/.test(item) &&
            !/^[x×]+$/i.test(item),
        ),
    ),
  ).slice(0, limit);
}

function truncateQuery(text: string, maxLength = 80) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength).trim();
}

function stripQueryNoise(text: string) {
  return normalizeText(text)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[a-z0-9.-]+\.(?:com|cn|net|org|co|uk|de|jp)\b/gi, " ")
    .replace(/amazon\s*basics/gi, " ")
    .replace(
      /\b(?:amazon|basics|alibaba|1688|pagetitle|title|about|item|office|products?)\b/gi,
      " ",
    )
    .replace(/不规则|异形/g, " ")
    .replace(/关于该商品|查看更多商品信息|办公用品|阿里巴巴|批发|供应/g, " ")
    .replace(/（[^）]*）|\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\b(?:cm|mm|in|inch|oz|lb|kg)\b/gi, " ")
    .replace(/[|]+/g, " ")
    .replace(/[/:]+/g, " ")
    .replace(/\s*x\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitQuerySegments(text: string) {
  return stripQueryNoise(text)
    .split(/[，,、;；|/]+/)
    .map((item) => normalizeText(item))
    .filter((item) => {
      if (!item || item.length < 2 || item.length > 40) {
        return false;
      }
      if (/^\d+(?:\.\d+)?$/.test(item)) {
        return false;
      }
      if (/^(?:黑色|白色|灰色|红色|蓝色|粉色|绿色|黄色|紫色)$/.test(item)) {
        return false;
      }
      return true;
    });
}

function containsCjk(text: string) {
  return /[\u3400-\u9fff]/.test(text);
}

function shortenCjkSegment(text: string, maxLength = 14) {
  const normalized = stripQueryNoise(text).replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(-maxLength);
}

function pickPreferredSegments(segments: string[], limit = 4) {
  const picked: string[] = [];

  for (const segment of segments) {
    const normalized = normalizeText(segment);
    if (!normalized) {
      continue;
    }

    const existingIndex = picked.findIndex(
      (item) => item.includes(normalized) || normalized.includes(item),
    );
    if (existingIndex >= 0) {
      if (normalized.length > picked[existingIndex].length) {
        picked.splice(existingIndex, 1, normalized);
      }
      continue;
    }

    picked.push(normalized);
    if (picked.length >= limit) {
      break;
    }
  }

  return picked;
}

function buildSearchQueries(
  source: ReturnType<typeof normalizeSourceProduct>,
  queryCount: number,
) {
  const title = normalizeText(source.sourceTitle);
  const cleanedTitle = normalizeText(
    title.replace(/（[^）]*）|\([^)]*\)|\[[^\]]*\]/g, " "),
  );
  const baseTokens = extractKeywordTokens(
    [
      cleanedTitle,
      source.brand,
      Object.values(source.attributes || {}).join(" "),
      source.summaryText,
    ].join(" "),
    12,
  );
  const attributeTokens = extractKeywordTokens(
    Object.values(source.attributes || {}).join(" "),
    8,
  );
  const titleSegments = pickPreferredSegments(
    splitQuerySegments(cleanedTitle),
    4,
  );
  const summarySegments = pickPreferredSegments(
    splitQuerySegments(source.summaryText),
    6,
  );
  const attributeSegments = pickPreferredSegments(
    Object.values(source.attributes || {}).flatMap((item) =>
      splitQuerySegments(String(item || "")),
    ),
    4,
  );
  const primaryCjkSegment = containsCjk(cleanedTitle)
    ? shortenCjkSegment(titleSegments[0] || cleanedTitle)
    : "";
  const featureSegments = pickPreferredSegments(
    [...titleSegments.slice(1), ...summarySegments, ...attributeSegments].map(
      (item) => (containsCjk(item) ? shortenCjkSegment(item, 12) : item),
    ),
    6,
  ).filter((item) => item !== primaryCjkSegment);
  const compactCjkQueries = primaryCjkSegment
    ? [
        [primaryCjkSegment, featureSegments[0]].filter(Boolean).join(" "),
        [primaryCjkSegment, featureSegments[1]].filter(Boolean).join(" "),
        primaryCjkSegment,
      ]
    : [];

  const candidates = [
    ...compactCjkQueries,
    title,
    cleanedTitle,
    [source.brand, ...baseTokens.slice(0, 6)].filter(Boolean).join(" "),
    [...baseTokens.slice(0, 5), ...attributeTokens.slice(0, 3)].join(" "),
    source.summaryText,
  ]
    .map((item) => truncateQuery(stripQueryNoise(item), 80))
    .filter(Boolean)
    .filter((item) => {
      if (containsCjk(item)) {
        return item.replace(/\s+/g, "").length >= 4;
      }
      return item.split(/\s+/).length >= 2;
    });

  return Array.from(new Set(candidates)).slice(0, queryCount);
}

function buildCandidateKey(platform: string, record: Record<string, any>) {
  return (
    normalizeText(record?.supplierRecordKey || record?.recordKey) ||
    normalizeText(record?.supplierUrl || record?.sourceUrl || record?.url) ||
    `${normalizeText(platform)}::${normalizeText(record?.title)}`
  );
}

function mergeSnapshots(
  target: Array<Record<string, any>>,
  incoming: Array<Record<string, any>>,
) {
  const seen = new Set(
    target.map(
      (item) =>
        `${normalizeText(item?.path)}::${normalizeText(item?.stage)}::${normalizeText(item?.url)}`,
    ),
  );

  incoming.forEach((item) => {
    const key = `${normalizeText(item?.path)}::${normalizeText(item?.stage)}::${normalizeText(item?.url)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    target.push(item);
  });
}

function buildSupplierText(candidate: Record<string, any>) {
  return [
    candidate.title,
    candidate.shopName,
    candidate.listingData?.subtitle,
    candidate.listingData?.cardText,
    candidate.detailData?.descriptionText,
    candidate.detailData?.bulletPointsText,
    candidate.detailData?.specSummaryText,
    Array.isArray(candidate.detailData?.bulletPoints)
      ? candidate.detailData.bulletPoints.join(" ")
      : "",
    Array.isArray(candidate.detailData?.specPairs)
      ? candidate.detailData.specPairs
          .map((item: Record<string, any>) =>
            `${normalizeText(item?.label)} ${normalizeText(item?.value)}`.trim(),
          )
          .join(" ")
      : "",
  ].join(" ");
}

function computeMatchScore(
  source: ReturnType<typeof normalizeSourceProduct>,
  candidate: Record<string, any>,
) {
  const sourceTokens = extractKeywordTokens(
    [
      source.sourceTitle,
      source.brand,
      source.summaryText,
      Object.values(source.attributes || {}).join(" "),
    ].join(" "),
    24,
  );
  const supplierText = buildSupplierText(candidate);
  const supplierTokens = extractKeywordTokens(supplierText, 36);
  const supplierTokenSet = new Set(supplierTokens);
  const sharedTokens = sourceTokens.filter((token) =>
    supplierTokenSet.has(token),
  );

  const sourceBrand = normalizeText(source.brand).toLowerCase();
  const supplierTextLower = supplierText.toLowerCase();
  const brandMatched = !!sourceBrand && supplierTextLower.includes(sourceBrand);

  const sourceModelTokens = sourceTokens.filter(
    (token) => /\d/.test(token) || token.length >= 4,
  );
  const modelMatches = sourceModelTokens.filter((token) =>
    supplierTokenSet.has(token),
  );

  const attributeTokens = extractKeywordTokens(
    Object.values(source.attributes || {}).join(" "),
    12,
  );
  const attributeMatches = attributeTokens.filter((token) =>
    supplierTokenSet.has(token),
  );

  const sourcePrice = extractPriceValue(source.priceText);
  const supplierPrice = extractPriceValue(
    candidate.priceText || candidate.detailData?.priceText,
  );

  let score = 0;
  const overlapRatio = sourceTokens.length
    ? sharedTokens.length / sourceTokens.length
    : 0;
  score += overlapRatio * 60;
  score += brandMatched ? 15 : 0;
  score += Math.min(12, modelMatches.length * 6);
  score += Math.min(10, attributeMatches.length * 4);
  score += candidate.detailData ? 5 : 0;

  if (
    sourcePrice != null &&
    supplierPrice != null &&
    sourcePrice > 0 &&
    supplierPrice > 0
  ) {
    if (supplierPrice <= sourcePrice * 1.2) {
      score += 6;
    } else if (supplierPrice <= sourcePrice * 1.6) {
      score += 3;
    } else {
      score -= 4;
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    comparison: {
      overlapRatio: Number(overlapRatio.toFixed(4)),
      sharedTokens: sharedTokens.slice(0, 20),
      brandMatched,
      modelMatches,
      attributeMatches,
      sourcePrice,
      supplierPrice,
      hasDetailData: !!candidate.detailData,
    },
  };
}

function buildListingCandidate(params: {
  source: ReturnType<typeof normalizeSourceProduct>;
  supplierPlatform: string;
  query: string;
  queryIndex: number;
  listingRecord: Record<string, any>;
  searchSnapshots: Array<Record<string, any>>;
}) {
  const {
    source,
    supplierPlatform,
    query,
    queryIndex,
    listingRecord,
    searchSnapshots,
  } = params;

  const candidate = {
    analysisRunId: source.analysisRunId || null,
    sourceRecordId: source.sourceRecordId || null,
    sourcePlatform: source.sourcePlatform || null,
    sourceTitle: source.sourceTitle || null,
    sourceUrl: source.sourceUrl || null,
    supplierPlatform,
    supplierRecordKey:
      normalizeText(
        listingRecord?.recordKey || listingRecord?.supplierRecordKey,
      ) || null,
    supplierUrl:
      normalizeText(listingRecord?.sourceUrl || listingRecord?.supplierUrl) ||
      null,
    sourceQuery: query,
    queryIndex,
    title: normalizeText(listingRecord?.title) || null,
    priceText: normalizeText(listingRecord?.priceText) || null,
    shopName: normalizeText(listingRecord?.shopName) || null,
    imageUrl: normalizeText(listingRecord?.imageUrl) || null,
    capturedAt:
      normalizeText(listingRecord?.capturedAt) || new Date().toISOString(),
    listingData: {
      ...listingRecord,
      sourceQuery: query,
      queryIndex,
    },
    detailData: null as Record<string, any> | null,
    comparisonData: {
      sourceQuery: query,
      queryIndex,
      queryHistory: [query],
      searchStatus: "success",
    },
    rawPayload: {
      listingRecord,
      detailRecord: null,
    },
    snapshotData: {
      listing: [...searchSnapshots],
      detail: [],
    },
    matchScore: 0,
    matchRank: null as number | null,
  };

  const scoreResult = computeMatchScore(source, candidate);
  candidate.matchScore = scoreResult.score;
  candidate.comparisonData = {
    ...candidate.comparisonData,
    ...scoreResult.comparison,
  };

  return candidate;
}

function mergeCandidate(
  existing: Record<string, any>,
  incoming: Record<string, any>,
) {
  return {
    ...existing,
    supplierRecordKey: existing.supplierRecordKey || incoming.supplierRecordKey,
    supplierUrl: existing.supplierUrl || incoming.supplierUrl,
    title: existing.title || incoming.title,
    priceText: existing.priceText || incoming.priceText,
    shopName: existing.shopName || incoming.shopName,
    imageUrl: existing.imageUrl || incoming.imageUrl,
    listingData: existing.listingData || incoming.listingData,
    rawPayload: {
      ...(existing.rawPayload || {}),
      ...(incoming.rawPayload || {}),
    },
    snapshotData: {
      listing: [
        ...(Array.isArray(existing.snapshotData?.listing)
          ? existing.snapshotData.listing
          : []),
        ...(Array.isArray(incoming.snapshotData?.listing)
          ? incoming.snapshotData.listing
          : []),
      ],
      detail: Array.isArray(existing.snapshotData?.detail)
        ? existing.snapshotData.detail
        : [],
    },
    comparisonData: {
      ...(existing.comparisonData || {}),
      queryHistory: Array.from(
        new Set(
          [
            ...(Array.isArray(existing.comparisonData?.queryHistory)
              ? existing.comparisonData.queryHistory
              : []),
            normalizeText(incoming.sourceQuery),
          ].filter(Boolean),
        ),
      ),
    },
    matchScore: Math.max(
      Number(existing.matchScore) || 0,
      Number(incoming.matchScore) || 0,
    ),
  };
}

function sortCandidates(list: Array<Record<string, any>>) {
  return [...list].sort((left, right) => {
    const scoreDiff =
      (Number(right.matchScore) || 0) - (Number(left.matchScore) || 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const detailDiff =
      Number(Boolean(right.detailData)) - Number(Boolean(left.detailData));
    if (detailDiff !== 0) {
      return detailDiff;
    }

    return (
      (Number(left.queryIndex) || Number.MAX_SAFE_INTEGER) -
      (Number(right.queryIndex) || Number.MAX_SAFE_INTEGER)
    );
  });
}

function buildSubRunId(
  rootRunId: string,
  sourceRecordId: string,
  platform: string,
  scene: string,
  suffix: string,
) {
  const sanitized =
    `${rootRunId}-${sourceRecordId || "source"}-${platform}-${scene}-${suffix}`
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 120);
  return sanitized || `${rootRunId}-${platform}-${scene}`;
}

function getRemainingTimeout(deadline: number) {
  return Math.max(60_000, deadline - Date.now());
}

function ensureRemainingTime(deadline: number, label: string) {
  if (Date.now() >= deadline) {
    throw new Error(`同款匹配执行超时: ${label}`);
  }
}

export async function executeEcomSelectionSupplyMatchTask(
  options: ExecuteSupplyMatchOptions,
) {
  const runId = normalizeText(options.runId);
  const taskId = normalizeText(options.taskId);
  const matchType = normalizeText(options.matchType) || "supply_match";
  const normalizedOptions = normalizeOptions(options.optionsData);
  const normalizedSources = (
    Array.isArray(options.sourceProducts) ? options.sourceProducts : []
  )
    .map((item) => normalizeSourceProduct(item || {}))
    .filter((item) => item.sourceTitle || item.sourceUrl)
    .slice(0, normalizedOptions.maxSourceItems);

  if (!runId) {
    throw new Error("缺少 runId");
  }
  if (!normalizedSources.length) {
    throw new Error("缺少可执行的来源商品");
  }

  const timeoutMs = Math.max(
    5 * 60_000,
    Number(options.timeoutMs) || 30 * 60_000,
  );
  const deadline = Date.now() + timeoutMs;
  const allSnapshots: Array<Record<string, any>> = [];
  const matchedItems: Array<Record<string, any>> = [];
  const sourceResults: Array<Record<string, any>> = [];
  let searchAttemptCount = 0;
  let detailAttemptCount = 0;

  for (const source of normalizedSources) {
    ensureRemainingTime(deadline, source.sourceTitle || source.sourceRecordId);

    const queries = buildSearchQueries(source, normalizedOptions.queryCount);
    const sourceResult = {
      sourceRecordId: source.sourceRecordId || null,
      sourceTitle: source.sourceTitle || null,
      supplierResults: [] as Array<Record<string, any>>,
      matchedCount: 0,
    };

    for (const supplierPlatform of normalizedOptions.supplierPlatforms) {
      const candidateMap = new Map<string, Record<string, any>>();
      const platformResult = {
        supplierPlatform,
        queries: [] as Array<Record<string, any>>,
        searchResultCount: 0,
        detailAttemptCount: 0,
        matchedCount: 0,
      };

      for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
        const query = queries[queryIndex];
        if (!query) {
          continue;
        }

        ensureRemainingTime(deadline, `${supplierPlatform} search`);
        searchAttemptCount += 1;

        const searchResponse = await options.runCollect({
          runId: buildSubRunId(
            runId,
            source.sourceRecordId || source.sourceTitle,
            supplierPlatform,
            "search",
            String(queryIndex + 1),
          ),
          taskId,
          platform: supplierPlatform,
          collectScene: "search",
          workspaceDir: options.workspaceDir || "",
          timeoutMs: getRemainingTimeout(deadline),
          configData: {
            keyword: query,
            keywords: [query],
            maxPages: 1,
            maxItems: normalizedOptions.maxSearchItemsPerQuery,
            captureSnapshots: normalizedOptions.captureSnapshots,
          },
        });

        const querySnapshots = Array.isArray(searchResponse.data?.snapshots)
          ? searchResponse.data.snapshots
          : [];
        mergeSnapshots(allSnapshots, querySnapshots);

        const records = Array.isArray(searchResponse.data?.records)
          ? searchResponse.data.records
          : [];
        platformResult.searchResultCount += records.length;
        platformResult.queries.push({
          query,
          queryIndex: queryIndex + 1,
          status:
            searchResponse.status ||
            (searchResponse.success ? "success" : "failed"),
          success: searchResponse.success,
          message: searchResponse.message || "",
          recordsCount: records.length,
        });

        records.forEach((record) => {
          const candidate = buildListingCandidate({
            source,
            supplierPlatform,
            query,
            queryIndex: queryIndex + 1,
            listingRecord: record,
            searchSnapshots: querySnapshots,
          });
          const key = buildCandidateKey(supplierPlatform, candidate);
          const existing = candidateMap.get(key);
          candidateMap.set(
            key,
            existing ? mergeCandidate(existing, candidate) : candidate,
          );
        });
      }

      let rankedCandidates = sortCandidates(Array.from(candidateMap.values()));
      const detailLimit = Math.min(
        normalizedOptions.maxDetailPerSource,
        rankedCandidates.length,
      );

      for (let index = 0; index < detailLimit; index += 1) {
        const candidate = rankedCandidates[index];
        const targetUrl = normalizeText(candidate?.supplierUrl);
        if (!targetUrl) {
          continue;
        }

        ensureRemainingTime(deadline, `${supplierPlatform} detail`);
        detailAttemptCount += 1;
        platformResult.detailAttemptCount += 1;

        const detailResponse = await options.runCollect({
          runId: buildSubRunId(
            runId,
            source.sourceRecordId || source.sourceTitle,
            supplierPlatform,
            "detail",
            String(index + 1),
          ),
          taskId,
          platform: supplierPlatform,
          collectScene: "product_detail",
          workspaceDir: options.workspaceDir || "",
          timeoutMs: getRemainingTimeout(deadline),
          configData: {
            targetUrl,
            captureSnapshots: normalizedOptions.captureSnapshots,
          },
        });

        const detailSnapshots = Array.isArray(detailResponse.data?.snapshots)
          ? detailResponse.data.snapshots
          : [];
        mergeSnapshots(allSnapshots, detailSnapshots);

        const detailRecord = Array.isArray(detailResponse.data?.records)
          ? detailResponse.data.records?.[0] || null
          : null;
        if (detailRecord && typeof detailRecord === "object") {
          candidate.detailData = {
            ...detailRecord,
            status:
              detailResponse.status ||
              (detailResponse.success ? "success" : "failed"),
          };
          candidate.rawPayload = {
            ...(candidate.rawPayload || {}),
            detailRecord,
          };
          candidate.snapshotData = {
            ...(candidate.snapshotData || {}),
            detail: detailSnapshots,
          };
          candidate.title =
            candidate.title || normalizeText(detailRecord.title) || null;
          candidate.priceText =
            candidate.priceText ||
            normalizeText(detailRecord.priceText) ||
            null;
          candidate.shopName =
            candidate.shopName || normalizeText(detailRecord.shopName) || null;
          candidate.imageUrl =
            candidate.imageUrl || normalizeText(detailRecord.imageUrl) || null;
        } else {
          candidate.detailData = {
            status:
              detailResponse.status ||
              (detailResponse.success ? "success" : "failed"),
            message: detailResponse.message || "",
          };
        }

        const rescored = computeMatchScore(source, candidate);
        candidate.matchScore = rescored.score;
        candidate.comparisonData = {
          ...(candidate.comparisonData || {}),
          detailStatus:
            detailResponse.status ||
            (detailResponse.success ? "success" : "failed"),
          detailMessage: detailResponse.message || "",
          ...rescored.comparison,
        };
      }

      rankedCandidates = sortCandidates(Array.from(candidateMap.values()))
        .slice(0, normalizedOptions.maxMatchesPerSource)
        .map((item, index) => ({
          ...item,
          matchRank: index + 1,
        }));

      platformResult.matchedCount = rankedCandidates.length;
      rankedCandidates.forEach((item) => {
        matchedItems.push(item);
      });
      sourceResult.supplierResults.push(platformResult);
    }

    sourceResult.matchedCount = matchedItems.filter(
      (item) =>
        normalizeText(item?.sourceRecordId) === source.sourceRecordId &&
        normalizeText(item?.sourceTitle) === source.sourceTitle,
    ).length;
    sourceResults.push(sourceResult);
  }

  return {
    success: true,
    status: "success",
    message:
      matchedItems.length > 0 ? "同款匹配完成" : "同款匹配完成，未找到有效同款",
    data: {
      runId,
      taskId,
      matchType,
      matchedItems: sortCandidates(matchedItems),
      snapshots: allSnapshots,
      summary: {
        sourceSummary: options.sourceSummary || null,
        totalSources: normalizedSources.length,
        matchedSources: sourceResults.filter((item) => item.matchedCount > 0)
          .length,
        matchedItemsCount: matchedItems.length,
        supplierPlatforms: normalizedOptions.supplierPlatforms,
        searchAttemptCount,
        detailAttemptCount,
        captureSnapshots: normalizedOptions.captureSnapshots,
        finishedAt: new Date().toISOString(),
      },
      debugMeta: {
        timeoutMs,
        supplierPlatforms: normalizedOptions.supplierPlatforms,
        sourceResults,
      },
    },
  };
}
