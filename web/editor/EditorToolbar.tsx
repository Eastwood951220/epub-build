import type { Editor } from '@tiptap/react'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eye, EyeOff, ImagePlus, Italic, List, ListOrdered, MessageSquareText, PanelTop, Redo2, Undo2 } from 'lucide-react'
import TextColorControl from './TextColorControl'

interface Props {
  editor: Editor | null
  availableFonts: { value: string; label: string }[]
  onSelectFont: (family: string) => void
  showEditorImages: boolean
  onAddNote: () => void
  onAddNoteBox: () => void
  onChooseImage: () => void
  onToggleImages: () => void
}

export default function EditorToolbar({ editor, availableFonts, showEditorImages, onSelectFont, onAddNote, onAddNoteBox, onChooseImage, onToggleImages }: Props) {
  return (
          <div className="editor-toolbar" aria-label="文字格式工具栏">
            <button title="撤销" aria-label="撤销" onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={17}/></button><button title="重做" aria-label="重做" onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={17}/></button><span className="toolbar-divider"/>
            <select aria-label="段落样式" defaultValue="paragraph" onChange={event => { const value = event.target.value; if (value === 'paragraph') editor?.chain().focus().setParagraph().run(); else editor?.chain().focus().toggleHeading({ level: Number(value) as 1 | 2 | 3 }).run() }}><option value="paragraph">正文段落</option><option value="1">一级标题</option><option value="2">二级标题</option><option value="3">三级标题</option></select>
            <button className="note-toolbar-button" title="在光标处插入备注" aria-label="在光标处插入备注" onClick={onAddNote}><MessageSquareText size={16}/>插入备注</button>
            <button className="note-toolbar-button" title="在光标处插入带边框的小贴士" aria-label="插入小贴士" onClick={onAddNoteBox}><PanelTop size={16}/>小贴士</button>
            <select aria-label="所选文字字体" defaultValue="" onChange={event => { if (event.target.value) onSelectFont(event.target.value) }}><option value="">局部字体</option>{availableFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select>
            <select aria-label="所选文字字号" defaultValue="" onChange={event => { if (event.target.value) editor?.chain().focus().setFontSize(`${event.target.value}px`).run() }}><option value="">字号</option>{[12, 14, 16, 18, 20, 24, 28, 32, 40].map(size => <option key={size} value={size}>{size}</option>)}</select>
            <span className="toolbar-divider"/><button title="加粗" aria-label="加粗" onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={17}/></button><button title="斜体" aria-label="斜体" onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={17}/></button><TextColorControl editor={editor}/>
            <span className="toolbar-divider"/><button title="左对齐" aria-label="左对齐" onClick={() => editor?.chain().focus().setTextAlign('left').run()}><AlignLeft size={17}/></button><button title="居中" aria-label="居中" onClick={() => editor?.chain().focus().setTextAlign('center').run()}><AlignCenter size={17}/></button><button title="右对齐" aria-label="右对齐" onClick={() => editor?.chain().focus().setTextAlign('right').run()}><AlignRight size={17}/></button><button title="两端对齐" aria-label="两端对齐" onClick={() => editor?.chain().focus().setTextAlign('justify').run()}><AlignJustify size={17}/></button>
            <span className="toolbar-divider"/><button title="无序列表" aria-label="无序列表" onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={17}/></button><button title="有序列表" aria-label="有序列表" onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={17}/></button><button title="在光标处插入图片" aria-label="在光标处插入图片" onClick={onChooseImage}><ImagePlus size={18}/></button><button className="image-toggle-button" title={showEditorImages ? "隐藏编辑图片" : "显示编辑图片"} aria-label={showEditorImages ? "隐藏编辑图片" : "显示编辑图片"} aria-pressed={showEditorImages} onClick={onToggleImages}>{showEditorImages ? <EyeOff size={16}/> : <Eye size={16}/>}<span>{showEditorImages ? "隐藏图片" : "显示图片"}</span></button>
          </div>
  )
}
