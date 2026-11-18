import { describe, expect, it } from 'vitest'
import type { EditableChapter, Volume } from '../book/model'
import {
  arabicToChinese,
  chineseNumberToArabic,
  formatChapterTitle,
  formatVolumeTitle,
  looksLikeChapterHeading,
  parseChapterTitle,
  renumberChapters,
  renumberVolumeTitles,
  suggestNumberingStart,
  mergeWithPrevious,
  normalizeChapters,
  plainText,
  previewText,
  removeChapter,
  replaceInChapters,
  replaceInVolumeTitles,
  splitChapter,
  splitHtmlBlocks,
} from './chapters'

const chapter = (id: string, title: string, html: string): EditableChapter => ({ id, title, html })

describe('chapter heading detection', () => {
  it('accepts common Chinese and English headings', () => {
    for (const title of ['第一章 开始', '第二十一章，债台高筑', '第一卷 少年', '第1章', 'Chapter 3: Return', '尾声', '1、诱惑力太大！', '544、 我男人！真帅！']) {
      expect(looksLikeChapterHeading(title), title).toBe(true)
    }
  })

  it('rejects body sentences that only start like a heading', () => {
    for (const line of [
      '第一节课上完，休息间隙很长。',
      '第二节课开始。',
      '第1章 “便是改革天皇制度”',
      '第一章开始讲起，他说了很多。',
    ]) {
      expect(looksLikeChapterHeading(line), line).toBe(false)
    }
  })
})

describe('block splitting', () => {
  it('splits top-level paragraphs and keeps nested markup intact', () => {
    expect(splitHtmlBlocks('<p>一</p><p><strong>二</strong></p>')).toEqual(['<p>一</p>', '<p><strong>二</strong></p>'])
    expect(splitHtmlBlocks('<blockquote><p>引用</p></blockquote><p>后文</p>')).toEqual([
      '<blockquote><p>引用</p></blockquote>',
      '<p>后文</p>',
    ])
  })

  it('keeps images and stray text as their own blocks', () => {
    expect(splitHtmlBlocks('<img src="data:image/png;base64,AA==" alt="插图"/><p>正文</p>')).toEqual([
      '<img src="data:image/png;base64,AA==" alt="插图"/>',
      '<p>正文</p>',
    ])
  })

  it('renders previews without markup', () => {
    expect(plainText('<p>甲 &amp; 乙<br/>丙</p>')).toBe('甲 & 乙 丙')
    expect(previewText('<p>一二三四五</p>', 3)).toBe('一二三…')
  })
})

describe('chapter editing', () => {
  const chapters = [
    chapter('a', '第一章 开始', '<p>一。</p><p>二。</p>'),
    chapter('b', '第一节课上完，休息间隙很长。', '<p>三。</p>'),
    chapter('c', '第三章 结束', '<p>四。</p>'),
  ]

  it('merges a false chapter back into the previous one', () => {
    const merged = mergeWithPrevious(chapters, 1)
    expect(merged.map(item => item.id)).toEqual(['a', 'c'])
    expect(merged[0].html).toBe('<p>一。</p><p>二。</p><p>三。</p>')
    expect(merged[0].title).toBe('第一章 开始')
  })

  it('splits at a paragraph and promotes a heading-looking line to the title', () => {
    const chapters = [
      chapter('a', '第一章 开始', '<p>一。</p><p>第二十八章 达瓦里希</p><p>二。</p>'),
    ]
    const split = splitChapter(chapters, 0, 1)
    expect(split).toHaveLength(2)
    expect(split[0].html).toBe('<p>一。</p>')
    expect(split[1].title).toBe('第二十八章 达瓦里希')
    expect(split[1].html).toBe('<p>二。</p>')
    expect(split[1].id).not.toBe('a')
  })

  it('splits without a heading by naming the new chapter as a continuation', () => {
    const split = splitChapter(chapters, 0, 1)
    expect(split[1].title).toBe('第一章 开始（续）')
    expect(split[0].html).toBe('<p>一。</p>')
  })

  it('ignores splits outside the chapter body', () => {
    expect(splitChapter(chapters, 0, 0)).toBe(chapters)
    expect(splitChapter(chapters, 0, 2)).toBe(chapters)
  })

  it('removes a chapter but never the last one', () => {
    expect(removeChapter(chapters, 1).map(item => item.id)).toEqual(['a', 'c'])
    expect(removeChapter([chapters[0]], 0)).toHaveLength(1)
  })

  it('fills in missing titles before saving', () => {
    const normalized = normalizeChapters([chapter('a', '   ', '<p>正文</p>')])
    expect(normalized[0].title).toBe('章节 1')
  })
})

