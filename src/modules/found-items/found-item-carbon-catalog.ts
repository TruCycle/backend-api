import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FoundItemCarbonCatalogEntry {
  readonly category: string;
  readonly subcategory: string;
  readonly item: string;
  readonly typicalWeightKg: number;
  readonly netCo2eSavedKg: number;
  readonly carbonPointsAwarded: number;
  readonly normalizedCategory: string;
  readonly normalizedSubcategory: string;
  readonly normalizedItem: string;
  readonly searchTokens: readonly string[];
}

export interface FoundItemCarbonCatalogSelection {
  readonly sourceCategory?: string | null;
  readonly subcategory?: string | null;
  readonly item: string;
}

const catalogFilePath = resolve(process.cwd(), 'data', 'found-item-carbon-catalog.csv');

const categoryCatalogMap: Record<string, readonly string[]> = {
  furniture: ['furniture'],
  electronics: ['weee'],
  appliances: ['weee'],
  outdoor: ['bulky', 'furniture'],
  other: ['bulky', 'furniture', 'weee'],
};

let cachedCatalog: readonly FoundItemCarbonCatalogEntry[] | null = null;

export function getFoundItemCarbonCatalogSupportedCategories(): readonly string[] {
  return Object.entries(categoryCatalogMap)
    .filter(([, sourceCategories]) => sourceCategories.length > 0)
    .map(([category]) => category)
    .sort((left, right) => left.localeCompare(right));
}

export function getFoundItemCarbonCatalog(): readonly FoundItemCarbonCatalogEntry[] {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const parsedRows = parseCsv(readFileSync(catalogFilePath, 'utf8'));
  const [headerRow = [], ...bodyRows] = parsedRows;
  const headerMap = new Map<string, number>();
  headerRow.forEach((header, index) => {
    headerMap.set(header, index);
  });

  cachedCatalog = bodyRows
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => createCatalogEntry(row, headerMap));

  return cachedCatalog;
}

export function findFoundItemCarbonCatalogEntry(
  category: string,
  title: string,
  weightKg?: number | null,
): FoundItemCarbonCatalogEntry | null {
  const normalizedTitle = normalizeSearchText(title);
  if (!normalizedTitle) {
    return null;
  }

  const titleTokens = tokenize(`${category} ${title}`);
  if (titleTokens.length === 0) {
    return null;
  }

  const preferredCategories = new Set(
    (categoryCatalogMap[normalizeSearchText(category)] ?? []).map((value) => normalizeSearchText(value)),
  );

  let bestEntry: FoundItemCarbonCatalogEntry | null = null;
  let bestScore = 0;

  for (const entry of getFoundItemCarbonCatalog()) {
    const score = scoreCatalogEntry(entry, normalizedTitle, titleTokens, preferredCategories, weightKg);
    if (score <= bestScore) {
      continue;
    }

    bestScore = score;
    bestEntry = entry;
  }

  return bestScore >= 25 ? bestEntry : null;
}

export function findFoundItemCarbonCatalogEntryBySelection(
  selection: FoundItemCarbonCatalogSelection,
): FoundItemCarbonCatalogEntry | null {
  const normalizedItem = normalizeSearchText(selection.item);
  if (!normalizedItem) {
    return null;
  }

  const normalizedSourceCategory = normalizeSearchText(selection.sourceCategory ?? '');
  const normalizedSubcategory = normalizeSearchText(selection.subcategory ?? '');

  for (const entry of getFoundItemCarbonCatalog()) {
    if (entry.normalizedItem !== normalizedItem) {
      continue;
    }

    if (normalizedSourceCategory && entry.normalizedCategory !== normalizedSourceCategory) {
      continue;
    }

    if (normalizedSubcategory && entry.normalizedSubcategory !== normalizedSubcategory) {
      continue;
    }

    return entry;
  }

  return null;
}

