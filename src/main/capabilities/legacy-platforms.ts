import { z } from "zod";
import { CapabilityRegistry } from "./registry";
import type { CapabilityDefinition } from "./types";
import * as legacy51jobModule from "../51job";
import * as apnewsModule from "../apnews";
import * as arstechnicarssModule from "../arstechnicarss";
import * as bbcsportModule from "../bbc_sport";
import * as bbctechnologyModule from "../bbctechnology";
import * as billboardModule from "../billboard";
import * as chinamoneyModule from "../chinamoney";
import * as clstelegraphModule from "../cls_telegraph";
import * as coinmarketcapModule from "../coinmarketcap";
import * as deadlineModule from "../deadline";
import * as doubanmovieModule from "../douban_movie";
import * as doubanbookModule from "../douban_book";
import * as doubangalleryModule from "../douban_gallery";
import * as eastmoneyModule from "../eastmoney";
import * as engadgetModule from "../engadget";
import * as flashscoreModule from "../flashscore";
import * as guardiantechnologyModule from "../guardiantechnology";
import * as hollywoodreporterModule from "../hollywood_reporter";
import * as hupuModule from "../hupu";
import * as ignModule from "../ign";
import * as jiqizhixinModule from "../jiqizhixin";
import * as lagouModule from "../lagou";
import * as linkedinjobsModule from "../linkedin_jobs";
import * as medrxivModule from "../medrxiv";
import * as mittechreviewrssModule from "../mittechreviewrss";
import * as natureModule from "../nature";
import * as nprtechnologyModule from "../nprtechnology";
import * as ourworldindataModule from "../ourworldindata";
import * as physorgModule from "../physorg";
import * as polygonModule from "../polygon";
import * as quantamagazineModule from "../quantamagazine";
import * as scienceaaasModule from "../scienceaaas";
import * as sciencedailyModule from "../sciencedaily";
import * as sinafinanceModule from "../sina_finance";
import * as spacecomModule from "../spacecom";
import * as sseModule from "../sse";
import * as sspaiModule from "../sspai";
import * as statsgovModule from "../stats_gov";
import * as techcrunchrssModule from "../techcrunchrss";
import * as thevergerssModule from "../thevergerss";
import * as timeModule from "../time";
import * as tmzModule from "../tmz";
import * as varietyModule from "../variety";
import * as weathercnModule from "../weather_cn";
import * as weathercomModule from "../weather_com";
import * as wiredModule from "../wired";
import * as worldometersModule from "../worldometers";
import * as yahoofinanceModule from "../yahoo_finance";
import * as zhibo8Module from "../zhibo8";
import * as zhipinModule from "../zhipin";

type LegacySource = {
  namespace: string;
  module: any;
  searchName: string;
  statusName: string;
  mode: "fetch" | "search";
};

