'use client';

/**
 * Volume Artifact Preview — shows what artifacts/documents each volume
 * requires, with format-specific icons and template preview links.
 *
 * Each required item displays:
 *   - Format icon (DOCX, PPTX, XLSX, PDF, Form)
 *   - Name and type badge
 *   - Page/slide limit
 *   - Required/optional indicator
 *   - "Preview Template" link to open the previewer
 */

import { useState, useCallback } from 'react';
import { TemplatePreviewer } from './template-previewer';

// --- Types ---

export type ArtifactType =
  | 'word_doc'
  | 'slide_deck'
  | 'spreadsheet'
  | 'pdf'
  | 'form_sf424'
  | 'form_budget'
  | 'form_certification'
  | 'form_other';

export interface VolumeArtifact {
  id: string;
  name: string;
  type: ArtifactType;
  required: boolean;
  pageLimit?: number;
  slideLimit?: number;
  templateKey?: string;
  description?: string;
}

interface Props {
  volumeName: string;
  artifacts: VolumeArtifact[];
  onUseTemplate?: (templateKey: string, artifactId: string) => void;
}

// --- Format icons (SVG inline for reliability) ---

function DocxIcon() {
  return (
    <div className="w-8 h-8 rounded flex items-center justify-center bg-blue-100 text-blue-700 text-[10px] font-bold flex-shrink-0">
      DOCX
    </div>
  );
}

function PptxIcon() {
  return (
    <div className="w-8 h-8 rounded flex items-center justify-center bg-orange-100 text-orange-700 text-[10px] font-bold flex-shrink-0">
      PPTX
    </div>
  );
}

function XlsxIcon() {
  return (
    <div className="w-8 h-8 rounded flex items-center justify-center bg-green-100 text-green-700 text-[10px] font-bold flex-shrink-0">
      XLSX
    </div>
  );
}

function PdfIcon() {
  return (
    <div className="w-8 h-8 rounded flex items-center justify-center bg-red-100 text-red-700 text-[10px] font-bold flex-shrink-0">
      PDF
    </div>
  );
}

function FormIcon() {
  return (
    <div className="w-8 h-8 rounded flex items-center justify-center bg-gray-100 text-gray-600 text-[10px] font-bold flex-shrink-0">
      FORM
    </div>
  );
}

function getArtifactIcon(type: ArtifactType) {
  switch (type) {
    case 'word_doc': return <DocxIcon />;
    case 'slide_deck': return <PptxIcon />;
    case 'spreadsheet': return <XlsxIcon />;
    case 'pdf': return <PdfIcon />;
    case 'form_sf424':
    case 'form_budget':
    case 'form_certification':
    case 'form_other':
      return <FormIcon />;
    default: return <DocxIcon />;
  }
}

function getTypeBadge(type: ArtifactType): { label: string; className: string } {
  switch (type) {
    case 'word_doc':
      return { label: 'Word Document', className: 'bg-blue-50 text-blue-700 border-blue-200' };
    case 'slide_deck':
      return { label: 'Slide Deck', className: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'spreadsheet':
      return { label: 'Spreadsheet', className: 'bg-green-50 text-green-700 border-green-200' };
    case 'pdf':
      return { label: 'PDF', className: 'bg-red-50 text-red-700 border-red-200' };
    case 'form_sf424':
      return { label: 'SF-424 Form', className: 'bg-gray-50 text-gray-600 border-gray-200' };
    case 'form_budget':
      return { label: 'Budget Form', className: 'bg-gray-50 text-gray-600 border-gray-200' };
    case 'form_certification':
      return { label: 'Certification', className: 'bg-gray-50 text-gray-600 border-gray-200' };
    case 'form_other':
      return { label: 'Form', className: 'bg-gray-50 text-gray-600 border-gray-200' };
    default:
      return { label: type, className: 'bg-gray-50 text-gray-600 border-gray-200' };
  }
}

export function VolumeArtifactPreview({ volumeName, artifacts, onUseTemplate }: Props) {
  const [previewingTemplate, setPreviewingTemplate] = useState<{
    templateKey: string;
    artifactId: string;
  } | null>(null);

  const handlePreviewTemplate = useCallback((templateKey: string, artifactId: string) => {
    setPreviewingTemplate({ templateKey, artifactId });
  }, []);

  const handleUseTemplate = useCallback((templateKey: string) => {
    if (onUseTemplate && previewingTemplate) {
      onUseTemplate(templateKey, previewingTemplate.artifactId);
    }
    setPreviewingTemplate(null);
  }, [onUseTemplate, previewingTemplate]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">{volumeName}</h3>
        <span className="text-xs text-gray-500">
          {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-2">
        {artifacts.map((artifact) => {
          const badge = getTypeBadge(artifact.type);
          return (
            <div
              key={artifact.id}
              className="flex items-center gap-3 p-3 bg-white border rounded-lg hover:border-gray-300 transition-colors"
            >
              {getArtifactIcon(artifact.type)}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 truncate">
                    {artifact.name}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.className}`}>
                    {badge.label}
                  </span>
                  {artifact.required ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                      Required
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">
                      Optional
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                  {artifact.pageLimit && <span>{artifact.pageLimit} page limit</span>}
                  {artifact.slideLimit && <span>{artifact.slideLimit} slide limit</span>}
                  {artifact.description && <span>{artifact.description}</span>}
                </div>
              </div>

              {artifact.templateKey && (
                <button
                  onClick={() => handlePreviewTemplate(artifact.templateKey!, artifact.id)}
                  className="px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap"
                >
                  Preview Template
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Template preview modal overlay */}
      {previewingTemplate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-8 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-sm font-semibold text-gray-800">Template Preview</h2>
              <button
                onClick={() => setPreviewingTemplate(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-6">
              <TemplatePreviewer
                initialTemplateKey={previewingTemplate.templateKey}
                showSelector={false}
                onUseTemplate={onUseTemplate ? handleUseTemplate : undefined}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
