export const LegalNotice = () => {
  return (
    <p className="text-ink-subtle mx-2 my-3 text-center text-xs leading-normal">
      By connecting a wallet, you agree to Pulsar&apos;s{' '}
      <a
        href="/terms-of-service"
        className="text-ink decoration-line-strong underline decoration-1 underline-offset-2 transition-colors hover:decoration-accent-strong"
      >
        Terms of Service
      </a>{' '}
      and consent to its{' '}
      <a
        href="/privacy-policy"
        className="text-ink decoration-line-strong underline decoration-1 underline-offset-2 transition-colors hover:decoration-accent-strong"
      >
        Privacy Policies
      </a>
      .
    </p>
  )
}