export function searchFoundItemCarbonCatalog(options: {
  readonly category?: string;
  readonly search?: string;
  readonly limit?: number;
}): readonly FoundItemCarbonCatalogEntry[] {
  const requestedCategory = normalizeSearchText(options.category ?? '');
  const preferredCategories = new Set(
    (categoryCatalogMap[requestedCategory] ?? []).map((value) => normalizeSearchText(value)),
  );
  const normalizedSearch = normalizeSearchText(options.search ?? '');
  const searchTokens = tokenize(`${options.category ?? ''} ${options.search ?? ''}`);
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 20);

  if (requestedCategory && !categoryCatalogMap[requestedCategory]) {
    return [];
  }

  const scopedEntries = getFoundItemCarbonCatalog().filter((entry) => {
    if (preferredCategories.size === 0) {
      return !requestedCategory;
    }

    return preferredCategories.has(entry.normalizedCategory);
  });

  if (!normalizedSearch) {
    return [...scopedEntries]
      .sort((left, right) => {
        return (
          left.subcategory.localeCompare(right.subcategory) ||
          left.item.localeCompare(right.item)
        );
      })
      .slice(0, limit);
  }

  return scopedEntries
    .map((entry) => ({
      entry,
      score: scoreCatalogEntry(entry, normalizedSearch, searchTokens, preferredCategories, undefined),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      return (
        right.score - left.score ||
        left.entry.subcategory.localeCompare(right.entry.subcategory) ||
        left.entry.item.localeCompare(right.entry.item)
      );
    })
    .slice(0, limit)
    .map((entry) => entry.entry);
}

function createCatalogEntry(
  row: readonly string[],
  headerMap: ReadonlyMap<string, number>,
): FoundItemCarbonCatalogEntry {
  const category = readField(row, headerMap, 'Category');
  const subcategory = readField(row, headerMap, 'Subcategory');
  const item = readField(row, headerMap, 'Item');

  return {
    category,
    subcategory,
    item,
    typicalWeightKg: readNumberField(row, headerMap, 'TypicalWeightKg'),
    netCo2eSavedKg: readNumberField(row, headerMap, 'NetCo2eSavedKg'),
    carbonPointsAwarded: readNumberField(row, headerMap, 'CarbonPointsAwarded'),
    normalizedCategory: normalizeSearchText(category),
    normalizedSubcategory: normalizeSearchText(subcategory),
    normalizedItem: normalizeSearchText(item),
    searchTokens: tokenize(`${category} ${subcategory} ${item}`),
  };
}

function readField(row: readonly string[], headerMap: ReadonlyMap<string, number>, key: string): string {
  const index = headerMap.get(key);
  return typeof index === 'number' ? row[index]?.trim() ?? '' : '';
}

function readNumberField(
  row: readonly string[],
  headerMap: ReadonlyMap<string, number>,
  key: string,
): number {
  const rawValue = readField(row, headerMap, key);
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Invalid numeric value for ${key}: ${rawValue}`);
  }
  return parsedValue;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let currentField = '';
  let isInsideQuotes = false;

  const pushField = () => {
    row.push(currentField);
    currentField = '';
  };

  const pushRow = () => {
    pushField();
    if (row.length > 1 || row[0]?.trim().length) {
      rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (character === '"') {
      if (isInsideQuotes && input[index + 1] === '"') {
        currentField += '"';
        index += 1;
        continue;
      }

      isInsideQuotes = !isInsideQuotes;
      continue;
    }

    if (character === ',' && !isInsideQuotes) {
      pushField();
      continue;
    }

    if ((character === '\n' || character === '\r') && !isInsideQuotes) {
      if (character === '\r' && input[index + 1] === '\n') {
        index += 1;
      }
      pushRow();
      continue;
    }

    currentField += character;
  }

  if (currentField.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value: string): readonly string[] {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function scoreCatalogEntry(
  entry: FoundItemCarbonCatalogEntry,
  normalizedTitle: string,
  titleTokens: readonly string[],
  preferredCategories: ReadonlySet<string>,
  weightKg?: number | null,
): number {
  let score = 0;
  const hasExactItemMatch = normalizedTitle === entry.normalizedItem;
  const hasContainsMatch =
    entry.normalizedItem.includes(normalizedTitle) || normalizedTitle.includes(entry.normalizedItem);
  const overlapCount = countOverlap(titleTokens, entry.searchTokens);

  if (!hasExactItemMatch && !hasContainsMatch && overlapCount === 0) {
    return 0;
  }

  if (hasExactItemMatch) {
    score += 100;
  } else if (hasContainsMatch) {
    score += 70;
  }

  score += overlapCount * 12;

  if (preferredCategories.size > 0 && preferredCategories.has(entry.normalizedCategory)) {
    score += 24;
  }

  if (typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg > 0) {
    const delta = Math.abs(weightKg - entry.typicalWeightKg);
    if (delta <= 1) {
      score += 8;
    } else if (delta <= 5) {
      score += 6;
    } else if (delta <= 10) {
      score += 3;
    }
  }

  return score;
}

function countOverlap(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightTokens = new Set(right);
  let overlapCount = 0;
  for (const token of new Set(left)) {
    if (rightTokens.has(token)) {
      overlapCount += 1;
    }
  }

  return overlapCount;
}