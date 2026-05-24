/**
 * Simple regex-based markdown renderer.
 *
 * If the input already looks like HTML (contains tags), it is returned as-is.
 * Otherwise common markdown constructs are converted to HTML.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  // If it looks like HTML (has tags), return as-is (already HTML)
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  // Simple markdown transforms
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-600 hover:underline">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul class="list-disc pl-6 space-y-1">$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) => line.startsWith('<') ? line : `<p>${line}</p>`);
}