describe('batch replacement', () => {
  const chapters = [
    chapter('a', '第1章 开始', '<p>第1章 的正文，<strong>第1章</strong> 加粗</p>'),
    chapter('b', '第二章 继续', '<p>正文</p>'),
  ]

  it('replaces in titles only when body scope is off', () => {
    const result = replaceInChapters(chapters, '第1章', '第一章', { titles: true, body: false })
    expect(result.matches).toBe(1)
    expect(result.chapters[0].title).toBe('第一章 开始')
    expect(result.chapters[0].html).toBe(chapters[0].html)
  })

  it('replaces body text without touching tags or attributes', () => {
    const result = replaceInChapters(chapters, '第1章', '第一章', { titles: false, body: true })
    expect(result.matches).toBe(2)
    expect(result.chapters[0].html).toBe('<p>第一章 的正文，<strong>第一章</strong> 加粗</p>')
    expect(result.chaptersChanged).toBe(1)
  })

  it('replaces both scopes and reports nothing when no match exists', () => {
    expect(replaceInChapters(chapters, '第1章', '第一章', { titles: true, body: true }).matches).toBe(3)
    const none = replaceInChapters(chapters, '不存在', '替换', { titles: true, body: true })
    expect(none.matches).toBe(0)
    expect(none.chapters).toEqual(chapters)
  })

  it('replaces text in volume titles', () => {
    const volumes = [
      { id: 'v1', title: '第一卷 少年', style: {}, openingImage: null, closingImage: null },
      { id: 'v2', title: '第二卷 远方', style: {}, openingImage: null, closingImage: null },
    ]
    const result = replaceInVolumeTitles(volumes, '第一卷', '笫一卷')
    expect(result.matches).toBe(1)
    expect(result.volumes[0].title).toBe('笫一卷 少年')
    expect(result.volumes[1].title).toBe('第二卷 远方')
  })

  it('matches escaped characters in body text', () => {
    const result = replaceInChapters([chapter('a', '标题', '<p>甲 &amp; 乙</p>')], '甲 & 乙', '甲乙', { titles: false, body: true })
    expect(result.matches).toBe(1)
    expect(result.chapters[0].html).toBe('<p>甲乙</p>')
  })
})

