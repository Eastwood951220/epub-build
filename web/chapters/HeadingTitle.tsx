import { splitHeading, type HeadingKind } from './headings'
import type { TitleLayout } from '../book/model'

export default function HeadingTitle({ title, kind, id, layout = 'stacked' }: { title: string; kind: HeadingKind; id?: string | null; layout?: TitleLayout }) {
  const { number, name } = splitHeading(title, kind)
  return <h1 id={id ?? undefined} className={`paper-chapter-title ${kind}-heading title-${layout}`}>
    {number && <span className="heading-number">{number}</span>}
    {name && <span className="heading-name">{name}</span>}
  </h1>
}
