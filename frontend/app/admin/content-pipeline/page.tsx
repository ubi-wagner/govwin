'use client'

import { useContentPipeline, PostList, PostDetail, GenerationPanel, ReviewQueue } from '@/components/content-pipeline'
import type { Tab } from '@/components/content-pipeline/use-content-pipeline'

export default function ContentPipelinePage() {
  const cp = useContentPipeline()

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">Generate, review, approve, and publish content</p>
        </div>
        <button onClick={cp.createManualPost} className="btn-primary text-sm px-4 py-2">
          + New Post
        </button>
      </div>

      {/* Flash message */}
      {cp.msg && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${cp.msg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {cp.msg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {([
          { key: 'posts' as Tab, label: 'Posts', count: cp.posts.length },
          { key: 'generate' as Tab, label: 'Generate', count: cp.generations.filter(g => g.status === 'completed').length },
          { key: 'review' as Tab, label: 'Review Queue', count: cp.reviewQueue.length },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => { cp.setTab(t.key); cp.closeDetail() }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              cp.tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count > 0 && <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={cp.detail ? 'lg:col-span-1' : 'lg:col-span-3'}>
          {cp.tab === 'posts' && (
            <PostList
              posts={cp.posts}
              loading={cp.loading}
              error={cp.error}
              selectedPostId={cp.detail?.post.id}
              filterStatus={cp.filterStatus}
              filterCategory={cp.filterCategory}
              onFilterStatusChange={cp.setFilterStatus}
              onFilterCategoryChange={cp.setFilterCategory}
              onSelectPost={cp.openDetail}
            />
          )}

          {cp.tab === 'generate' && (
            <GenerationPanel
              generations={cp.generations}
              genPrompt={cp.genPrompt}
              genCategory={cp.genCategory}
              genModel={cp.genModel}
              genTemp={cp.genTemp}
              generating={cp.generating}
              onPromptChange={cp.setGenPrompt}
              onCategoryChange={cp.setGenCategory}
              onModelChange={cp.setGenModel}
              onTempChange={cp.setGenTemp}
              onSubmit={cp.submitGeneration}
              onAccept={cp.acceptGeneration}
              onReject={cp.rejectGeneration}
              onRetry={cp.retryGeneration}
            />
          )}

          {cp.tab === 'review' && (
            <ReviewQueue
              queue={cp.reviewQueue}
              rejectNotes={cp.rejectNotes}
              showRejectFor={cp.showRejectFor}
              onRejectNotesChange={cp.setRejectNotes}
              onShowRejectFor={cp.setShowRejectFor}
              onApprove={(postId) => cp.doAction('approve', postId)}
              onReject={(postId, notes) => cp.doAction('reject', postId, { notes })}
              onViewPost={cp.openDetail}
            />
          )}
        </div>

        {cp.detail && (
          <PostDetail
            post={cp.detail.post}
            reviews={cp.detail.reviews}
            editMode={cp.editMode}
            editForm={cp.editForm}
            saving={cp.saving}
            onClose={cp.closeDetail}
            onStartEdit={cp.startEdit}
            onCancelEdit={() => cp.setEditMode(false)}
            onEditFormChange={cp.setEditForm}
            onSave={cp.savePost}
            onAction={cp.doAction}
          />
        )}
      </div>
    </div>
  )
}
