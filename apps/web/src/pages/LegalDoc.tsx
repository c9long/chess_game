import { APP_NAME } from '@game/config'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Alert, CenteredPage } from '../components/ui.tsx'

/** docs/legal/*.md, bundled at build time. Missing files simply aren't in the map. */
const docs = import.meta.glob<string>('../../../../docs/legal/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const FILES = {
  terms: { file: 'terms-of-service.md', title: 'Terms of Service' },
  privacy: { file: 'privacy-policy.md', title: 'Privacy Policy' },
} as const

export function findDoc(kind: keyof typeof FILES): string | undefined {
  const entry = Object.entries(docs).find(([path]) => path.endsWith(`/${FILES[kind].file}`))
  return entry?.[1]
}

export function LegalDoc({ kind }: { kind: keyof typeof FILES }) {
  const text = findDoc(kind)
  return (
    <CenteredPage wide>
      <article
        className="legal-doc rounded-2xl border border-parchment/10 bg-panel/80 p-6 sm:p-10"
        data-testid="legal-doc"
      >
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
    </CenteredPage>
  )
}
