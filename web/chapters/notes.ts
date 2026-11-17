import type { ChapterNote, EditableChapter } from '../book/model'

const markerPattern = /<span\b[^>]*\bdata-note-id="([^"]+)"[^>]*>[\s\S]*?<\/span>/g

export function orderedNotes(chapter: EditableChapter): ChapterNote[] {
  const byId = new Map((chapter.notes ?? []).map(note => [note.id, note]))
  const seen = new Set<string>()
  return [...chapter.html.matchAll(markerPattern)].flatMap(match => {
    const note = byId.get(match[1])
    if (!note || seen.has(note.id)) return []
    seen.add(note.id)
    return [note]
  })
}

export function renderNoteMarkers(html: string, notes: ChapterNote[]): string {
  const numbers = new Map(notes.map((note, index) => [note.id, index + 1]))
  return html.replace(markerPattern, (original, id: string) => {
    const number = numbers.get(id)
    return number ? `<span class="note-marker" data-note-id="${id}">[${number}]</span>` : original
  })
}
