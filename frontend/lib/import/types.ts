import type { CanvasNode } from '@/lib/types/canvas-document';

/**
 * An imported atom — a semantically meaningful unit extracted from an
 * uploaded document. Heading + its child content grouped together.
 */
export interface ImportedAtom {
  nodes: CanvasNode[];
  suggestedCategory: string;
  suggestedTags: string[];
  headingText: string | null;
  charOffset: number;
  charLength: number;
  confidence: number;
}

export interface ImportResult {
  atoms: ImportedAtom[];
  sourceFilename: string;
  sourceFormat: 'docx' | 'pptx' | 'pdf' | 'txt' | 'md';
  totalChars: number;
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  created?: string;
  modified?: string;
  pageCount?: number;
  slideCount?: number;
}

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /past\s*perf/i, category: 'past_performance' },
  { pattern: /key\s*personnel|team|staff/i, category: 'key_personnel' },
  { pattern: /bio(?:graph)?|resume|cv|curriculum/i, category: 'key_personnel' },
  { pattern: /techni(?:cal)?\s*(?:approach|volume|narrative)/i, category: 'technical_approach' },
  { pattern: /management\s*(?:approach|plan|volume)/i, category: 'management_approach' },
  { pattern: /cost\s*(?:volume|proposal|narrative)|budget|pricing/i, category: 'cost_volume' },
  { pattern: /capabilit(?:y|ies)\s*(?:statement|overview)?/i, category: 'capability_statement' },
  { pattern: /commerciali[sz]ation/i, category: 'commercialization' },
  { pattern: /abstract|summary|overview|introduction/i, category: 'abstract' },
  { pattern: /qualif|experience|corporate/i, category: 'qualifications' },
  { pattern: /schedule|timeline|milestone/i, category: 'schedule' },
  { pattern: /risk|mitigation/i, category: 'risk_management' },
  { pattern: /quality|assurance|qm?s/i, category: 'quality' },
  { pattern: /facil|lab|equipment/i, category: 'facilities' },
  { pattern: /subcontract|teaming|partner/i, category: 'teaming' },
  { pattern: /security|clearance|itar/i, category: 'security' },
  { pattern: /transition|sustainment|phase\s*(?:ii|iii|2|3)/i, category: 'transition_plan' },
  { pattern: /data\s*(?:management|rights)|intellectual/i, category: 'data_rights' },
];

export function inferCategory(text: string): { category: string; confidence: number } {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) {
      return { category, confidence: 0.8 };
    }
  }
  return { category: 'general', confidence: 0.3 };
}

export function inferCategoryFromFilename(filename: string): { category: string; confidence: number } {
  const name = filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  const result = inferCategory(name);
  return { ...result, confidence: result.confidence * 0.7 };
}
