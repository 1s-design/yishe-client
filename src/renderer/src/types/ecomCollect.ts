export type EcomCollectJsonMap = Record<string, any>;

export type EcomCollectRecord = EcomCollectJsonMap;
export type EcomCollectSnapshot = EcomCollectJsonMap;
export interface EcomCollectSummary extends EcomCollectJsonMap {
  message?: string;
  status?: string;
  platform?: string;
  taskType?: string;
  recordsCount?: number;
  snapshots?: EcomCollectSnapshot[];
  updatedAt?: string;
}
export type EcomCollectDebugMeta = EcomCollectJsonMap;

export interface EcomCollectDocsExample {
  title?: string;
  description?: string;
  payload?: EcomCollectJsonMap;
}

export interface EcomCollectOutputFieldSchema {
  key: string;
  label: string;
  description?: string;
  valueType?: string;
  stability?: string;
  examples?: any[];
}

export interface EcomCollectDocsSchema {
  overview?: string;
  notes?: string[];
  packageFields?: EcomCollectOutputFieldSchema[];
  recordFields?: EcomCollectOutputFieldSchema[];
  examples?: EcomCollectDocsExample[];
}

export interface EcomCollectRunResult<
  RecordItem extends EcomCollectRecord = EcomCollectRecord,
  SnapshotItem extends EcomCollectSnapshot = EcomCollectSnapshot,
> {
  packageType?: string;
  runId?: string | null;
  taskId?: string | null;
  taskName?: string;
  platform?: string;
  taskType?: string;
  status?: string;
  message?: string;
  capturedAt?: string;
  // Legacy compatibility while collectScene is still emitted upstream.
  collectScene?: string;
  records?: RecordItem[];
  snapshots?: SnapshotItem[];
  summary?: EcomCollectSummary;
  debugMeta?: EcomCollectDebugMeta;
}

export interface EcomCollectRunResponse<
  RecordItem extends EcomCollectRecord = EcomCollectRecord,
  SnapshotItem extends EcomCollectSnapshot = EcomCollectSnapshot,
> {
  success: boolean;
  status?: string;
  data?: EcomCollectRunResult<RecordItem, SnapshotItem>;
  message?: string;
}

export interface SupplyMatchCandidateCollectContext {
  listingRecord?: EcomCollectRecord | null;
  detailRecord?: EcomCollectRecord | null;
}

export interface SupplyMatchCandidateSnapshotData<
  SnapshotItem extends EcomCollectSnapshot = EcomCollectSnapshot,
> {
  listing: SnapshotItem[];
  detail: SnapshotItem[];
}

export interface SupplyMatchCandidateRecord extends EcomCollectRecord {
  sourceRecordId?: string | null;
  sourcePlatform?: string | null;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  supplierPlatform?: string | null;
  supplierRecordKey?: string | null;
  supplierUrl?: string | null;
  sourceQuery?: string | null;
  queryIndex?: number | null;
  title?: string | null;
  priceText?: string | null;
  shopName?: string | null;
  imageUrl?: string | null;
  capturedAt?: string | null;
  listingData?: EcomCollectRecord | null;
  detailData?: EcomCollectRecord | null;
  comparisonData?: EcomCollectJsonMap | null;
  collectContext?: SupplyMatchCandidateCollectContext | null;
  rawPayload?: SupplyMatchCandidateCollectContext | null;
  snapshotData?: SupplyMatchCandidateSnapshotData | null;
  matchScore?: number | null;
  matchRank?: number | null;
}
