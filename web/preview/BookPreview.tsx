import { Fragment, memo, useEffect, useState, type CSSProperties, type RefObject } from 'react'
import DOMPurify from 'dompurify'
import { chapterBackgroundStyle, chapterImagesAt, chapterStyle, previewStyles, resolveStyle, type ChapterGroup, type Project } from '../book/model'
import { orderedNotes, renderNoteMarkers } from '../chapters/notes'
import HeadingTitle from '../chapters/HeadingTitle'

interface Props {
  book: Project
  groups: ChapterGroup[]
  chapterIndex: Map<string, number>
  scrollRef: RefObject<HTMLDivElement | null>
  forcedChapterId?: string
}

function BookPreview({ book, groups, chapterIndex, scrollRef, forcedChapterId }: Props) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(book.chapters[0] ? [book.chapters[0].id] : []))

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(new Set(book.chapters.map(chapter => chapter.id)))
      return
    }
    const observer = new IntersectionObserver(entries => {
      const ids = entries.filter(entry => entry.isIntersecting).map(entry => (entry.target as HTMLElement).dataset.previewChapterId).filter((id): id is string => !!id)
      if (ids.length) setVisible(previous => new Set([...previous, ...ids]))
      entries.filter(entry => entry.isIntersecting).forEach(entry => observer.unobserve(entry.target))
    }, { root, rootMargin: '700px 0px' })
    root.querySelectorAll<HTMLElement>('[data-preview-chapter-id]').forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [book.chapters, groups, scrollRef])

  return <>
    <div className="preview-note">预览按当前统一样式显示整本书，卷的字体与图片设置也会生效。导出后阅读器可能使用自己的字体设置。</div>
    {groups.map((group, groupIndex) => {
      const volumeStyle = group.volume ? previewStyles(resolveStyle(book.style, group.volume.style)) as CSSProperties : undefined
      return <Fragment key={`${group.volume?.id ?? group.chapters[0]?.id ?? 'empty'}-${groupIndex}`}>
        {group.volume && <article className="paper preview-paper volume-paper" style={volumeStyle}>
          <HeadingTitle title={group.volume.title} kind="volume" layout={group.volume.titleLayout}/>
          {group.volume.openingImage && <img className="boundary-image" src={group.volume.openingImage} alt="卷首图"/>}
        </article>}
        {group.chapters.map(chapter => {
          const index = chapterIndex.get(chapter.id) ?? 0
          const last = group.chapters[group.chapters.length - 1].id === chapter.id
          const loaded = visible.has(chapter.id) || forcedChapterId === chapter.id
          const notes = loaded ? orderedNotes(chapter) : []
          return <article className="paper preview-paper" data-preview-chapter-id={chapter.id} id={`preview-chapter-${index + 1}`} style={{ ...previewStyles(chapterStyle(book, chapter)), ...chapterBackgroundStyle(book) } as CSSProperties} key={chapter.id}>
            {loaded && chapterImagesAt(book, chapter, 'above').map(image => <img className="boundary-image" src={image.image} alt="章节标题上方图片" key={image.id}/>)}
            <HeadingTitle title={chapter.title} kind="chapter" id={chapter.titleId} layout={chapter.titleLayout}/>
            {loaded && <>
              {chapterImagesAt(book, chapter, 'below').map(image => <img className="boundary-image" src={image.image} alt="章节标题下方图片" key={image.id}/>)}
              <div className="preview-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderNoteMarkers(chapter.html, notes, book.noteMarkerImage), { USE_PROFILES: { html: true } }) }}/>
              {group.volume?.closingImage && last && <img className="boundary-image" src={group.volume.closingImage} alt="卷尾图"/>}
              {notes.length > 0 && <section className="chapter-notes" aria-label="本章备注"><h2>备注</h2>{notes.map((note, number) => <p key={note.id}>{book.noteDetailImage ? <img className="note-detail-image" src={book.noteDetailImage} alt={`备注 ${number + 1}`}/> : <span>[{number + 1}]</span>} {note.text}</p>)}</section>}
            </>}
          </article>
        })}
      </Fragment>
    })}
  </>
}

export default memo(BookPreview)