const LEGACY_SOURCES: LegacySource[] = [
  {
    namespace: "51job",
    module: legacy51jobModule,
    searchName: "fetch51Job",
    statusName: "get51JobStatus",
    mode: "fetch",
  },
  {
    namespace: "apnews",
    module: apnewsModule,
    searchName: "fetchApnews",
    statusName: "getApnewsStatus",
    mode: "fetch",
  },
  {
    namespace: "arstechnicarss",
    module: arstechnicarssModule,
    searchName: "fetchArstechnicarss",
    statusName: "getArstechnicarssStatus",
    mode: "fetch",
  },
  {
    namespace: "bbc_sport",
    module: bbcsportModule,
    searchName: "fetchBBCSport",
    statusName: "getBBCSportStatus",
    mode: "fetch",
  },
  {
    namespace: "bbctechnology",
    module: bbctechnologyModule,
    searchName: "fetchBbctechnology",
    statusName: "getBbctechnologyStatus",
    mode: "fetch",
  },
  {
    namespace: "billboard",
    module: billboardModule,
    searchName: "fetchBillboard",
    statusName: "getBillboardStatus",
    mode: "fetch",
  },
  {
    namespace: "chinamoney",
    module: chinamoneyModule,
    searchName: "fetchChinaMoney",
    statusName: "getChinaMoneyStatus",
    mode: "fetch",
  },
  {
    namespace: "cls_telegraph",
    module: clstelegraphModule,
    searchName: "searchClsTelegraph",
    statusName: "getClsTelegraphStatus",
    mode: "search",
  },
  {
    namespace: "coinmarketcap",
    module: coinmarketcapModule,
    searchName: "searchCoinmarketcap",
    statusName: "getCoinmarketcapStatus",
    mode: "search",
  },
  {
    namespace: "deadline",
    module: deadlineModule,
    searchName: "fetchDeadline",
    statusName: "getDeadlineStatus",
    mode: "fetch",
  },
  {
    namespace: "douban_movie",
    module: doubanmovieModule,
    searchName: "fetchDoubanMovie",
    statusName: "getDoubanMovieStatus",
    mode: "fetch",
  },
  {
    namespace: "douban_book",
    module: doubanbookModule,
    searchName: "fetchDoubanBook",
    statusName: "getDoubanBookStatus",
    mode: "fetch",
  },
  {
    namespace: "douban_gallery",
    module: doubangalleryModule,
    searchName: "fetchDoubanGallery",
    statusName: "getDoubanGalleryStatus",
    mode: "fetch",
  },
  {
    namespace: "eastmoney",
    module: eastmoneyModule,
    searchName: "searchEastmoney",
    statusName: "getEastmoneyStatus",
    mode: "search",
  },
  {
    namespace: "engadget",
    module: engadgetModule,
    searchName: "fetchEngadget",
    statusName: "getEngadgetStatus",
    mode: "fetch",
  },
  {
    namespace: "flashscore",
    module: flashscoreModule,
    searchName: "fetchFlashScore",
    statusName: "getFlashScoreStatus",
    mode: "fetch",
  },
  {
    namespace: "guardiantechnology",
    module: guardiantechnologyModule,
    searchName: "fetchGuardiantechnology",
    statusName: "getGuardiantechnologyStatus",
    mode: "fetch",
  },
  {
    namespace: "hollywood_reporter",
    module: hollywoodreporterModule,
    searchName: "fetchHollywoodReporter",
    statusName: "getHollywoodReporterStatus",
    mode: "fetch",
  },
  {
    namespace: "hupu",
    module: hupuModule,
    searchName: "fetchHuPu",
    statusName: "getHuPuStatus",
    mode: "fetch",
  },
  {
    namespace: "ign",
    module: ignModule,
    searchName: "fetchIGN",
    statusName: "getIGNStatus",
    mode: "fetch",
  },
  {
    namespace: "jiqizhixin",
    module: jiqizhixinModule,
    searchName: "fetchJiqizhixin",
    statusName: "getJiqizhixinStatus",
    mode: "fetch",
  },
  {
    namespace: "lagou",
    module: lagouModule,
    searchName: "fetchLagou",
    statusName: "getLagouStatus",
    mode: "fetch",
  },
  {
    namespace: "linkedin_jobs",
    module: linkedinjobsModule,
    searchName: "fetchLinkedInJobs",
    statusName: "getLinkedInJobsStatus",
    mode: "fetch",
  },
  {
    namespace: "medrxiv",
    module: medrxivModule,
    searchName: "fetchMedRxiv",
    statusName: "getMedRxivStatus",
    mode: "fetch",
  },
  {
    namespace: "mittechreviewrss",
    module: mittechreviewrssModule,
    searchName: "fetchMittechreviewrss",
    statusName: "getMittechreviewrssStatus",
    mode: "fetch",
  },
  {
    namespace: "nature",
    module: natureModule,
    searchName: "fetchNature",
    statusName: "getNatureStatus",
    mode: "fetch",
  },
  {
    namespace: "nprtechnology",
    module: nprtechnologyModule,
    searchName: "fetchNprtechnology",
    statusName: "getNprtechnologyStatus",
    mode: "fetch",
  },
  {
    namespace: "ourworldindata",
    module: ourworldindataModule,
    searchName: "fetchOurWorldInData",
    statusName: "getOurWorldInDataStatus",
    mode: "fetch",
  },
  {
    namespace: "physorg",
    module: physorgModule,
    searchName: "fetchPhysorg",
    statusName: "getPhysorgStatus",
    mode: "fetch",
  },
  {
    namespace: "polygon",
    module: polygonModule,
    searchName: "fetchPolygon",
    statusName: "getPolygonStatus",
    mode: "fetch",
  },
  {
    namespace: "quantamagazine",
    module: quantamagazineModule,
    searchName: "fetchQuanta",
    statusName: "getQuantaStatus",
    mode: "fetch",
  },
  {
    namespace: "scienceaaas",
    module: scienceaaasModule,
    searchName: "fetchScienceAaas",
    statusName: "getScienceAaasStatus",
    mode: "fetch",
  },
  {
    namespace: "sciencedaily",
    module: sciencedailyModule,
    searchName: "fetchScienceDaily",
    statusName: "getScienceDailyStatus",
    mode: "fetch",
  },
  {
    namespace: "sina_finance",
    module: sinafinanceModule,
    searchName: "searchSinaFinance",
    statusName: "getSinaFinanceStatus",
    mode: "search",
  },
  {
    namespace: "spacecom",
    module: spacecomModule,
    searchName: "fetchSpacecom",
    statusName: "getSpacecomStatus",
    mode: "fetch",
  },
  {
    namespace: "sse",
    module: sseModule,
    searchName: "fetchSSE",
    statusName: "getSSEStatus",
    mode: "fetch",
  },
  {
    namespace: "sspai",
    module: sspaiModule,
    searchName: "fetchSspai",
    statusName: "getSspaiStatus",
    mode: "fetch",
  },
  {
    namespace: "stats_gov",
    module: statsgovModule,
    searchName: "fetchStatsGov",
    statusName: "getStatsGovStatus",
    mode: "fetch",
  },
  {
    namespace: "techcrunchrss",
    module: techcrunchrssModule,
    searchName: "fetchTechcrunchrss",
    statusName: "getTechcrunchrssStatus",
    mode: "fetch",
  },
  {
    namespace: "thevergerss",
    module: thevergerssModule,
    searchName: "fetchThevergerss",
    statusName: "getThevergerssStatus",
    mode: "fetch",
  },
  {
    namespace: "time",
    module: timeModule,
    searchName: "fetchTime",
    statusName: "getTimeStatus",
    mode: "fetch",
  },
  {
    namespace: "tmz",
    module: tmzModule,
    searchName: "fetchTmz",
    statusName: "getTmzStatus",
    mode: "fetch",
  },
  {
    namespace: "variety",
    module: varietyModule,
    searchName: "fetchVariety",
    statusName: "getVarietyStatus",
    mode: "fetch",
  },
  {
    namespace: "weather_cn",
    module: weathercnModule,
    searchName: "searchWeatherCn",
    statusName: "getWeatherCnStatus",
    mode: "search",
  },
  {
    namespace: "weather_com",
    module: weathercomModule,
    searchName: "searchWeatherCom",
    statusName: "getWeatherComStatus",
    mode: "search",
  },
  {
    namespace: "wired",
    module: wiredModule,
    searchName: "fetchWired",
    statusName: "getWiredStatus",
    mode: "fetch",
  },
  {
    namespace: "worldometers",
    module: worldometersModule,
    searchName: "fetchWorldometers",
    statusName: "getWorldometersStatus",
    mode: "fetch",
  },
  {
    namespace: "yahoo_finance",
    module: yahoofinanceModule,
    searchName: "searchYahooFinance",
    statusName: "getYahooFinanceStatus",
    mode: "search",
  },
  {
    namespace: "zhibo8",
    module: zhibo8Module,
    searchName: "fetchZhibo8",
    statusName: "getZhibo8Status",
    mode: "fetch",
  },
  {
    namespace: "zhipin",
    module: zhipinModule,
    searchName: "fetchZhipin",
    statusName: "getZhipinStatus",
    mode: "fetch",
  },
];

