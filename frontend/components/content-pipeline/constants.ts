import type { ContentPostStatus, ContentCategory } from '@/types'

export const STATUS_COLORS: Record<ContentPostStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  in_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  published: 'bg-blue-100 text-blue-700',
  reverted: 'bg-orange-100 text-orange-700',
  archived: 'bg-gray-100 text-gray-500',
}

export const CATEGORIES: ContentCategory[] = [
  'tip', 'announcement', 'product_update', 'guide', 'resource', 'case_study',
]

export const CATEGORY_LABELS: Record<ContentCategory, string> = {
  tip: 'SBIR Tip',
  announcement: 'Announcement',
  product_update: 'Product Update',
  guide: 'Guide',
  resource: 'Resource',
  case_study: 'Case Study',
}
