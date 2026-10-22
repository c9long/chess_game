import { APP_NAME } from '@game/config'
import Markdown from 'react-markdown'
import { NavLink } from 'react-router'
import remarkGfm from 'remark-gfm'
import { Alert, cx } from '../components/ui.tsx'

/** docs/legal/*.md, bundled at build time. Missing files simply aren't in the map. */
const docs = import.meta.glob<string>('../../../../docs/legal/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const FILES = {
  terms: { file: 'terms-of-service.md', title: 'Terms of Service', path: '/terms' },
  privacy: { file: 'privacy-policy.md', title: 'Privacy Policy', path: '/privacy' },
} as const

export function findDoc(kind: keyof typeof FILES): string | undefined {
  const entry = Object.entries(docs).find(([path]) => path.endsWith(`/${FILES[kind].file}`))
  return entry?.[1]
}

/**
 * A legal document set as a plain reading column on the room's ink (no box around it), with a
 * small switcher between the two documents. The wording comes only from docs/legal; the
 * typography of the text itself is `.legal-doc` in index.css.
 */
export function LegalDoc({ kind }: { kind: keyof typeof FILES }) {
  const text = findDoc(kind)
  return (
    <div className="mx-auto w-full max-w-[44rem] px-4 pt-8 pb-16 sm:pt-12">
      <nav aria-label="Legal documents" className="mb-8 flex gap-6 border-b border-rule text-ui">
        {Object.values(FILES).map((f) => (
          <NavLink
            key={f.path}
            to={f.path}
            className={({ isActive }) =>
              cx(
                '-mb-px border-b-2 pt-1 pb-3 transition-colors duration-150',
                isActive
                  ? 'border-brass font-medium text-parchment'
                  : 'border-transparent text-faint hover:text-parchment',
              )
            }
          >
            {f.title}
          </NavLink>
        ))}
      </nav>
      <article className="legal-doc max-w-[68ch]" data-testid="legal-doc">
        {text ? (
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Wide tables scroll inside their own box instead of widening the page on phones.
              table: ({ children }) => (
                <div className="legal-table-wrap">
                  <table>{children}</table>
                </div>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  rel="noopener noreferrer"
                  target={href?.startsWith('http') ? '_blank' : undefined}
                >
                  {children}
                </a>
              ),
            }}
          >
            {text}
          </Markdown>
        ) : (
          <>
            <h1>{FILES[kind].title}</h1>
            <Alert tone="info">
              The {FILES[kind].title} for {APP_NAME} is being finalized and will be published here
              before launch.
            </Alert>
          </>
        )}
      </article>
    </div>
  )
}