function createLegacySearch(source: LegacySource): CapabilityDefinition {
  return {
    name: "search",
    namespace: source.namespace,
    description: `兼容 ${source.namespace} 平台搜索能力；工作流节点通过统一适配器调用。`,
    riskLevel: "read",
    argsSchema: z
      .object({
        keyword: z.string().optional(),
        query: z.string().optional(),
        category: z.string().optional(),
        maxCount: z.number().optional().default(10),
        limit: z.number().optional(),
        city: z.string().optional(),
        code: z.string().optional(),
        symbol: z.string().optional(),
        ids: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        base: z.string().optional(),
      })
      .passthrough(),
    handler: async (args: Record<string, any>) => {
      const input = args || {};
      const keyword =
        input.keyword ||
        input.query ||
        input.category ||
        input.city ||
        input.code ||
        input.symbol ||
        "";
      try {
        let result: any;
        if (source.mode === "fetch") {
          result = await source.module[source.searchName](
            String(input.category || "all"),
            {
              query: keyword || undefined,
              maxCount: Number(input.maxCount || input.limit || 10),
            },
          );
        } else if (source.namespace === "coinmarketcap") {
          result = await source.module[source.searchName](
            Number(input.limit || input.maxCount || 20),
          );
        } else if (source.namespace === "yahoo_finance") {
          result = await source.module[source.searchName]({
            symbol: keyword || input.symbol,
            query: keyword || input.query,
            maxCount: Number(input.maxCount || 10),
          });
        } else if (source.namespace === "weather_cn") {
          result = await source.module[source.searchName](
            String(input.cityCode || input.code || keyword || "101010100"),
          );
        } else if (source.namespace === "weather_com") {
          result = await source.module[source.searchName](
            String(input.location || input.code || keyword || "USNY0996:1:US"),
          );
        } else {
          result = await source.module[source.searchName](
            keyword || input.codes || input.secid || "",
          );
        }
        return {
          success: result?.success !== false,
          query: keyword,
          data: result?.data ?? result,
          items: result?.items || [],
          count: result?.count ?? result?.items?.length ?? 0,
          error: result?.error || null,
        };
      } catch (error: any) {
        return {
          success: false,
          query: keyword,
          items: [],
          count: 0,
          error: error?.message || String(error),
        };
      }
    },
  };
}

function createLegacyStatus(source: LegacySource): CapabilityDefinition {
  return {
    name: "status",
    namespace: source.namespace,
    description: `获取 ${source.namespace} 服务状态。`,
    riskLevel: "read",
    argsSchema: z.object({}),
    handler: () => source.module[source.statusName](),
  };
}

export function registerLegacyPlatformCapabilities(): void {
  for (const source of LEGACY_SOURCES)
    CapabilityRegistry.registerAll([
      createLegacySearch(source),
      createLegacyStatus(source),
    ]);
}