describe('chapter title numbering', () => {
  it('converts Chinese numerals both ways', () => {
    expect(chineseNumberToArabic('十')).toBe(10)
    expect(chineseNumberToArabic('十一')).toBe(11)
    expect(chineseNumberToArabic('二十三')).toBe(23)
    expect(chineseNumberToArabic('二百二十二')).toBe(222)
    expect(chineseNumberToArabic('一千零一')).toBe(1001)
    expect(chineseNumberToArabic('一万')).toBe(10000)
    expect(arabicToChinese(1)).toBe('一')
    expect(arabicToChinese(10)).toBe('十')
    expect(arabicToChinese(11)).toBe('十一')
    expect(arabicToChinese(101)).toBe('一百零一')
    expect(arabicToChinese(222)).toBe('二百二十二')
    expect(arabicToChinese(10005)).toBe('一万零五')
  })

  it('extracts the real chapter name from mixed numbering styles', () => {
    expect(parseChapterTitle('第222章 如果不接受日本投降')).toEqual({ number: 222, unit: '章', text: '如果不接受日本投降' })
    expect(parseChapterTitle('第一章 第一血')).toEqual({ number: 1, unit: '章', text: '第一血' })
    expect(parseChapterTitle('第1章 “便是改革天皇制度”')).toEqual({ number: 1, unit: '章', text: '“便是改革天皇制度”' })
    expect(parseChapterTitle('1. 开端')).toEqual({ number: 1, unit: null, text: '开端' })
    expect(parseChapterTitle('1、诱惑力太大！')).toEqual({ number: 1, unit: null, text: '诱惑力太大！' })
    expect(parseChapterTitle('12 远行')).toEqual({ number: 12, unit: null, text: '远行' })
    expect(parseChapterTitle('Chapter 3: Return')).toEqual({ number: 3, unit: null, text: 'Return' })
    expect(parseChapterTitle('尾声')).toEqual({ number: null, unit: null, text: '尾声' })
    expect(parseChapterTitle('第四卷 S2赛季')).toEqual({ number: 4, unit: '卷', text: 'S2赛季' })
  })

  it('reads and writes upper-case Chinese numerals', () => {
    expect(chineseNumberToArabic('壹')).toBe(1)
    expect(chineseNumberToArabic('拾壹')).toBe(11)
    expect(chineseNumberToArabic('贰拾叁')).toBe(23)
    expect(chineseNumberToArabic('壹佰零壹')).toBe(101)
    expect(arabicToChinese(1, true)).toBe('壹')
    expect(arabicToChinese(10, true)).toBe('拾')
    expect(arabicToChinese(11, true)).toBe('拾壹')
    expect(arabicToChinese(23, true)).toBe('贰拾叁')
    expect(arabicToChinese(10005, true)).toBe('壹萬零伍')
    expect(parseChapterTitle('第壹卷 少年')).toEqual({ number: 1, unit: '卷', text: '少年' })
    expect(parseChapterTitle('第贰拾叁章 归途')).toEqual({ number: 23, unit: '章', text: '归途' })
    expect(parseChapterTitle('卷丨叁丨')).toEqual({ number: 3, unit: '卷', text: '' })
    expect(parseChapterTitle('卷丨玖丨 天下')).toEqual({ number: 9, unit: '卷', text: '天下' })
    expect(formatChapterTitle(3, '新章', 'upper')).toBe('第叁章 新章')
    expect(formatVolumeTitle(2, '少年', 'upper')).toBe('第贰卷 少年')
  })

  it('numbers every volume in one go, keeping its name and unit', () => {
    const volumes: Volume[] = [
      { id: 'v1', title: '卷壹丨风起', style: {}, openingImage: null, closingImage: null },
      { id: 'v2', title: '第2部 云涌', style: {}, openingImage: null, closingImage: null },
      { id: 'v3', title: '未命名卷', style: {}, openingImage: null, closingImage: null },
    ]
    const upper = renumberVolumeTitles(volumes, { style: 'upper', start: 1, unit: '卷' })
    expect(upper.renamed).toBe(3)
    expect(upper.volumes.map(volume => volume.title)).toEqual(['第壹卷 风起', '第贰卷 云涌', '第叁卷 未命名卷'])
    const kept = renumberVolumeTitles(volumes, { style: 'chinese', start: 1 })
    expect(kept.volumes[1].title).toBe('第二部 云涌')
    expect(renumberVolumeTitles(volumes, { style: 'arabic', start: 4, unit: '卷' }).volumes.map(volume => volume.title)).toEqual(['第4卷 风起', '第5卷 云涌', '第6卷 未命名卷'])
    const stripped = renumberVolumeTitles(volumes, { style: 'name', start: 1 })
    expect(stripped.volumes[0].title).toBe('风起')
  })

  it('formats the numbered dun style', () => {
    expect(formatChapterTitle(3, '新章', 'dun')).toBe('3、新章')
  })

  it('formats titles in every supported style', () => {
    expect(formatChapterTitle(1, '开端', 'chinese')).toBe('第一章 开端')
    expect(formatChapterTitle(1, '开端', 'arabic')).toBe('第1章 开端')
    expect(formatChapterTitle(1, '开端', 'bare')).toBe('1 开端')
    expect(formatChapterTitle(1, '开端', 'dot')).toBe('1. 开端')
    expect(formatChapterTitle(1, '开端', 'name')).toBe('开端')
  })

  const chapters = [
    chapter('a', '第222章 如果不接受日本投降', '<p>一。</p>'),
    chapter('b', '第一章 第一血', '<p>二。</p>'),
    chapter('c', '1. 开端', '<p>三。</p>'),
    chapter('d', '尾声', '<p>四。</p>'),
  ]

  it('renumbers a book continuously while keeping names', () => {
    const result = renumberChapters(chapters, [], { style: 'chinese', counting: 'book', start: 1, renumberVolumes: false })
    expect(result.chapters.map(item => item.title)).toEqual([
      '第一章 如果不接受日本投降',
      '第二章 第一血',
      '第三章 开端',
      '尾声',
    ])
    expect(result.renamed).toBe(3)
  })

  it('starts at a selected chapter and leaves introductory chapters untouched', () => {
    const front = [chapter('cover', '封面', '<p>封面</p>'), chapter('author', '第四章 作者简介', '<p>简介</p>')]
    const body = [chapter('first', '第五章 士伍，请出示身份证！', '<p>正文</p>'), chapter('second', '第六章 天下事与眼前事', '<p>正文</p>')]
    const all = [...front, ...body]
    const volumes: Volume[] = [{ id: 'v1', title: '第一卷 小亭长', style: {}, openingImage: null, closingImage: null }]
    all[2].volumeId = 'v1'
    all[3].volumeId = 'v1'
    expect(suggestNumberingStart(all, volumes)).toBe('first')
    expect(suggestNumberingStart([{ ...all[1], volumeId: 'v1' }, ...all.slice(2)], volumes)).toBe('first')
    const result = renumberChapters(all, volumes, { style: 'chinese', counting: 'book', start: 1, fromChapterId: 'first', renumberVolumes: false })
    expect(result.chapters.map(item => item.title)).toEqual(['封面', '第四章 作者简介', '第一章 士伍，请出示身份证！', '第二章 天下事与眼前事'])
  })

  it('restarts numbering inside each volume', () => {
    const volumes = [
      { id: 'v1', title: '第一卷 少年', style: {}, openingImage: null, closingImage: null },
      { id: 'v2', title: '第二卷 远方', style: {}, openingImage: null, closingImage: null },
    ]
    const scoped = [
      { ...chapter('a', '第222章 甲', '<p>一。</p>'), volumeId: 'v1' },
      { ...chapter('b', '第一章 乙', '<p>二。</p>'), volumeId: 'v1' },
      { ...chapter('c', '1. 丙', '<p>三。</p>'), volumeId: 'v2' },
    ]
    const result = renumberChapters(scoped, volumes, { style: 'arabic', counting: 'volume', start: 1, renumberVolumes: false })
    expect(result.chapters.map(item => item.title)).toEqual(['第1章 甲', '第2章 乙', '第1章 丙'])
  })

  it('uses dun titles with numbering restarted for each volume', () => {
    const scoped = [
      { ...chapter('a', '18、甲', '<p>一。</p>'), volumeId: 'v1' },
      { ...chapter('b', '19、乙', '<p>二。</p>'), volumeId: 'v1' },
      { ...chapter('c', '20、丙', '<p>三。</p>'), volumeId: 'v2' },
    ]
    const result = renumberChapters(scoped, [], { style: 'dun', counting: 'volume', start: 1, renumberVolumes: false })
    expect(result.chapters.map(item => item.title)).toEqual(['1、甲', '2、乙', '1、丙'])
  })

  it('keeps original numbers and adds a prefix to titles that had none', () => {
    const result = renumberChapters(
      [...chapters, chapter('e', '无名章节', '<p>五。</p>')],
      [],
      { style: 'arabic', counting: 'keep', start: 1, renumberVolumes: false },
    )
    expect(result.chapters.map(item => item.title)).toEqual([
      '第222章 如果不接受日本投降',
      '第1章 第一血',
      '第1章 开端',
      '尾声',
      '第223章 无名章节',
    ])
  })

  it('can strip numbering to leave only names', () => {
    const result = renumberChapters(chapters, [], { style: 'name', counting: 'book', start: 1, renumberVolumes: false })
    expect(result.chapters.map(item => item.title)).toEqual(['如果不接受日本投降', '第一血', '开端', '尾声'])
  })

  it('continues each volume numbering when filling missing prefixes', () => {
    const volumes = [
      { id: 'v1', title: '第一卷 少年', style: {}, openingImage: null, closingImage: null },
      { id: 'v2', title: '第二卷 远方', style: {}, openingImage: null, closingImage: null },
    ]
    const scoped = [
      { ...chapter('a', '第1章 甲', '<p>一。</p>'), volumeId: 'v1' },
      { ...chapter('b', '第2章 乙', '<p>二。</p>'), volumeId: 'v1' },
      { ...chapter('c', '第1章 丙', '<p>三。</p>'), volumeId: 'v2' },
      { ...chapter('d', '无名丁', '<p>四。</p>'), volumeId: 'v2' },
    ]
    const result = renumberChapters(scoped, volumes, { style: 'arabic', counting: 'keep', start: 1, renumberVolumes: false })
    expect(result.chapters.map(item => item.title)).toEqual(['第1章 甲', '第2章 乙', '第1章 丙', '第2章 无名丁'])
  })

  it('normalizes volume titles without losing their number', () => {
    const volumes = [
      { id: 'v1', title: '第四卷 S2赛季', style: {}, openingImage: null, closingImage: null },
    ]
    const result = renumberChapters(chapters, volumes, { style: 'arabic', counting: 'book', start: 1, renumberVolumes: true })
    expect(result.volumes[0].title).toBe('第4卷 S2赛季')
    expect(result.renamedVolumes).toBe(1)
  })
})
