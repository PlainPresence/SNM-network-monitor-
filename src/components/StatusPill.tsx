type Props = {
  tone: 'ok' | 'warn' | 'bad'
  text: string
}

export function StatusPill({ tone, text }: Props) {
  return <span className={`pill pill-${tone}`}>{text}</span>
}
