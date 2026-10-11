/**
 * Page wrapper: VibeGuard header + body. Used by every route.
 */

import React from 'react';
import { Link } from 'react-router';
import { useSession } from 'modelence/client';
import LoadingSpinner from '@/client/components/LoadingSpinner';
import { Seo, type SeoProps } from '@/client/components/Seo';
import { cn } from '@/client/lib/utils';

interface PageProps {
  children?: React.ReactNode;
  isLoading?: boolean;
  className?: string;
  /** Per-page <head> overrides (title, description, OG image, etc). */
  seo?: SeoProps;
}

const navLink =
  'rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-raised hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt';

function Header() {
  const { user } = useSession();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-3 md:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="inline-block size-2.5 rounded-sm bg-verdant shadow-[0_0_12px_var(--color-verdant)]" aria-hidden="true" />
          <span className="font-display text-base font-bold tracking-tight">VibeGuard</span>
          <span className="hidden text-xs text-muted sm:inline">eval-driven guardrails · human-only release gate</span>
        </Link>

        <nav className="flex items-center gap-1">
          <a className={navLink} href="https://github.com/EonsofStupid/vibeguard" target="_blank" rel="noreferrer">
            GitHub
          </a>
          {user ? (
            <>
              <span className="hidden font-mono text-xs text-verdant sm:inline">human:{user.handle}</span>
              <Link to="/logout" className={navLink}>Logout</Link>
            </>
          ) : (
            <Link to="/login" className={navLink}>Sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function PageWrapper({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen max-w-full flex-col overflow-x-hidden bg-ink text-text">{children}</div>;
}

function PageBody({ children, className, isLoading = false }: PageProps) {
  return (
    <div className="flex w-full min-h-0 flex-1">
      <main className={cn('mx-auto flex w-full max-w-[1200px] flex-1 flex-col space-y-4 overflow-x-hidden px-4 py-5 md:px-6', className)}>
        {isLoading ? (
          <div className="flex h-full w-full items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

export default function Page({ children, className, isLoading = false, seo }: PageProps) {
  return (
    <PageWrapper>
      <Seo {...seo} />
      <Header />
      <PageBody className={className} isLoading={isLoading}>{children}</PageBody>
    </PageWrapper>
  );
}
